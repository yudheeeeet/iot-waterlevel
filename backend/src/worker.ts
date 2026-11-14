import pino from 'pino';
import { loadWorkerEnv } from './config/env.js';
import { createSql, pingDb } from './db/client.js';
import { createBroker } from './modules/devices/broker/index.js';
import { reconcileBroker } from './modules/devices/reconcile.js';
import { brokerHost, writeHeartbeat } from './modules/health/workerStatus.js';
import { createIngestion } from './modules/ingestion/consumer.js';
import { recordTimeouts } from './modules/presence/presence.js';
import { connectMqtt } from './shared/mqttClient.js';
import { REDACT_PATHS } from './shared/logger.js';

/**
 * Worker: long-running process.
 * - MQTT ingestion: baruna/devices/+/readings → readings + devices.last_* (Task 10)
 * - presence job every 30 s: records offline transitions (Task 11)
 * - heartbeat every 30 s → worker_status, shown by /api/health
 * - broker reconciliation on every (re)connect, `mosquitto` mode only (Task 7)
 */
const HEARTBEAT_MS = 30_000;
const PRESENCE_MS = 30_000;
const COUNTERS_MS = 5 * 60_000;

const env = loadWorkerEnv();
const log = pino({ level: env.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: '[redacted]' } }).child({
  proc: 'worker',
});
const sql = createSql(env.DATABASE_URL, { max: 3 });
const startedAt = new Date();

const dbUp = await pingDb(sql);
log.info({ db: dbUp ? 'up' : 'down', broker: env.BROKER_PROVIDER, workerId: env.WORKER_ID }, 'worker started');

const ingestion = createIngestion(sql, log);
const mqtt = connectMqtt({ url: env.MQTT_URL!, username: env.MQTT_USERNAME!, password: env.MQTT_PASSWORD! }, 'baruna-worker', {
  clientId: env.WORKER_ID,
  persistentSession: true,
  customHandleAcks: ingestion.customHandleAcks,
});
const broker = createBroker(env, 'baruna-worker', mqtt);
ingestion.attach(mqtt);

let reconciling = false;
async function reconcile() {
  if (reconciling || env.BROKER_PROVIDER !== 'mosquitto') return;
  reconciling = true;
  try {
    const report = await reconcileBroker(sql, broker);
    if (report && (report.removed.length || report.missing.length || report.fixedEnabled.length)) {
      log.warn(report, 'broker reconciled: accounts changed to match the database');
    } else {
      log.info('broker reconciled: no changes');
    }
  } catch (err) {
    log.error({ err }, 'broker reconciliation failed');
  } finally {
    reconciling = false;
  }
}

mqtt.on('connect', () => {
  log.info('mqtt connected');
  void heartbeat();
  // On every (re)connect: the broker may have restarted or been edited while we were away.
  void reconcile();
});
mqtt.on('close', () => log.warn('mqtt disconnected'));
mqtt.on('error', (err) => log.error({ err: err.message }, 'mqtt error'));

async function heartbeat() {
  try {
    await writeHeartbeat(sql, { workerId: env.WORKER_ID, mqttConnected: mqtt.connected, brokerHost: brokerHost(env.MQTT_URL!), startedAt });
  } catch (err) {
    log.error({ err }, 'heartbeat failed');
  }
}

async function presence() {
  try {
    const offline = await recordTimeouts(sql);
    if (offline.length) log.info({ devices: offline }, 'devices went offline');
  } catch (err) {
    log.error({ err }, 'presence job failed');
  }
}

const timers = [
  setInterval(() => void heartbeat(), HEARTBEAT_MS),
  setInterval(() => void presence(), PRESENCE_MS),
  setInterval(() => log.info(ingestion.takeCounters(), 'ingestion counters (last 5 min)'), COUNTERS_MS),
];
void heartbeat();
void presence();

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down worker');
  timers.forEach(clearInterval);
  await ingestion.drain();
  log.info(ingestion.takeCounters(), 'ingestion counters (final)');
  await broker.close();
  await mqtt.endAsync();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

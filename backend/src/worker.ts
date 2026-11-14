import pino from 'pino';
import { loadWorkerEnv } from './config/env.js';
import { createSql, pingDb } from './db/client.js';
import { createBroker } from './modules/devices/broker/index.js';
import { reconcileBroker } from './modules/devices/reconcile.js';
import { connectMqtt } from './shared/mqttClient.js';
import { REDACT_PATHS } from './shared/logger.js';

/**
 * Worker entry: long-running process for broker reconciliation (Task 7), MQTT ingestion (Task 10)
 * and the presence job (Task 11).
 */
const env = loadWorkerEnv();
const log = pino({ level: env.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: '[redacted]' } }).child({
  proc: 'worker',
});
const sql = createSql(env.DATABASE_URL, { max: 3 });

const dbUp = await pingDb(sql);
log.info({ db: dbUp ? 'up' : 'down', broker: env.BROKER_PROVIDER }, 'worker started');

const mqtt = connectMqtt({ url: env.MQTT_URL!, username: env.MQTT_USERNAME!, password: env.MQTT_PASSWORD! }, 'baruna-worker');
const broker = createBroker(env, 'baruna-worker', mqtt);

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
  // On every (re)connect: the broker may have restarted or been edited while we were away.
  void reconcile();
});
mqtt.on('close', () => log.warn('mqtt disconnected'));
mqtt.on('error', (err) => log.error({ err: err.message }, 'mqtt error'));

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down worker');
  await broker.close();
  await mqtt.endAsync();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

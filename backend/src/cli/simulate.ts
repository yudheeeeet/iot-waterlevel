import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import mqtt, { type MqttClient } from 'mqtt';

/**
 * Device simulator (Task 8). Publishes { ts, level } with QoS 1 exactly like the firmware.
 *
 * Prepare simulated devices once (creates SIM-001..N in the DB + broker accounts, or rotates their
 * tokens if they exist) and save "id + token" to .sim-devices.json (git-ignored):
 *   npm run simulate -- --setup 3
 * Run:
 *   npm run simulate                                  every 60 s, mode noise
 *   npm run simulate -- --interval 2 --mode rise      fast test, water rising 1 cm per reading
 *   npm run simulate -- --duplicate                   every message sent twice (QoS 1 re-delivery)
 *   npm run simulate -- --batch 5                     buffer 5 readings, send as one batch
 *   npm run simulate -- --skew 180                    device clock 3 minutes ahead (rejected)
 *   npm run simulate -- --device BWN-001:bwn_xxx      a real device id + token instead of the file
 *   npm run simulate -- --env .env.hivemq             broker URL from another env file
 */
const { values } = parseArgs({
  options: {
    setup: { type: 'string' },
    env: { type: 'string', default: '.env' },
    url: { type: 'string' },
    file: { type: 'string', default: '.sim-devices.json' },
    device: { type: 'string', multiple: true },
    interval: { type: 'string', default: '60' },
    mode: { type: 'string', default: 'noise' },
    base: { type: 'string', default: '250' },
    noise: { type: 'string', default: '0.5' },
    duplicate: { type: 'boolean', default: false },
    batch: { type: 'string', default: '1' },
    skew: { type: 'string', default: '0' },
    count: { type: 'string', default: '0' },
  },
});

if (existsSync(values.env!)) process.loadEnvFile(values.env!);

interface SimDevice {
  id: string;
  token: string;
}

// ── setup ──────────────────────────────────────────────────────────────
if (values.setup !== undefined) {
  const n = Number(values.setup);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('--setup harus 1..50');
  const { loadWorkerEnv } = await import('../config/env.js');
  const { createSql } = await import('../db/client.js');
  const { createBroker } = await import('../modules/devices/broker/index.js');
  const { deviceService } = await import('../modules/devices/service.js');
  const env = loadWorkerEnv();
  const sql = createSql(env.DATABASE_URL, { max: 1 });
  const broker = createBroker(env, 'baruna-sim-setup');
  const svc = deviceService({
    sql,
    broker,
    mqttPublic: { host: env.MQTT_PUBLIC_HOST, port: env.MQTT_PUBLIC_PORT, tls: env.MQTT_PUBLIC_TLS },
    reservedIds: ['admin', 'baruna-backend'],
  });
  const out: SimDevice[] = [];
  try {
    for (let i = 1; i <= n; i++) {
      const id = `SIM-${String(i).padStart(3, '0')}`;
      const exists = await svc.get(id).then(() => true, () => false);
      const issued = exists
        ? await svc.rotateToken(id, null)
        : await svc.create({ id, name: `Simulator ${i}`, lat: -6.6 + i * 0.005, lon: 106.8 + i * 0.005 }, null);
      out.push({ id, token: issued.token });
      const note = issued.brokerError ? `GAGAL broker: ${issued.brokerError.message}` : issued.brokerSetup ? 'perlu setup manual di HiveMQ (lihat brokerSetup)' : 'akun broker siap';
      console.log(`${exists ? 'rotasi ' : 'dibuat '} ${id}  token …${issued.tokenLast4}  (${note})`);
    }
    writeFileSync(values.file!, JSON.stringify(out, null, 2));
    console.log(`Disimpan ke ${values.file} (jangan di-commit). Jalankan: npm run simulate`);
  } finally {
    await broker.close();
    await sql.end({ timeout: 5 });
  }
  process.exit(0);
}

// ── run ────────────────────────────────────────────────────────────────
const devices: SimDevice[] = values.device?.length
  ? values.device.map((d) => {
      const i = d.indexOf(':');
      if (i < 1) throw new Error(`--device harus ID:TOKEN, didapat "${d}"`);
      return { id: d.slice(0, i), token: d.slice(i + 1) };
    })
  : existsSync(values.file!)
    ? (JSON.parse(readFileSync(values.file!, 'utf8')) as SimDevice[])
    : [];
if (devices.length === 0) {
  console.error(`Tidak ada device. Jalankan dulu: npm run simulate -- --setup 3   (atau --device ID:TOKEN)`);
  process.exit(1);
}

const url = values.url ?? process.env.MQTT_URL ?? '';
if (!/^mqtts?:\/\//.test(url)) {
  console.error('MQTT_URL tidak diisi (pakai --url mqtt://host:port atau --env file)');
  process.exit(1);
}
const intervalMs = Math.max(0.2, Number(values.interval)) * 1000;
const mode = values.mode!;
if (!['constant', 'noise', 'rise', 'fall'].includes(mode)) throw new Error('--mode: constant | noise | rise | fall');
const base = Number(values.base);
const noise = Number(values.noise);
const batch = Math.max(1, Number(values.batch));
const skewMs = Number(values.skew) * 1000;
const maxCount = Number(values.count);

/** rise = water rising = distance shrinking 1 cm per reading (min 5 cm); fall = the opposite. */
function level(step: number, offset: number): number {
  const b = base + offset * 15;
  const v =
    mode === 'constant' ? b
    : mode === 'rise' ? Math.max(5, b - step)
    : mode === 'fall' ? b + step
    : b + (Math.random() * 2 - 1) * noise;
  return Math.round(v * 100) / 100;
}

console.log(`Broker ${url}  ·  ${devices.length} device  ·  tiap ${intervalMs / 1000} s  ·  mode ${mode}` +
  `${values.duplicate ? ' · duplikat' : ''}${batch > 1 ? ` · batch ${batch}` : ''}${skewMs ? ` · jam +${skewMs / 1000} s` : ''}`);

const clients = await Promise.all(
  devices.map(async (d, idx): Promise<{ d: SimDevice; c: MqttClient; idx: number; step: number; buf: object[] }> => {
    const c = await mqtt.connectAsync(url, {
      username: d.id,
      password: d.token,
      clientId: d.id,
      protocolVersion: 5,
      clean: false,
      properties: { sessionExpiryInterval: 3600 },
      keepalive: 60,
      reconnectPeriod: 2000,
      will: { topic: `baruna/devices/${d.id}/status`, payload: Buffer.from('offline'), qos: 1, retain: false },
    }).catch((err: Error) => {
      console.error(`${d.id}: gagal connect — ${err.message}`);
      process.exit(1);
    });
    c.on('error', (err) => console.error(`${d.id}: ${err.message}`));
    return { d, c, idx, step: 0, buf: [] };
  }),
);

const publish = (c: MqttClient, topic: string, payload: string) =>
  new Promise<number>((resolve) =>
    c.publish(topic, payload, { qos: 1 }, (err, packet) => {
      const code = (err as { code?: number } | undefined)?.code;
      resolve(typeof code === 'number' ? code : ((packet as { reasonCode?: number } | undefined)?.reasonCode ?? 0));
    }),
  );

let sent = 0;
async function tick() {
  for (const s of clients) {
    const reading = { ts: new Date(Date.now() + skewMs).toISOString(), level: level(s.step++, s.idx) };
    s.buf.push(reading);
    if (s.buf.length < batch) {
      console.log(`${s.d.id}  ${reading.ts}  ${reading.level} cm  (ditahan ${s.buf.length}/${batch})`);
      continue;
    }
    const payload = JSON.stringify(batch > 1 ? { readings: s.buf } : reading);
    s.buf = [];
    const topic = `baruna/devices/${s.d.id}/readings`;
    const rc = await publish(s.c, topic, payload);
    if (values.duplicate) await publish(s.c, topic, payload);
    console.log(`${s.d.id}  ${reading.ts}  ${reading.level} cm  ${rc === 0 ? 'terkirim' : `DITOLAK broker (rc ${rc})`}${values.duplicate ? ' ×2' : ''}${batch > 1 ? ` (batch ${batch})` : ''}`);
  }
  sent++;
  if (maxCount && sent >= maxCount) await stop();
}

async function stop() {
  clearInterval(timer);
  await Promise.all(clients.map((s) => s.c.endAsync()));
  process.exit(0);
}

const timer = setInterval(() => void tick(), intervalMs); // before the first tick: --count 1 stops inside it
await tick();
process.once('SIGINT', () => void stop());

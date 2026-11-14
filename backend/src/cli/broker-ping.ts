import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pingBroker } from '../shared/brokerPing.js';

/**
 * npm run broker:ping                         → broker in .env (local Mosquitto)
 * npm run broker:ping -- --env .env.hivemq    → another env file (e.g. HiveMQ Cloud), .env untouched
 *
 * Reads MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD. Connects, subscribes and publishes to a private
 * test topic, and prints the round-trip time. The password is never printed.
 */
const { values } = parseArgs({ options: { env: { type: 'string', default: '.env' }, count: { type: 'string', default: '3' } } });
const file = values.env!;
if (!existsSync(file)) {
  console.error(`GAGAL: file ${file} tidak ditemukan (jalankan dari folder backend)`);
  process.exit(1);
}
process.loadEnvFile(file);

const url = process.env.MQTT_URL ?? '';
const username = process.env.MQTT_USERNAME ?? '';
const password = process.env.MQTT_PASSWORD ?? '';
const missing = [!/^mqtts?:\/\//.test(url) && 'MQTT_URL (mqtt:// atau mqtts://)', !username && 'MQTT_USERNAME', (!password || password.includes('GANTI_')) && 'MQTT_PASSWORD'].filter(Boolean);
if (missing.length) {
  console.error(`GAGAL: isi di ${file}: ${missing.join(', ')}`);
  process.exit(1);
}
if (/hivemq\.cloud/.test(url) && !url.startsWith('mqtts://')) {
  console.warn('PERINGATAN: HiveMQ Cloud hanya menerima TLS; gunakan mqtts://<cluster>.hivemq.cloud:8883');
}

console.log(`Broker  : ${url.replace(/^(mqtts?:\/\/)[^@]*@/, '$1')}`);
console.log(`Akun    : ${username}`);
const r = await pingBroker({ url, username, password }, { count: Math.max(1, Number(values.count) || 3) });
if (r.ok && r.publishDenied) {
  console.log(`OK      : connect ${r.connectMs} ms, subscribe diizinkan.`);
  console.log('          Publish tidak diizinkan untuk akun ini (wajar untuk akun backend Mosquitto lokal yang hanya subscribe).');
} else if (r.ok) {
  const avg = Math.round(r.roundTripsMs.reduce((a, b) => a + b, 0) / r.roundTripsMs.length);
  console.log(`OK      : connect ${r.connectMs} ms; publish→terima ${r.roundTripsMs.join(' / ')} ms (rata-rata ${avg} ms)`);
} else {
  console.error(`GAGAL   : ${r.error}`);
  process.exitCode = 1;
}

import { existsSync } from 'node:fs';
import mqtt, { type MqttClient } from 'mqtt';
import type { MqttConnection } from '../shared/mqttClient.js';

/**
 * Broker integration tests use the local project broker (`npm run broker:local`, MQTT_URL in .env).
 * They are skipped when it is not running or not configured.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

export const testBrokerConn: MqttConnection = {
  url: process.env.MQTT_URL ?? '',
  username: process.env.MQTT_USERNAME ?? '',
  password: process.env.MQTT_PASSWORD ?? '',
};

async function probe(): Promise<boolean> {
  const { url, username, password } = testBrokerConn;
  if (!/^mqtts?:\/\//.test(url) || !username || !password || password.includes('GANTI_')) return false;
  // Never run destructive account tests against a remote broker.
  if (!/^mqtts?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) return false;
  try {
    const c = await mqtt.connectAsync(url, { username, password, reconnectPeriod: 0, connectTimeout: 1500 });
    await c.endAsync();
    return true;
  } catch {
    return false;
  }
}

export const hasTestBroker = await probe();

/** Connects as a device (MQTT v5, no auto-reconnect). Rejects when the broker refuses the login. */
export const connectDevice = (id: string, password: string): Promise<MqttClient> =>
  mqtt.connectAsync(testBrokerConn.url, {
    username: id,
    password,
    clientId: `test-${id}`,
    protocolVersion: 5,
    reconnectPeriod: 0,
    connectTimeout: 2000,
  });

/** Publishes with QoS 1 and returns the PUBACK reason code (0 = accepted, 135 = not authorized). */
export const publishRc = (client: MqttClient, topic: string, payload = '{}'): Promise<number> =>
  new Promise((resolve) => {
    client.publish(topic, payload, { qos: 1 }, (err, packet) => {
      const code = (err as { code?: number } | undefined)?.code;
      resolve(typeof code === 'number' ? code : ((packet as { reasonCode?: number } | undefined)?.reasonCode ?? 0));
    });
  });

/** Resolves true when the client is disconnected by the broker within `ms`. */
export const closedWithin = (client: MqttClient, ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (!client.connected) return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    client.once('close', () => {
      clearTimeout(t);
      resolve(true);
    });
  });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

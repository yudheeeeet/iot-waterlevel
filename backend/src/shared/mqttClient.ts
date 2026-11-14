import { randomBytes } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';

export interface MqttConnection {
  url: string;
  username: string;
  password: string;
}

/**
 * Connects the backend account (baruna-backend) to the broker.
 * The client reconnects on its own; callers check `client.connected` before sending.
 */
export function connectMqtt(conn: MqttConnection, clientIdPrefix: string): MqttClient {
  return mqtt.connect(conn.url, {
    username: conn.username,
    password: conn.password,
    clientId: `${clientIdPrefix}-${randomBytes(4).toString('hex')}`,
    protocolVersion: 5,
    connectTimeout: 5_000,
    reconnectPeriod: 2_000,
    // Never replay queued commands after a reconnect: a stale broker command is worse than a failed one.
    queueQoSZero: false,
  });
}

/** Resolves once connected, rejects after `timeoutMs`. */
export function waitConnected(client: MqttClient, timeoutMs: number): Promise<void> {
  if (client.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (err?: Error) => {
      clearTimeout(timer);
      client.off('connect', onConnect);
      if (err) reject(err);
      else resolve();
    };
    const onConnect = () => done();
    const timer = setTimeout(() => done(new Error('MQTT connect timeout')), timeoutMs);
    client.on('connect', onConnect);
  });
}

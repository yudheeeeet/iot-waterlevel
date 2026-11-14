import { randomBytes } from 'node:crypto';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';

export interface MqttConnection {
  url: string;
  username: string;
  password: string;
}

export interface ConnectOptions {
  /** Fixed client id (needed for a persistent session). Default: `${prefix}-<random>`. */
  clientId?: string;
  /**
   * Persistent session (clean=false, session kept 1 h): QoS 1 messages published while the worker is
   * briefly away are delivered when it comes back (PRD IN-7).
   */
  persistentSession?: boolean;
  /** Ack QoS 1 messages only after they are handled (mqtt.js customHandleAcks). */
  customHandleAcks?: IClientOptions['customHandleAcks'];
}

const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 60_000;

/**
 * Connects the backend account (baruna-backend) to the broker.
 * Reconnects by itself with exponential backoff (1 s → 60 s, reset on success).
 */
export function connectMqtt(conn: MqttConnection, clientIdPrefix: string, opts: ConnectOptions = {}): MqttClient {
  const client = mqtt.connect(conn.url, {
    username: conn.username,
    password: conn.password,
    clientId: opts.clientId ?? `${clientIdPrefix}-${randomBytes(4).toString('hex')}`,
    protocolVersion: 5,
    clean: !opts.persistentSession,
    ...(opts.persistentSession ? { properties: { sessionExpiryInterval: 3600 } } : {}),
    connectTimeout: 5_000,
    reconnectPeriod: MIN_RECONNECT_MS,
    // Never replay queued commands after a reconnect: a stale broker command is worse than a failed one.
    queueQoSZero: false,
    ...(opts.customHandleAcks ? { customHandleAcks: opts.customHandleAcks } : {}),
  });
  client.on('reconnect', () => {
    client.options.reconnectPeriod = Math.min((client.options.reconnectPeriod ?? MIN_RECONNECT_MS) * 2, MAX_RECONNECT_MS);
  });
  client.on('connect', () => {
    client.options.reconnectPeriod = MIN_RECONNECT_MS;
  });
  return client;
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

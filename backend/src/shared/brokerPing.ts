import { randomBytes } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';
import type { MqttConnection } from './mqttClient.js';

export interface PingResult {
  ok: boolean;
  host: string;
  connectMs?: number;
  /** Publish → receive round trips (QoS 1) on a private test topic. */
  roundTripsMs: number[];
  /**
   * Connected and subscribed, but this account may not publish to baruna/devices/... — expected for the
   * local Mosquitto backend account (subscribe only). HiveMQ's backend credential has Publish and Subscribe.
   */
  publishDenied?: boolean;
  /** Human explanation of the failure, in Indonesian. Never contains the password. */
  error?: string;
}

const isNotAuthorized = (err: unknown) => {
  const e = err as { code?: number; message?: string };
  return e?.code === 135 || /^Publish error: Not authorized/i.test(e?.message ?? '');
};

/** Turns low-level connect errors into a hint about what to fix. */
export function explainMqttError(err: unknown): string {
  const e = err as { code?: string | number; message?: string };
  const msg = e?.message ?? String(err);
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') return `Host tidak ditemukan (cek MQTT_URL / nama cluster): ${msg}`;
  if (e?.code === 'ECONNREFUSED') return `Koneksi ditolak (cek port; HiveMQ Cloud TLS = 8883): ${msg}`;
  if (e?.code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    return `Timeout (port mungkin diblokir jaringan/firewall, atau salah memakai mqtt:// untuk port TLS): ${msg}`;
  }
  if (e?.code === 'ECONNRESET' || /socket hang up|closed/i.test(msg)) {
    return `Koneksi diputus server (HiveMQ Cloud wajib TLS: gunakan mqtts://...:8883): ${msg}`;
  }
  if (e?.code === 134 || e?.code === 135 || e?.code === 4 || e?.code === 5 || /not authori[sz]ed|bad user ?name or password/i.test(msg)) {
    return `Username/password ditolak broker (cek credential di Access Management): ${msg}`;
  }
  if (/certificate|self[- ]signed|TLS|SSL/i.test(msg)) return `Masalah sertifikat TLS: ${msg}`;
  return msg;
}

/**
 * Connects with the given account, subscribes to a private topic, publishes `count` messages to it
 * and measures each round trip. Proves: host reachable, TLS ok, credentials accepted, publish +
 * subscribe permitted on baruna/devices/#.
 */
export async function pingBroker(
  conn: MqttConnection,
  { count = 3, timeoutMs = 10_000 }: { count?: number; timeoutMs?: number } = {},
): Promise<PingResult> {
  const host = conn.url.replace(/^(mqtts?:\/\/)[^@]*@/, '$1'); // never echo userinfo
  const result: PingResult = { ok: false, host, roundTripsMs: [] };
  const topic = `baruna/devices/PING-${randomBytes(4).toString('hex')}/status`;
  let client: MqttClient | undefined;

  try {
    const t0 = performance.now();
    client = await mqtt.connectAsync(conn.url, {
      username: conn.username,
      password: conn.password,
      clientId: `baruna-ping-${randomBytes(4).toString('hex')}`,
      protocolVersion: 5,
      reconnectPeriod: 0,
      connectTimeout: timeoutMs,
    });
    result.connectMs = Math.round(performance.now() - t0);

    const granted = await client.subscribeAsync(topic, { qos: 1 });
    if (granted.some((g) => g.qos >= 128)) {
      throw new Error(`Subscribe ke ${topic} ditolak (credential perlu izin Subscribe untuk baruna/devices/#)`);
    }

    for (let i = 0; i < count; i++) {
      const payload = JSON.stringify({ ping: i, at: Date.now() });
      const start = performance.now();
      let timer: NodeJS.Timeout | undefined;
      let onMessage: ((t: string, p: Buffer) => void) | undefined;
      const arrived = new Promise<void>((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Pesan uji tidak kembali dalam ${timeoutMs / 1000} detik (izin Publish/Subscribe?)`)),
          timeoutMs,
        );
        onMessage = (t, p) => {
          if (t === topic && p.toString() === payload) resolve();
        };
        client!.on('message', onMessage);
      });
      try {
        await client.publishAsync(topic, payload, { qos: 1 });
        await arrived;
      } catch (err) {
        if (isNotAuthorized(err)) {
          result.publishDenied = true;
          break;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        if (onMessage) client.off('message', onMessage);
      }
      result.roundTripsMs.push(Math.round(performance.now() - start));
    }
    result.ok = true;
  } catch (err) {
    result.error = explainMqttError(err);
  } finally {
    await client?.endAsync(true).catch(() => {});
  }
  return result;
}

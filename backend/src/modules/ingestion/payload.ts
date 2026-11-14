import { z } from 'zod';
import { DEVICE_ID_PATTERN } from '../devices/schemas.js';

/**
 * MQTT payload contract (PRD §3.3), pure functions only.
 *   single : { "ts": "2026-11-10T07:30:00Z", "level": 285.4 }
 *   batch  : { "readings": [ { "ts": ..., "level": ... }, ... ] }
 * ts    : ISO-8601 (with offset) or epoch seconds (epoch milliseconds also accepted) → UTC
 * level : distance sensor → water surface in cm, 0–2000, rounded to 2 decimals
 */
export const MAX_LEVEL_CM = 2000;
export const MAX_BATCH = 500;
/** Readings dated in the future beyond this are rejected (device clock / NTP problem). */
export const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
/** Anything before this means the device clock was never set (ESP32 boots at 1970). */
export const MIN_VALID_TS = Date.UTC(2020, 0, 1);

export interface Reading {
  ts: Date;
  levelCm: number;
}

export type PayloadError =
  | { reason: 'invalid_json'; message: string }
  | { reason: 'invalid_payload'; message: string };

const Ts = z.union([
  z.iso.datetime({ offset: true }),
  z.number().finite().positive(),
]);
const Level = z.number().finite().min(0).max(MAX_LEVEL_CM);
const Item = z.object({ ts: Ts, level: Level });
const Body = z.union([Item, z.object({ readings: z.array(Item).min(1).max(MAX_BATCH) })]);

const toDate = (ts: string | number): Date =>
  typeof ts === 'string' ? new Date(ts) : new Date(ts > 1e12 ? ts : ts * 1000); // > 1e12 → already ms

/** Rounds to 2 decimals the way NUMERIC(7,2) stores it. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Parses a raw MQTT payload. Never throws. */
export function parsePayload(raw: Buffer | string): { ok: true; readings: Reading[] } | { ok: false; error: PayloadError } {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString());
  } catch {
    return { ok: false, error: { reason: 'invalid_json', message: 'Payload bukan JSON' } };
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!; // a failed parse always has at least one issue
    const where = issue.path.join('.') || '(root)';
    return { ok: false, error: { reason: 'invalid_payload', message: `${where}: ${issue.message}` } };
  }
  const items = 'readings' in parsed.data ? parsed.data.readings : [parsed.data];
  return { ok: true, readings: items.map((i) => ({ ts: toDate(i.ts), levelCm: round2(i.level) })) };
}

export type TimestampVerdict = { ok: true } | { ok: false; reason: 'ts_in_future' | 'ts_clock_unset' };

/** IN-4: rejects readings dated > 2 min ahead of the server, or before the clock was ever synced. */
export function validateTimestamp(ts: Date, now: Date): TimestampVerdict {
  if (ts.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) return { ok: false, reason: 'ts_in_future' };
  if (ts.getTime() < MIN_VALID_TS) return { ok: false, reason: 'ts_clock_unset' };
  return { ok: true };
}

const TOPIC = /^baruna\/devices\/([^/]+)\/readings$/;

/** deviceId from `baruna/devices/{id}/readings`, or null for any other topic / unsafe id. */
export function deviceIdFromTopic(topic: string): string | null {
  const id = TOPIC.exec(topic)?.[1];
  return id && DEVICE_ID_PATTERN.test(id) ? id : null;
}

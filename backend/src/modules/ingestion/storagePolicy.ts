/**
 * Storage policy (PRD §3.3). Decides whether a valid reading becomes a row in `readings`.
 * Presence is independent: every valid message updates last_seen_at whatever this returns.
 *
 *   S1 first     : nothing stored yet for the device
 *   backfill     : older than the last stored reading (re-sent after a disconnect) → keep
 *   S2 changed   : differs from the last stored value by more than deadband_cm (0 = any change at 2 decimals)
 *   S3 heartbeat : same value, but heartbeat_sec has passed since the last stored reading
 *   skip         : same value within the heartbeat window
 * Exact QoS 1 re-deliveries (same device, channel, ts) are dropped by the primary key, not here.
 */
export interface LastStored {
  levelCm: number;
  at: Date;
}

export interface StorageSettings {
  heartbeatSec: number;
  deadbandCm: number;
}

export type StoreDecision =
  | { store: true; reason: 'first' | 'backfill' | 'changed' | 'heartbeat' }
  | { store: false; reason: 'unchanged' };

/** Compare in hundredths (integers) so 285.1 vs 285.10000001 is "equal", as NUMERIC(7,2) would store it. */
const cents = (n: number) => Math.round(n * 100);

export function shouldStore(
  last: LastStored | null,
  reading: { ts: Date; levelCm: number },
  settings: StorageSettings,
): StoreDecision {
  if (!last) return { store: true, reason: 'first' };
  if (reading.ts.getTime() < last.at.getTime()) return { store: true, reason: 'backfill' };
  if (Math.abs(cents(reading.levelCm) - cents(last.levelCm)) > cents(settings.deadbandCm)) {
    return { store: true, reason: 'changed' };
  }
  if (reading.ts.getTime() - last.at.getTime() >= settings.heartbeatSec * 1000) {
    return { store: true, reason: 'heartbeat' };
  }
  return { store: false, reason: 'unchanged' };
}

/** The reference for the next decision moves only forward in time (backfill does not replace it). */
export function nextLastStored(last: LastStored | null, stored: { ts: Date; levelCm: number }): LastStored {
  if (!last || stored.ts.getTime() >= last.at.getTime()) return { levelCm: stored.levelCm, at: stored.ts };
  return last;
}

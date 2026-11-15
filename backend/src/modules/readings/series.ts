/**
 * History series (PRD RD-1..RD-3), pure functions.
 *
 * - Bucket size: ≥ 60 s and at most MAX_POINTS buckets (same rule as the frontend mock).
 * - A bucket with stored readings shows their average (date_bin in SQL).
 * - An empty bucket while the device was online shows the last known value (carry forward):
 *   unchanged values are deliberately not stored every minute, so "no row" means "same as before".
 * - An empty bucket while the device was offline shows null, so the chart draws a gap.
 */
export const MAX_POINTS = 600;
export const MIN_STEP_MS = 60_000;
export const DEFAULT_RANGE_MS = 24 * 3600_000;
export const MAX_RANGE_MS = 90 * 24 * 3600_000;

export interface Point {
  timestamp: string;
  distanceCm: number | null;
}

/** Bucket size: whole minutes, so that the range fits in MAX_POINTS buckets. */
export function pickStepMs(fromMs: number, toMs: number): number {
  return Math.max(MIN_STEP_MS, Math.ceil((toMs - fromMs) / MAX_POINTS / MIN_STEP_MS) * MIN_STEP_MS);
}

/** Bucket start containing t, aligned to the Unix epoch (same as date_bin(..., 'epoch')). */
export const bucketOf = (t: number, stepMs: number) => Math.floor(t / stepMs) * stepMs;

export interface PresenceEventLite {
  at: number;
  online: boolean;
}

/**
 * Offline intervals [start, end) from the event history.
 * - `before`: the last event before the range (null = none).
 * - `offlineSince`: the device is offline right now by the rule but no `timeout` event exists yet
 *   (worker down) — the interval from that moment is added.
 * Time before the very first `online` event (device not yet installed / never seen) is offline.
 */
export function offlineIntervals(
  before: PresenceEventLite | null,
  events: PresenceEventLite[],
  offlineSince: number | null,
): [number, number][] {
  const out: [number, number][] = [];
  const all = [...events].sort((a, b) => a.at - b.at);
  let state: boolean | null = before ? before.online : null;
  let since = -Infinity;

  if (state === null) {
    const first = all[0];
    // Never any event: we know nothing → no offline interval (carry forward from readings alone).
    if (!first) return offlineSince !== null ? [[offlineSince, Infinity]] : [];
    state = !first.online; // a first "online" event means the device was offline before it
  }
  for (const e of all) {
    if (e.online === state) continue;
    if (!state) out.push([since, e.at]); // offline → online
    else since = e.at; // online → offline
    state = e.online;
  }
  if (!state) out.push([since, Infinity]);
  else if (offlineSince !== null) out.push([offlineSince, Infinity]);
  return out;
}

const isOfflineDuring = (start: number, end: number, offline: [number, number][]) =>
  offline.some(([s, e]) => s <= start && e >= end); // the whole bucket was offline

/**
 * Builds the points for [fromMs, toMs). `averages`: bucket start → average of stored readings.
 * `initial`: last stored value before the range (carried into the first buckets).
 */
export function buildSeries(opts: {
  fromMs: number;
  toMs: number;
  stepMs: number;
  averages: Map<number, number>;
  initial: number | null;
  offline: [number, number][];
}): Point[] {
  const { fromMs, toMs, stepMs, averages, offline } = opts;
  const points: Point[] = [];
  let last = opts.initial;
  for (let b = bucketOf(fromMs, stepMs); b < toMs; b += stepMs) {
    const avg = averages.get(b);
    let value: number | null;
    if (avg !== undefined) {
      value = Math.round(avg * 100) / 100;
      last = value;
    } else if (isOfflineDuring(Math.max(b, fromMs), Math.min(b + stepMs, toMs), offline)) {
      value = null;
    } else {
      value = last;
    }
    points.push({ timestamp: new Date(b).toISOString(), distanceCm: value });
  }
  return points;
}

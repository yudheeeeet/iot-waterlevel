import { describe, expect, it } from 'vitest';
import { buildSeries, bucketOf, offlineIntervals, pickStepMs } from './series.js';

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.UTC(2026, 10, 14, 0, 0, 0);

describe('pickStepMs', () => {
  it('1 minute up to 10 hours; 24 h → 3 min (480 points); 90 days → whole minutes, ≤ 600 points', () => {
    expect(pickStepMs(T0, T0 + 10 * H)).toBe(MIN);
    expect(pickStepMs(T0, T0 + 24 * H)).toBe(3 * MIN);
    const step = pickStepMs(T0, T0 + 90 * 24 * H);
    expect(step % MIN).toBe(0);
    expect((90 * 24 * H) / step).toBeLessThanOrEqual(600);
  });
});

describe('offlineIntervals', () => {
  const on = (at: number) => ({ at, online: true });
  const off = (at: number) => ({ at, online: false });

  it('no events at all → nothing known, unless the device is offline now', () => {
    expect(offlineIntervals(null, [], null)).toEqual([]);
    expect(offlineIntervals(null, [], T0)).toEqual([[T0, Infinity]]);
  });
  it('before the first online event the device was offline', () => {
    expect(offlineIntervals(null, [on(T0)], null)).toEqual([[-Infinity, T0]]);
  });
  it('online → timeout → online', () => {
    expect(offlineIntervals(on(T0 - H), [off(T0), on(T0 + H)], null)).toEqual([[T0, T0 + H]]);
  });
  it('still offline at the end; repeated states ignored', () => {
    expect(offlineIntervals(on(T0 - H), [off(T0), off(T0 + 1)], null)).toEqual([[T0, Infinity]]);
  });
  it('last event before the range was offline', () => {
    expect(offlineIntervals(off(T0 - H), [on(T0)], null)).toEqual([[-Infinity, T0]]);
  });
  it('online now per events, but offline by the rule (worker down) → open interval', () => {
    expect(offlineIntervals(on(T0 - H), [], T0)).toEqual([[T0, Infinity]]);
  });
});

describe('buildSeries', () => {
  const series = (averages: [number, number][], opts: Partial<Parameters<typeof buildSeries>[0]> = {}) =>
    buildSeries({ fromMs: T0, toMs: T0 + 5 * MIN, stepMs: MIN, averages: new Map(averages), initial: null, offline: [], ...opts }).map(
      (p) => p.distanceCm,
    );

  it('constant level (only the first row stored) → flat line, not gaps', () => {
    expect(series([[T0, 250]])).toEqual([250, 250, 250, 250, 250]);
  });
  it('carries the last value from before the range', () => {
    expect(series([[T0 + 2 * MIN, 240]], { initial: 250 })).toEqual([250, 250, 240, 240, 240]);
  });
  it('offline buckets are null; data resumes after', () => {
    expect(series([[T0, 250], [T0 + 4 * MIN, 230]], { offline: [[T0 + MIN, T0 + 4 * MIN]] })).toEqual([250, null, null, null, 230]);
  });
  it('no data and nothing before → null (device not seen yet)', () => {
    expect(series([])).toEqual([null, null, null, null, null]);
  });
  it('a bucket only partly offline keeps the carried value', () => {
    expect(series([[T0, 250]], { offline: [[T0 + MIN + 30_000, Infinity]] })).toEqual([250, 250, null, null, null]);
  });
  it('averages are rounded to 2 decimals; timestamps are bucket starts in ISO', () => {
    const pts = buildSeries({ fromMs: T0 + 10_000, toMs: T0 + 2 * MIN, stepMs: MIN, averages: new Map([[T0, 250.12345]]), initial: null, offline: [] });
    expect(pts).toEqual([
      { timestamp: new Date(T0).toISOString(), distanceCm: 250.12 },
      { timestamp: new Date(T0 + MIN).toISOString(), distanceCm: 250.12 },
    ]);
    expect(bucketOf(T0 + 59_999, MIN)).toBe(T0);
  });
});

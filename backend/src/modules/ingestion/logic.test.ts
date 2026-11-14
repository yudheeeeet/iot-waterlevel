import { describe, expect, it } from 'vitest';
import { deviceIdFromTopic, parsePayload, round2, validateTimestamp } from './payload.js';
import { computeStatus } from './status.js';
import { nextLastStored, shouldStore } from './storagePolicy.js';

const T = (iso: string) => new Date(iso);

describe('parsePayload', () => {
  it('single reading, ISO with offset → UTC, level rounded to 2 decimals', () => {
    const r = parsePayload('{"ts":"2026-11-10T14:30:00+07:00","level":285.456}');
    expect(r).toEqual({ ok: true, readings: [{ ts: T('2026-11-10T07:30:00Z'), levelCm: 285.46 }] });
  });

  it('epoch seconds and epoch milliseconds', () => {
    const s = parsePayload(JSON.stringify({ ts: 1794600000, level: 100 }));
    const ms = parsePayload(Buffer.from(JSON.stringify({ ts: 1794600000000, level: 100 })));
    expect(s.ok && s.readings[0]!.ts.getTime()).toBe(1794600000000);
    expect(ms.ok && ms.readings[0]!.ts.getTime()).toBe(1794600000000);
  });

  it('batch', () => {
    const r = parsePayload(JSON.stringify({ readings: [{ ts: 1794600000, level: 1 }, { ts: 1794600060, level: 2 }] }));
    expect(r.ok && r.readings.map((x) => x.levelCm)).toEqual([1, 2]);
  });

  it('very small distance (water near the sensor) is accepted', () => {
    const r = parsePayload('{"ts":1794600000,"level":0}');
    expect(r.ok && r.readings[0]!.levelCm).toBe(0);
    expect(parsePayload('{"ts":1794600000,"level":0.4}').ok).toBe(true);
  });

  it('invalid payloads → structured errors, never throws', () => {
    const cases: [string, string][] = [
      ['not json', 'invalid_json'],
      ['', 'invalid_json'],
      ['null', 'invalid_payload'],
      ['{"ts":1794600000}', 'invalid_payload'],
      ['{"ts":1794600000,"level":-1}', 'invalid_payload'],
      ['{"ts":1794600000,"level":2000.5}', 'invalid_payload'],
      ['{"ts":"10/11/2026","level":10}', 'invalid_payload'],
      ['{"ts":"2026-11-10T07:30:00","level":10}', 'invalid_payload'], // no offset → ambiguous
      ['{"ts":1794600000,"level":"10"}', 'invalid_payload'],
      ['{"readings":[]}', 'invalid_payload'],
    ];
    for (const [raw, reason] of cases) {
      const r = parsePayload(raw);
      expect(r.ok, raw).toBe(false);
      if (!r.ok) {
        expect(r.error.reason, raw).toBe(reason);
        expect(r.error.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('round2', () => {
    expect(round2(285.455)).toBeCloseTo(285.46, 5);
    expect(round2(10)).toBe(10);
  });
});

describe('validateTimestamp', () => {
  const now = T('2026-11-14T10:00:00Z');
  it('accepts up to 2 minutes ahead; rejects beyond', () => {
    expect(validateTimestamp(T('2026-11-14T10:02:00Z'), now)).toEqual({ ok: true });
    expect(validateTimestamp(T('2026-11-14T10:02:01Z'), now)).toEqual({ ok: false, reason: 'ts_in_future' });
  });
  it('accepts old readings (backfill) but rejects an unset device clock', () => {
    expect(validateTimestamp(T('2026-11-01T00:00:00Z'), now)).toEqual({ ok: true });
    expect(validateTimestamp(new Date(30_000), now)).toEqual({ ok: false, reason: 'ts_clock_unset' });
  });
});

describe('deviceIdFromTopic', () => {
  it('extracts the id only from the readings topic', () => {
    expect(deviceIdFromTopic('baruna/devices/BWN-001/readings')).toBe('BWN-001');
    expect(deviceIdFromTopic('baruna/devices/BWN-001/status')).toBeNull();
    expect(deviceIdFromTopic('baruna/devices/a.b/readings')).toBeNull();
    expect(deviceIdFromTopic('other/BWN-001/readings')).toBeNull();
  });
});

describe('shouldStore', () => {
  const settings = { heartbeatSec: 900, deadbandCm: 0 };
  const last = { levelCm: 250, at: T('2026-11-14T10:00:00Z') };

  it('S1: first reading', () => {
    expect(shouldStore(null, { ts: T('2026-11-14T10:00:00Z'), levelCm: 250 }, settings)).toEqual({ store: true, reason: 'first' });
  });
  it('S2: any change at 2 decimals', () => {
    expect(shouldStore(last, { ts: T('2026-11-14T10:01:00Z'), levelCm: 250.01 }, settings).reason).toBe('changed');
    expect(shouldStore(last, { ts: T('2026-11-14T10:01:00Z'), levelCm: 249.99 }, settings).reason).toBe('changed');
  });
  it('same value (incl. float noise below 2 decimals) within the heartbeat → skip', () => {
    expect(shouldStore(last, { ts: T('2026-11-14T10:14:59Z'), levelCm: 250.004 }, settings)).toEqual({ store: false, reason: 'unchanged' });
  });
  it('S3: same value after heartbeat_sec → store', () => {
    expect(shouldStore(last, { ts: T('2026-11-14T10:15:00Z'), levelCm: 250 }, settings)).toEqual({ store: true, reason: 'heartbeat' });
  });
  it('older re-sent reading is kept (backfill)', () => {
    expect(shouldStore(last, { ts: T('2026-11-14T09:59:00Z'), levelCm: 250 }, settings)).toEqual({ store: true, reason: 'backfill' });
  });
  it('deadband: changes up to deadband_cm are skipped, larger ones stored', () => {
    const db = { heartbeatSec: 900, deadbandCm: 0.5 };
    expect(shouldStore(last, { ts: T('2026-11-14T10:01:00Z'), levelCm: 250.5 }, db).store).toBe(false);
    expect(shouldStore(last, { ts: T('2026-11-14T10:01:00Z'), levelCm: 250.51 }, db).store).toBe(true);
  });
  it('constant level for an hour at 1/min → 5 rows (first + 4 heartbeats)', () => {
    let ref: { levelCm: number; at: Date } | null = null;
    let rows = 0;
    for (let m = 0; m < 60; m++) {
      const reading = { ts: new Date(T('2026-11-14T10:00:00Z').getTime() + m * 60_000), levelCm: 250 };
      if (shouldStore(ref, reading, settings).store) {
        rows++;
        ref = nextLastStored(ref, reading);
      }
    }
    expect(rows).toBe(4); // 10:00, 10:15, 10:30, 10:45 (11:00 is outside the hour)
  });
});

describe('nextLastStored', () => {
  const last = { levelCm: 250, at: T('2026-11-14T10:00:00Z') };
  it('moves forward, never backward', () => {
    expect(nextLastStored(null, { ts: T('2026-11-14T10:00:00Z'), levelCm: 1 })).toEqual({ levelCm: 1, at: T('2026-11-14T10:00:00Z') });
    expect(nextLastStored(last, { ts: T('2026-11-14T10:05:00Z'), levelCm: 2 })).toEqual({ levelCm: 2, at: T('2026-11-14T10:05:00Z') });
    expect(nextLastStored(last, { ts: T('2026-11-14T09:00:00Z'), levelCm: 3 })).toBe(last);
  });
});

describe('computeStatus', () => {
  const t = { warningCm: 200, criticalCm: 100 };
  it('distance thresholds: smaller distance = higher water', () => {
    expect(computeStatus(99.99, t)).toBe('critical');
    expect(computeStatus(100, t)).toBe('warning');
    expect(computeStatus(199.99, t)).toBe('warning');
    expect(computeStatus(200, t)).toBe('normal');
    expect(computeStatus(0, t)).toBe('critical');
  });
});

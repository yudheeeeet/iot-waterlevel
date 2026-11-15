import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { Sql } from '../../db/client.js';
import { createTestSql, hasTestDb, resetTestDb } from '../../test/testDb.js';
import { signAccessToken, type AuthConfig } from '../identity/tokens.js';

const cfg: AuthConfig = { jwtSecret: 'k'.repeat(40), accessTtlSec: 900, refreshTtlDays: 7, cookieSecure: false };
const MIN = 60_000;

describe.skipIf(!hasTestDb)('readings history (DB)', () => {
  let sql: Sql;
  let app: FastifyInstance;
  let token: string;
  // Fixed, minute-aligned "now" for deterministic buckets.
  const now = Math.floor(Date.now() / MIN) * MIN;
  const iso = (ms: number) => new Date(ms).toISOString();

  beforeAll(async () => {
    sql = createTestSql();
    await resetTestDb(sql);
    const [u] = await sql`insert into users (email, name, role, password_hash) values ('v@t.local', 'V', 'viewer', 'x') returning id`;
    token = await signAccessToken({ id: u!.id as string, role: 'viewer' }, cfg);
    app = await buildApp({ deps: { checkDb: async () => true, sql, auth: cfg } });

    // PER-MIN: a reading every minute for 24 h, online the whole time.
    await sql`insert into devices (id, name, lat, lon, last_seen_at) values ('PER-MIN', 'p', -6.6, 106.8, now())`;
    await sql`
      insert into readings (device_id, ts, level_cm, status)
      select 'PER-MIN', ts, 200 + (extract(minute from ts)::int % 10), 'normal'
      from generate_series(${new Date(now - 24 * 60 * MIN)}::timestamptz, ${new Date(now - MIN)}::timestamptz, interval '1 minute') ts`;
    await sql`insert into device_status_events (device_id, online, reason, at) values ('PER-MIN', true, 'reading', ${new Date(now - 24 * 60 * MIN)})`;

    // GAP: online, one stored row (constant), offline for 20 min, back online with a new value.
    await sql`insert into devices (id, name, lat, lon, last_seen_at) values ('GAP', 'g', -6.6, 106.8, now())`;
    await sql`insert into readings (device_id, ts, level_cm, status) values
      ('GAP', ${new Date(now - 60 * MIN)}, 250, 'normal'),
      ('GAP', ${new Date(now - 20 * MIN)}, 240, 'normal')`;
    await sql`insert into device_status_events (device_id, online, reason, at) values
      ('GAP', true,  'reading', ${new Date(now - 60 * MIN)}),
      ('GAP', false, 'timeout', ${new Date(now - 45 * MIN)}),
      ('GAP', true,  'reading', ${new Date(now - 20 * MIN)})`;
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  const get = (id: string, query: Record<string, string> = {}, auth = true) =>
    app.inject({ method: 'GET', url: `/api/devices/${id}/readings`, query, headers: auth ? { authorization: `Bearer ${token}` } : {} });

  it('24 h of per-minute data → ≤ 600 points, 3-minute buckets, same shape as the mock', async () => {
    const res = await get('PER-MIN', { from: iso(now - 24 * 60 * MIN), to: iso(now) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['deviceId', 'intervalSec', 'points']);
    expect(body.deviceId).toBe('PER-MIN');
    expect(body.intervalSec).toBe(180);
    expect(body.points.length).toBeLessThanOrEqual(600);
    expect(body.points.length).toBeGreaterThanOrEqual(480);
    expect(Object.keys(body.points[1]).sort()).toEqual(['distanceCm', 'timestamp']);
    expect(body.points.every((p: { distanceCm: number | null }) => typeof p.distanceCm === 'number')).toBe(true);
    // average of 3 consecutive minutes of 200 + (minute % 10) stays within 200..209
    expect(body.points.every((p: { distanceCm: number }) => p.distanceCm >= 200 && p.distanceCm <= 209)).toBe(true);
  });

  it('constant period is a flat line; offline period is null; values resume afterwards', async () => {
    const res = await get('GAP', { from: iso(now - 60 * MIN), to: iso(now) });
    const pts: { timestamp: string; distanceCm: number | null }[] = res.json().points;
    expect(res.json().intervalSec).toBe(60);
    const at = (minAgo: number) => pts.find((p) => p.timestamp === iso(now - minAgo * MIN))!.distanceCm;
    expect(at(60)).toBe(250);
    expect(at(50)).toBe(250); // carried forward: nothing stored, device online
    expect(at(40)).toBeNull(); // offline
    expect(at(21)).toBeNull();
    expect(at(20)).toBe(240);
    expect(at(1)).toBe(240);
  });

  it('device offline by the rule without a timeout event (worker down) → null after the window', async () => {
    await sql`insert into devices (id, name, lat, lon, last_seen_at) values ('STALE', 's', -6.6, 106.8, ${new Date(now - 30 * MIN)})`;
    await sql`insert into readings (device_id, ts, level_cm, status) values ('STALE', ${new Date(now - 30 * MIN)}, 300, 'normal')`;
    await sql`insert into device_status_events (device_id, online, reason, at) values ('STALE', true, 'reading', ${new Date(now - 30 * MIN)})`;
    const pts: { timestamp: string; distanceCm: number | null }[] = (await get('STALE', { from: iso(now - 30 * MIN), to: iso(now) })).json().points;
    const at = (minAgo: number) => pts.find((p) => p.timestamp === iso(now - minAgo * MIN))!.distanceCm;
    expect(at(30)).toBe(300);
    expect(at(26)).toBe(300); // within the 5-minute window
    expect(at(24)).toBeNull(); // offline since last_seen + 300 s
  });

  it('default range is the last 24 h; no points in the future', async () => {
    const body = (await get('PER-MIN')).json();
    expect(body.intervalSec).toBe(180);
    const future = await get('PER-MIN', { from: iso(now + 60 * MIN), to: iso(now + 120 * MIN) });
    expect(future.json().points).toEqual([]);
  });

  it('validation: from ≥ to, > 90 days, bad dates → 400; unknown device → 404; no login → 401', async () => {
    expect((await get('PER-MIN', { from: iso(now), to: iso(now - MIN) })).statusCode).toBe(400);
    const long = await get('PER-MIN', { from: iso(now - 91 * 24 * 60 * MIN), to: iso(now) });
    expect(long.statusCode).toBe(400);
    expect(long.json().error.details[0].message).toContain('90 hari');
    expect((await get('PER-MIN', { from: 'kemarin' })).statusCode).toBe(400);
    expect((await get('NOPE')).statusCode).toBe(404);
    expect((await get('PER-MIN', {}, false)).statusCode).toBe(401);
  });
});

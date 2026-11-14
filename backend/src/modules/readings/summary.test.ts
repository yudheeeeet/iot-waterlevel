import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { Sql } from '../../db/client.js';
import { createTestSql, hasTestDb, resetTestDb } from '../../test/testDb.js';
import { signAccessToken, type AuthConfig } from '../identity/tokens.js';
import { weatherCacheKey, type WeatherConfig } from '../weather/service.js';

const cfg: AuthConfig = { jwtSecret: 'k'.repeat(40), accessTtlSec: 900, refreshTtlDays: 7, cookieSecure: false };
const weather: WeatherConfig = {
  locationName: 'Bogor', lat: -6.595, lon: 106.797, bmkgAdm4: '32.71.03.1002', bmkgBaseUrl: 'https://x.test', openMeteoUrl: 'https://y.test',
};

describe.skipIf(!hasTestDb)('GET /api/summary (DB)', () => {
  let sql: Sql;
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    sql = createTestSql();
    await resetTestDb(sql);
    const [u] = await sql`insert into users (email, name, role, password_hash) values ('v@t.local', 'V', 'viewer', 'x') returning id`;
    token = await signAccessToken({ id: u!.id as string, role: 'viewer' }, cfg);
    app = await buildApp({ deps: { checkDb: async () => true, sql, auth: cfg, weather } });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  const get = async () => {
    const res = await app.inject({ method: 'GET', url: '/api/summary', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  it('no devices → zeros and nulls, mock shape', async () => {
    const s = await get();
    expect(Object.keys(s).sort()).toEqual(['averageDistanceM', 'devices', 'lastUpdate', 'latestReading', 'rainfallTodayMm']);
    expect(s).toMatchObject({ averageDistanceM: null, devices: { total: 0, online: 0, offline: 0 }, latestReading: null, rainfallTodayMm: null });
  });

  it('average only over online devices with a reading; latest among online', async () => {
    await sql`insert into devices (id, name, lat, lon, last_seen_at, last_reading_cm, last_reading_at) values
      ('A', 'a', -6.6, 106.8, now(), 250, now() - interval '2 minutes'),
      ('B', 'b', -6.6, 106.8, now(), 150, now() - interval '1 minute'),
      ('OFF', 'o', -6.6, 106.8, now() - interval '1 hour', 10, now() - interval '30 seconds'),
      ('NEW', 'n', -6.6, 106.8, null, null, null)`;
    await sql`insert into devices (id, name, lat, lon, deleted_at) values ('GONE', 'g', -6.6, 106.8, now())`;
    const s = await get();
    expect(s.devices).toEqual({ total: 4, online: 2, offline: 2 });
    expect(s.averageDistanceM).toBe(2); // (250 + 150) / 2 cm = 2.00 m; OFF and NEW excluded
    expect(s.latestReading).toMatchObject({ deviceId: 'B', distanceCm: 150 });
    expect(Object.keys(s.latestReading).sort()).toEqual(['deviceId', 'distanceCm', 'timestamp']);
  });

  it('rainfallTodayMm comes from today\'s weather cache, not an old one', async () => {
    const payload = (fetchedAt: Date) => ({ today: { rainfallMm: 4.4 }, fetchedAt: fetchedAt.toISOString() });
    await sql`insert into weather_cache (cache_key, payload, fetched_at, expires_at)
      values (${weatherCacheKey(weather)}, ${sql.json(payload(new Date()))}, now(), now() + interval '30 minutes')`;
    expect((await get()).rainfallTodayMm).toBe(4.4);
    await sql`update weather_cache set payload = ${sql.json(payload(new Date(Date.now() - 2 * 86_400_000)))}`;
    expect((await get()).rainfallTodayMm).toBeNull();
  });
});

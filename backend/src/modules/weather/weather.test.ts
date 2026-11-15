import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { Sql } from '../../db/client.js';
import { createTestSql, hasTestDb, resetTestDb } from '../../test/testDb.js';
import { signAccessToken, type AuthConfig } from '../identity/tokens.js';
import { jakartaDateKey, mergeWeather } from './merge.js';
import { parseBmkg, parseOpenMeteo } from './sources.js';
import type { WeatherConfig } from './service.js';

// Real responses recorded on 2026-11-15 ~05:15 WIB (Kel. Paledang, Bogor).
const bmkgJson = JSON.parse(readFileSync(new URL('./fixtures/bmkg-paledang.json', import.meta.url), 'utf8'));
const omJson = JSON.parse(readFileSync(new URL('./fixtures/open-meteo-bogor.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-15T05:15:00+07:00').getTime();

describe('mergeWeather (recorded responses)', () => {
  const bmkg = parseBmkg(bmkgJson);
  const om = parseOpenMeteo(omJson);

  it('days 1–3 from BMKG, days 4–7 from Open-Meteo; feels-like from Open-Meteo', () => {
    const w = mergeWeather(bmkg, om, NOW, 'Bogor');
    expect(w.location).toBe('Bogor');
    expect(w.forecast).toHaveLength(7);
    expect(w.forecast.map((f) => f.date)).toEqual([
      '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21',
    ]);
    expect(w.forecast.map((f) => f.source)).toEqual(['BMKG', 'BMKG', 'BMKG', 'Open-Meteo', 'Open-Meteo', 'Open-Meteo', 'Open-Meteo']);
    expect(w.today.source).toBe('BMKG');
    expect(w.today.feelsLikeC).toBe(28);
    expect(w.today.rainfallSource).toBe('BMKG');
    expect(w.sources).toEqual(['BMKG', 'Open-Meteo']);
    expect(Object.keys(w).sort()).toEqual(['fetchedAt', 'forecast', 'location', 'sources', 'today']);
    expect(Object.keys(w.today).sort()).toEqual(
      ['condition', 'feelsLikeC', 'humidity', 'icon', 'rainfallMm', 'rainfallSource', 'source', 'temperatureC', 'updatedAt', 'windMs'],
    );
  });

  it('BMKG unavailable → Open-Meteo covers all 7 days', () => {
    const w = mergeWeather(null, om, NOW, 'Bogor');
    expect(w.forecast.every((f) => f.source === 'Open-Meteo')).toBe(true);
    expect(w.today).toMatchObject({ source: 'Open-Meteo', temperatureC: 25, feelsLikeC: 28, rainfallSource: 'Open-Meteo' });
    expect(w.sources).toEqual(['Open-Meteo']);
  });

  it('Open-Meteo unavailable → BMKG days 1–3, empty placeholders after; no feels-like', () => {
    const w = mergeWeather(bmkg, null, NOW, 'Bogor');
    expect(w.forecast.slice(3).every((f) => f.source === null && f.condition === '—')).toBe(true);
    expect(w.today.feelsLikeC).toBeNull();
  });

  it('both unavailable → throws; BMKG km/h converted to m/s; WIB date key', () => {
    expect(() => mergeWeather(null, null, NOW, 'Bogor')).toThrow();
    expect(bmkg[0]!.windMs).toBe(1); // 3.6 km/h
    expect(jakartaDateKey(Date.UTC(2026, 10, 14, 17, 30))).toBe('2026-11-15'); // 00:30 WIB
    expect(() => parseBmkg({ data: [] })).toThrow('no forecast slots');
  });
});

describe.skipIf(!hasTestDb)('GET /api/weather (cache in DB)', () => {
  const cfg: AuthConfig = { jwtSecret: 'k'.repeat(40), accessTtlSec: 900, refreshTtlDays: 7, cookieSecure: false };
  const weather: WeatherConfig = {
    locationName: 'Bogor',
    lat: -6.595,
    lon: 106.797,
    bmkgAdm4: '32.71.03.1002',
    bmkgBaseUrl: 'https://bmkg.test',
    openMeteoUrl: 'https://om.test/v1/forecast',
  };
  let sql: Sql;
  let token: string;
  let calls: string[];
  let fail: { bmkg: boolean; om: boolean };

  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const source = url.startsWith('https://bmkg.test') ? 'bmkg' : 'om';
    calls.push(source);
    if (fail[source]) return new Response('down', { status: 502 });
    return new Response(JSON.stringify(source === 'bmkg' ? bmkgJson : omJson), { status: 200 });
  }) as typeof fetch;

  beforeAll(async () => {
    sql = createTestSql();
    await resetTestDb(sql);
    const [u] = await sql`insert into users (email, name, role, password_hash) values ('v@t.local', 'V', 'viewer', 'x') returning id`;
    token = await signAccessToken({ id: u!.id as string, role: 'viewer' }, cfg);
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });
  beforeEach(async () => {
    calls = [];
    fail = { bmkg: false, om: false };
    await sql`delete from weather_cache`;
  });

  const get = async (auth = true) => {
    const app = await buildApp({ deps: { checkDb: async () => true, sql, auth: cfg, weather, fetch: fakeFetch } });
    return app.inject({ method: 'GET', url: '/api/weather', headers: auth ? { authorization: `Bearer ${token}` } : {} });
  };

  it('two requests within 30 minutes → one call to each source', async () => {
    const a = await get();
    expect(a.statusCode).toBe(200);
    expect(a.json().forecast).toHaveLength(7);
    const b = await get();
    expect(b.json()).toEqual(a.json());
    expect(calls.sort()).toEqual(['bmkg', 'om']);
  });

  it('expired cache is refreshed', async () => {
    await get();
    await sql`update weather_cache set expires_at = now() - interval '1 second'`;
    await get();
    expect(calls).toHaveLength(4);
  });

  it('BMKG down (bad URL / 5xx) → Open-Meteo for all 7 days', async () => {
    fail.bmkg = true;
    const body = (await get()).json();
    expect(body.forecast.every((f: { source: string }) => f.source === 'Open-Meteo')).toBe(true);
  });

  it('both down: old cache served with stale=true; no cache → 503', async () => {
    fail = { bmkg: true, om: true };
    const none = await get();
    expect(none.statusCode).toBe(503);
    expect(none.json().error.code).toBe('WEATHER_UNAVAILABLE');

    fail = { bmkg: false, om: false };
    await get();
    await sql`update weather_cache set expires_at = now() - interval '1 second'`;
    fail = { bmkg: true, om: true };
    const stale = await get();
    expect(stale.statusCode).toBe(200);
    expect(stale.json().stale).toBe(true);
  });

  it('requires login', async () => {
    expect((await get(false)).statusCode).toBe(401);
  });
});

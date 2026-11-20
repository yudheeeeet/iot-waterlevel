import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { Sql } from '../../db/client.js';
import { createTestSql, hasTestDb, resetTestDb } from '../../test/testDb.js';
import { signAccessToken, type AuthConfig } from '../identity/tokens.js';
import { waterLevelCm, wib } from './export.js';

const cfg: AuthConfig = { jwtSecret: 'k'.repeat(40), accessTtlSec: 900, refreshTtlDays: 7, cookieSecure: false };
const MIN = 60_000;

describe('wib', () => {
  it('formats in Asia/Jakarta', () => {
    expect(wib(new Date('2026-11-14T17:30:05Z'))).toBe('2026-11-15 00:30:05');
  });
});

describe('waterLevelCm', () => {
  it('height − distance, 1 decimal; 0 when the distance exceeds the height; null without a height', () => {
    expect(waterLevelCm(1000, 181.1)).toBe(818.9);
    expect(waterLevelCm(300, 285.4)).toBe(14.6);
    expect(waterLevelCm(100, 150)).toBe(0);
    expect(waterLevelCm(null, 150)).toBeNull();
  });
});

describe.skipIf(!hasTestDb)('GET /api/devices/:id/readings/export (DB)', () => {
  let sql: Sql;
  let app: FastifyInstance;
  const tokens: Record<string, string> = {};
  const t0 = new Date('2026-11-14T00:00:00Z').getTime();

  beforeAll(async () => {
    sql = createTestSql();
    await resetTestDb(sql);
    for (const role of ['admin', 'viewer'] as const) {
      const [u] = await sql`insert into users (email, name, role, password_hash) values (${role + '@t.local'}, ${role}, ${role}, 'x') returning id`;
      tokens[role] = await signAccessToken({ id: u!.id as string, role }, cfg);
    }
    app = await buildApp({ deps: { checkDb: async () => true, sql, auth: cfg } });
    await sql`insert into devices (id, name, lat, lon) values ('EXP-1', 'e', -6.6, 106.8), ('BULK', 'b', -6.6, 106.8)`;
    await sql`insert into devices (id, name, lat, lon, sensor_height_cm) values ('EXP-H', 'h', -6.6, 106.8, 300)`;
    await sql`insert into readings (device_id, ts, level_cm, status) values
      ('EXP-1', ${new Date(t0)}, 285.4, 'normal'),
      ('EXP-1', ${new Date(t0 + MIN)}, 99.5, 'critical'),
      ('EXP-1', ${new Date(t0 + 2 * MIN)}, 150, 'warning'),
      ('EXP-H', ${new Date(t0)}, 285.4, 'normal'),
      ('EXP-H', ${new Date(t0 + MIN)}, 99.5, 'critical')`;
    // 30 days, one row per minute
    await sql`
      insert into readings (device_id, ts, level_cm, status)
      select 'BULK', ts, 200 + random() * 10, 'normal'
      from generate_series(${new Date(t0 - 30 * 24 * 60 * MIN)}::timestamptz, ${new Date(t0 - MIN)}::timestamptz, interval '1 minute') ts`;
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  const get = (id: string, query: Record<string, string>, role: 'admin' | 'viewer' = 'viewer') =>
    app.inject({ method: 'GET', url: `/api/devices/${id}/readings/export`, query, headers: { authorization: `Bearer ${tokens[role]}` } });
  const range = { from: new Date(t0).toISOString(), to: new Date(t0 + 10 * MIN).toISOString() };

  it('CSV: BOM, header, WIB time, one line per stored reading, attachment filename', async () => {
    const res = await get('EXP-1', { ...range, format: 'csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="EXP-1_readings_2026-11-14_2026-11-14.csv"');
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    const lines = res.body.slice(1).trim().split('\r\n');
    expect(lines).toEqual([
      'device_id,waktu_wib,timestamp_utc,distance_cm,distance_m,water_level_cm,status',
      'EXP-1,2026-11-14 07:00:00,2026-11-14T00:00:00.000Z,285.4,2.854,,normal',
      'EXP-1,2026-11-14 07:01:00,2026-11-14T00:01:00.000Z,99.5,0.995,,critical',
      'EXP-1,2026-11-14 07:02:00,2026-11-14T00:02:00.000Z,150,1.5,,warning',
    ]);
  });

  it('water_level_cm = sensor height − distance when the device has a sensor height (CSV and XLSX)', async () => {
    const csv = await get('EXP-H', { ...range, format: 'csv' });
    expect(csv.body.slice(1).trim().split('\r\n').slice(1)).toEqual([
      'EXP-H,2026-11-14 07:00:00,2026-11-14T00:00:00.000Z,285.4,2.854,14.6,normal',
      'EXP-H,2026-11-14 07:01:00,2026-11-14T00:01:00.000Z,99.5,0.995,200.5,critical',
    ]);
    const res = await get('EXP-H', { ...range, format: 'xlsx' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Readings')!.getRow(2).values).toEqual(
      [undefined, 'EXP-H', '2026-11-14 07:00:00', '2026-11-14T00:00:00.000Z', 285.4, 2.854, 14.6, 'normal'],
    );
  });

  it('XLSX (admin and viewer): opens with the same rows plus an Info sheet', async () => {
    for (const role of ['admin', 'viewer'] as const) {
      const res = await get('EXP-1', { ...range, format: 'xlsx' }, role);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-disposition']).toContain('.xlsx"');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
      const ws = wb.getWorksheet('Readings')!;
      expect(ws.getRow(1).values).toEqual([undefined, 'device_id', 'waktu_wib', 'timestamp_utc', 'distance_cm', 'distance_m', 'water_level_cm', 'status']);
      expect(ws.getRow(3).values).toEqual([undefined, 'EXP-1', '2026-11-14 07:01:00', '2026-11-14T00:01:00.000Z', 99.5, 0.995, undefined, 'critical']);
      expect(ws.rowCount).toBe(4);
      expect(wb.getWorksheet('Info')!.getRow(1).values).toEqual([undefined, 'Device', 'EXP-1']);
    }
  });

  it('unknown format → 400; > 90 days → 400; unknown device → 404', async () => {
    const bad = await get('EXP-1', { ...range, format: 'pdf' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details[0].field).toBe('format');
    expect((await get('EXP-1', { from: new Date(t0 - 91 * 86_400_000).toISOString(), to: new Date(t0).toISOString() })).statusCode).toBe(400);
    expect((await get('NOPE', range)).statusCode).toBe(404);
  });

  it('30 days of per-minute data (43 200 rows) exports quickly', async () => {
    const q = { from: new Date(t0 - 30 * 86_400_000).toISOString(), to: new Date(t0).toISOString() };
    for (const format of ['csv', 'xlsx']) {
      const start = performance.now();
      const res = await get('BULK', { ...q, format });
      const ms = performance.now() - start;
      expect(res.statusCode).toBe(200);
      if (format === 'csv') expect(res.body.trim().split('\r\n')).toHaveLength(43_201);
      console.log(`export 30 days ${format}: ${Math.round(ms)} ms, ${(res.rawPayload.length / 1024).toFixed(0)} KB`);
      expect(ms).toBeLessThan(10_000);
    }
  }, 30_000);
});

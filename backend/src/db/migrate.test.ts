import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { createTestSql, hasTestDb, resetTestDb } from '../test/testDb.js';
import type { Sql } from './client.js';

describe.skipIf(!hasTestDb)('migrations (DB)', () => {
  let sql: Sql;
  beforeAll(async () => {
    sql = createTestSql();
    await resetTestDb(sql);
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('creates every MVP table including the prepared columns', async () => {
    const tables = await sql<{ t: string }[]>`
      select table_name as t from information_schema.tables where table_schema = 'public' order by 1`;
    expect(tables.map((r) => r.t)).toEqual(
      expect.arrayContaining([
        'users', 'refresh_tokens', 'devices', 'device_tokens', 'readings', 'device_status_events',
        'device_time_sync', 'weather_cache', 'worker_status', 'schema_migrations',
      ]),
    );
    const cols = await sql<{ c: string }[]>`
      select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public'`;
    expect(cols.map((r) => r.c)).toEqual(
      expect.arrayContaining(['devices.sensor_count', 'devices.deadband_cm', 'devices.location_source', 'readings.channel']),
    );
  });

  it('readings primary key is (device_id, channel, ts)', async () => {
    const pk = await sql<{ col: string }[]>`
      select a.attname as col
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'readings'::regclass and i.indisprimary
      order by array_position(i.indkey, a.attnum)`;
    expect(pk.map((r) => r.col)).toEqual(['device_id', 'channel', 'ts']);
  });

  it('is safe to run twice', async () => {
    expect(await migrate(sql, () => {})).toEqual([]);
  });

  it('rejects device ids that are unsafe for MQTT topics', async () => {
    await expect(sql`insert into devices (id, name, lat, lon) values ('bad/id', 'x', 0, 0)`).rejects.toThrow();
    await expect(sql`insert into devices (id, name, lat, lon) values ('BWN-001', 'ok', -6.6, 106.8)`).resolves.toBeDefined();
  });
});

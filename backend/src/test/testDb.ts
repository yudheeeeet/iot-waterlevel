import { existsSync } from 'node:fs';
import { createSql, type Sql } from '../db/client.js';
import { migrate } from '../db/migrate.js';

/**
 * Integration tests run against TEST_DATABASE_URL (local `baruna_test`), never against DATABASE_URL.
 * When it is not configured, DB tests are skipped (describe.skipIf(!hasTestDb)).
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.TEST_DATABASE_URL ?? '';
export const hasTestDb = /^postgres(ql)?:\/\//.test(url) && !url.includes('GANTI_');

export function createTestSql(): Sql {
  if (!hasTestDb) throw new Error('TEST_DATABASE_URL belum diisi');
  if (!/baruna_test|_test\b/.test(url)) throw new Error('TEST_DATABASE_URL harus menunjuk database test (*_test)');
  return createSql(url, { max: 3 });
}

/** Drops everything in the test database and re-applies all migrations. */
export async function resetTestDb(sql: Sql): Promise<void> {
  await sql.unsafe('drop schema if exists public cascade; create schema public;');
  await migrate(sql, () => {});
}

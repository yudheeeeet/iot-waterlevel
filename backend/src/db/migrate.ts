import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './client.js';

/** backend/migrations — resolved the same way from src/ (tsx) and dist/ (compiled). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 724_001; // advisory lock: only one migrator at a time

/**
 * Applies pending SQL migrations in filename order inside one transaction.
 * Already-applied files are recorded in `schema_migrations`, so running it twice is safe.
 */
export async function migrate(sql: Sql, log: (msg: string) => void = console.log): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => MIGRATION_FILE.test(f)).sort();
  const applied: string[] = [];

  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
    await tx`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`;
    const done = new Set((await tx<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const body = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
      applied.push(file);
      log(`applied ${file}`);
    }
  });

  if (applied.length === 0) log('database is up to date');
  return applied;
}

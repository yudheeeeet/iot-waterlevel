import { loadEnv } from '../config/env.js';
import { createSql } from '../db/client.js';
import { migrate } from '../db/migrate.js';

/** npm run db:migrate — applies migrations to DATABASE_URL (local or Supabase). */
const env = loadEnv();
const sql = createSql(env.DATABASE_URL, { max: 1 });
try {
  const host = new URL(env.DATABASE_URL).host;
  console.log(`migrating ${host} ...`);
  await migrate(sql);
} catch (err) {
  console.error('migration failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

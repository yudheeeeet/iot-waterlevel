import { loadEnv } from '../config/env.js';
import { createSql } from '../db/client.js';

/** npm run db:check — verifies DATABASE_URL and prints server version + applied migrations. */
const env = loadEnv();
const sql = createSql(env.DATABASE_URL, { max: 1 });
try {
  const [row] = await sql<{ version: string; db: string; usr: string }[]>`
    select version() as version, current_database() as db, current_user as usr`;
  console.log(`OK  ${row?.usr}@${row?.db}`);
  console.log(`    ${row?.version}`);
  const [mig] = await sql<{ exists: boolean }[]>`select to_regclass('schema_migrations') is not null as exists`;
  if (mig?.exists) {
    const names = await sql<{ name: string }[]>`select name from schema_migrations order by name`;
    console.log(`    migrations: ${names.map((n) => n.name).join(', ') || '(none)'}`);
  } else {
    console.log('    migrations: belum dijalankan (npm run db:migrate)');
  }
} catch (err) {
  console.error('GAGAL terhubung ke database:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

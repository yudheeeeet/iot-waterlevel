import { randomBytes } from 'node:crypto';
import { loadEnv } from '../config/env.js';
import { createSql, type Sql } from '../db/client.js';
import { identityService } from '../modules/identity/service.js';

/** Readable random password (no ambiguous characters), printed once by the CLI. */
export function generatePassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Identity service for CLI use. JWT values are not needed for creating users. */
export function cliIdentity(): { sql: Sql; identity: ReturnType<typeof identityService> } {
  const env = loadEnv();
  const sql = createSql(env.DATABASE_URL, { max: 1 });
  const identity = identityService(sql, { jwtSecret: 'unused-by-cli', accessTtlSec: 900, refreshTtlDays: 7, cookieSecure: false });
  return { sql, identity };
}

export async function runCli(main: () => Promise<void>, sql: Sql): Promise<void> {
  try {
    await main();
  } catch (err) {
    console.error('GAGAL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

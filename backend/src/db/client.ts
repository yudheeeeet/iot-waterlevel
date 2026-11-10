import postgres from 'postgres';

export type Sql = postgres.Sql;

/**
 * PostgreSQL connection (postgres.js).
 * `prepare: false` keeps it compatible with the Supabase transaction pooler used from Vercel.
 */
export function createSql(databaseUrl: string, options: { max?: number } = {}): Sql {
  return postgres(databaseUrl, {
    max: options.max ?? 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 5,
    onnotice: () => {},
  });
}

/** Lightweight connectivity check used by /api/health. */
export async function pingDb(sql: Sql): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

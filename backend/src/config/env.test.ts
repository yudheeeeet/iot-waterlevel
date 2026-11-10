import { describe, expect, it } from 'vitest';
import { ApiEnvSchema, BaseEnvSchema, EnvError, parseEnv } from './env.js';

const DB = 'postgres://u:p@localhost:5432/db';
const SECRET = 'x'.repeat(40);

const messageOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EnvError);
    return (err as EnvError).message;
  }
  throw new Error('expected EnvError');
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv({ DATABASE_URL: DB, JWT_SECRET: SECRET }, ApiEnvSchema);
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe('development');
    expect(env.ACCESS_TOKEN_TTL_SEC).toBe(900);
    expect(env.COOKIE_SECURE).toBeUndefined();
  });

  it('names the missing variable', () => {
    expect(messageOf(() => parseEnv({}, BaseEnvSchema))).toContain('DATABASE_URL');
    expect(messageOf(() => parseEnv({ DATABASE_URL: DB }, ApiEnvSchema))).toContain('JWT_SECRET');
  });

  it('rejects a non-postgres URL and an invalid port', () => {
    const msg = messageOf(() => parseEnv({ DATABASE_URL: 'mysql://x', PORT: '99999', JWT_SECRET: SECRET }, ApiEnvSchema));
    expect(msg).toContain('DATABASE_URL');
    expect(msg).toContain('PORT');
  });

  it('rejects placeholder values copied from .env.example', () => {
    const msg = messageOf(() =>
      parseEnv(
        { DATABASE_URL: 'postgres://baruna:GANTI_PASSWORD_DB@localhost/db', JWT_SECRET: 'GANTI_RAHASIA_MINIMAL_32_KARAKTER' },
        ApiEnvSchema,
      ),
    );
    expect(msg).toContain('DATABASE_URL masih berisi nilai contoh');
    expect(msg).toContain('JWT_SECRET masih berisi nilai contoh');
  });

  it('rejects a short JWT secret and parses COOKIE_SECURE', () => {
    expect(messageOf(() => parseEnv({ DATABASE_URL: DB, JWT_SECRET: 'short' }, ApiEnvSchema))).toContain('minimal 32');
    expect(parseEnv({ DATABASE_URL: DB, JWT_SECRET: SECRET, COOKIE_SECURE: 'true' }, ApiEnvSchema).COOKIE_SECURE).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { ApiEnvSchema, BaseEnvSchema, EnvError, WorkerEnvSchema, parseEnv } from './env.js';

const DB = 'postgres://u:p@localhost:5432/db';
const SECRET = 'x'.repeat(40);
const MQTT = { MQTT_URL: 'mqtt://127.0.0.1:1884', MQTT_USERNAME: 'baruna-backend', MQTT_PASSWORD: 'secret' };

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
    const env = parseEnv({ DATABASE_URL: DB, JWT_SECRET: SECRET, ...MQTT }, ApiEnvSchema);
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
    expect(parseEnv({ DATABASE_URL: DB, JWT_SECRET: SECRET, COOKIE_SECURE: 'true', ...MQTT }, ApiEnvSchema).COOKIE_SECURE).toBe(true);
  });

  it('broker: mosquitto mode needs the MQTT connection, manual mode does not (api)', () => {
    const msg = messageOf(() => parseEnv({ DATABASE_URL: DB, JWT_SECRET: SECRET }, ApiEnvSchema));
    expect(msg).toContain('MQTT_URL wajib diisi');
    expect(msg).toContain('MQTT_PASSWORD wajib diisi');
    const manual = parseEnv({ DATABASE_URL: DB, JWT_SECRET: SECRET, BROKER_PROVIDER: 'manual' }, ApiEnvSchema);
    expect(manual.BROKER_PROVIDER).toBe('manual');
    expect(manual.MQTT_PUBLIC_PORT).toBe(1883);
    expect(manual.MQTT_PUBLIC_TLS).toBe(false);
  });

  it('broker: the worker always needs the MQTT connection; URL scheme and placeholders are checked', () => {
    expect(messageOf(() => parseEnv({ DATABASE_URL: DB, BROKER_PROVIDER: 'manual' }, WorkerEnvSchema))).toContain('MQTT_URL wajib diisi');
    const msg = messageOf(() =>
      parseEnv({ DATABASE_URL: DB, ...MQTT, MQTT_URL: 'http://x', MQTT_PASSWORD: 'GANTI_PASSWORD_BACKEND_MQTT' }, WorkerEnvSchema),
    );
    expect(msg).toContain('MQTT_URL harus diawali');
    expect(msg).toContain('MQTT_PASSWORD masih berisi nilai contoh');
    expect(parseEnv({ DATABASE_URL: DB, ...MQTT, MQTT_PUBLIC_TLS: 'true' }, WorkerEnvSchema).MQTT_PUBLIC_TLS).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from './env.js';

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe('development');
  });

  it('names the missing variable', () => {
    expect(() => parseEnv({})).toThrow(EnvError);
    try {
      parseEnv({});
    } catch (err) {
      expect((err as EnvError).message).toContain('DATABASE_URL');
    }
  });

  it('rejects a non-postgres URL and an invalid port', () => {
    try {
      parseEnv({ DATABASE_URL: 'mysql://x', PORT: '99999' });
      expect.unreachable();
    } catch (err) {
      const msg = (err as EnvError).message;
      expect(msg).toContain('DATABASE_URL');
      expect(msg).toContain('PORT');
    }
  });
});

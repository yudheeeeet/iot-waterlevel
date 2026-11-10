import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { AppError } from './shared/errors.js';

const build = (dbUp = true) => buildApp({ deps: { checkDb: async () => dbUp } });

describe('GET /api/health', () => {
  it('returns 200 with db up', async () => {
    const app = await build(true);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'up' });
    expect(typeof res.json().uptimeSec).toBe('number');
  });

  it('returns 503 when the database is down', async () => {
    const app = await build(false);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'down' });
  });
});

describe('error format', () => {
  it('unknown route → 404 with uniform error body', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /api/nope tidak ditemukan', details: null },
    });
  });

  it('AppError keeps its code and status', async () => {
    const app = await build();
    app.get('/boom-app', async () => {
      throw new AppError('DEVICE_NOT_FOUND', 'Device tidak ditemukan', 404);
    });
    const res = await app.inject({ method: 'GET', url: '/boom-app' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toEqual({ code: 'DEVICE_NOT_FOUND', message: 'Device tidak ditemukan', details: null });
  });

  it('unexpected error → 500 without leaking the internal message', async () => {
    const app = await build();
    app.get('/boom', async () => {
      throw new Error('secret connection string leaked');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('secret');
  });
});

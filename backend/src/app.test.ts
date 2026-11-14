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

  it('reports the worker from its heartbeat; a stopped worker is degraded but still 200', async () => {
    const withWorker = (state: 'up' | 'down') =>
      buildApp({ deps: { checkDb: async () => true, checkWorker: async () => state } });
    const up = await (await withWorker('up')).inject({ method: 'GET', url: '/api/health' });
    expect(up.json()).toMatchObject({ status: 'ok', worker: 'up' });
    const down = await (await withWorker('down')).inject({ method: 'GET', url: '/api/health' });
    expect(down.statusCode).toBe(200);
    expect(down.json()).toMatchObject({ status: 'degraded', db: 'up', worker: 'down' });
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

  it('empty POST body is accepted with any Content-Type; non-JSON bodies → 415; bad JSON → 400', async () => {
    const app = await build();
    app.post('/echo', async (request) => ({ body: request.body ?? null }));
    for (const type of ['application/x-www-form-urlencoded', 'application/json', 'text/plain']) {
      const res = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': type } });
      expect(res.statusCode, type).toBe(200);
      expect(res.json()).toEqual({ body: null });
    }
    const ok = await app.inject({ method: 'POST', url: '/echo', payload: { a: 1 } });
    expect(ok.json()).toEqual({ body: { a: 1 } });

    const form = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'text/plain' }, payload: 'a=1' });
    expect(form.statusCode).toBe(415);
    expect(form.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const bad = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: '{bad' });
    expect(bad.statusCode).toBe(400);
    const proto = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"__proto__":{"x":1}}',
    });
    expect(proto.statusCode).toBe(400);
  });
});

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { Sql } from '../../db/client.js';
import { createTestSql, hasTestDb, resetTestDb } from '../../test/testDb.js';
import { identityService } from './service.js';
import { REFRESH_COOKIE } from './routes.js';
import type { AuthConfig } from './tokens.js';

const cfg: AuthConfig = { jwtSecret: 'k'.repeat(40), accessTtlSec: 900, refreshTtlDays: 7, cookieSecure: false };

describe.skipIf(!hasTestDb)('identity (DB)', () => {
  let sql: Sql;
  let app: FastifyInstance;

  beforeAll(async () => {
    sql = createTestSql();
    await resetTestDb(sql);
    const svc = identityService(sql, cfg);
    await svc.createUser({ email: 'Admin@Test.local', name: 'Admin', role: 'admin', password: 'admin-pass-123' });
    await svc.createUser({ email: 'viewer@test.local', name: 'Viewer', role: 'viewer', password: 'viewer-pass-123' });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });
  // Fresh app per test so the in-memory login rate limit does not leak between tests.
  beforeEach(async () => {
    app = await buildApp({ deps: { checkDb: async () => true, sql, auth: cfg } });
  });

  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const refreshCookieOf = (res: Awaited<ReturnType<typeof login>>) =>
    res.cookies.find((c) => c.name === REFRESH_COOKIE);

  it('login succeeds (email is case-insensitive) and sets an httpOnly refresh cookie', async () => {
    const res = await login('ADMIN@test.local', 'admin-pass-123');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ email: 'admin@test.local', role: 'admin' });
    expect(body.expiresIn).toBe(900);
    expect(typeof body.accessToken).toBe('string');
    expect(body).not.toHaveProperty('refreshToken');
    const cookie = refreshCookieOf(res);
    expect(cookie).toMatchObject({ httpOnly: true, path: '/api/auth', sameSite: 'Lax' });
  });

  it('wrong password and unknown email give the same 401', async () => {
    const wrong = await login('admin@test.local', 'nope-nope');
    const unknown = await login('ghost@test.local', 'nope-nope');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('invalid body → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'not-an-email' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('/auth/me requires a token and returns the user', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    const { accessToken } = (await login('viewer@test.local', 'viewer-pass-123')).json();
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: 'viewer@test.local', role: 'viewer' });
  });

  it('refresh rotates the token; re-using the old one revokes the whole session', async () => {
    const first = refreshCookieOf(await login('viewer@test.local', 'viewer-pass-123'))!.value;

    const r1 = await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { [REFRESH_COOKIE]: first } });
    expect(r1.statusCode).toBe(200);
    expect(typeof r1.json().accessToken).toBe('string');
    const second = refreshCookieOf(r1)!.value;
    expect(second).not.toBe(first);

    // Old token re-used (e.g. stolen) → rejected, and the new one dies with it.
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { [REFRESH_COOKIE]: first } });
    expect(reuse.statusCode).toBe(401);
    const after = await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { [REFRESH_COOKIE]: second } });
    expect(after.statusCode).toBe(401);
  });

  it('logout revokes the refresh token and clears the cookie', async () => {
    const token = refreshCookieOf(await login('viewer@test.local', 'viewer-pass-123'))!.value;
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { [REFRESH_COOKIE]: token } });
    expect(out.statusCode).toBe(204);
    expect(refreshCookieOf(out)?.value).toBe('');
    const again = await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { [REFRESH_COOKIE]: token } });
    expect(again.statusCode).toBe(401);
  });

  it('6th login attempt for the same email within 15 minutes → 429', async () => {
    for (let i = 0; i < 5; i++) expect((await login('admin@test.local', `bad-${i}-pass`)).statusCode).toBe(401);
    const blocked = await login('admin@test.local', 'admin-pass-123');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('TOO_MANY_REQUESTS');
    // Other emails from the same IP are not blocked.
    expect((await login('viewer@test.local', 'viewer-pass-123')).statusCode).toBe(200);
  });

  it('resetPassword revokes existing sessions; deactivated users cannot log in', async () => {
    const svc = identityService(sql, cfg);
    const token = refreshCookieOf(await login('viewer@test.local', 'viewer-pass-123'))!.value;
    await svc.resetPassword('viewer@test.local', 'viewer-pass-456');
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { [REFRESH_COOKIE]: token } })).statusCode).toBe(401);
    expect((await login('viewer@test.local', 'viewer-pass-456')).statusCode).toBe(200);

    await sql`update users set is_active = false where email = 'viewer@test.local'`;
    expect((await login('viewer@test.local', 'viewer-pass-456')).statusCode).toBe(401);
  });

  it('rejects weak passwords and duplicate emails', async () => {
    const svc = identityService(sql, cfg);
    await expect(svc.createUser({ email: 'x@test.local', name: 'X', role: 'viewer', password: 'short' })).rejects.toThrow(/minimal 8/);
    await expect(svc.createUser({ email: 'ADMIN@test.local', name: 'Dup', role: 'viewer', password: 'long-enough-1' })).rejects.toThrow(/sudah terdaftar/);
  });
});

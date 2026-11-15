import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { makeGuards } from './authGuard.js';
import { signAccessToken, type AuthConfig } from '../modules/identity/tokens.js';

const cfg: AuthConfig = { jwtSecret: 's'.repeat(40), accessTtlSec: 900, refreshTtlDays: 7, cookieSecure: false };
const guards = makeGuards(cfg);

async function build() {
  const app = await buildApp({ deps: { checkDb: async () => true, auth: cfg } });
  app.get('/t/any', { preHandler: guards.requireAuth }, async (req) => ({ user: req.user }));
  app.get('/t/admin', { preHandler: guards.requireRole('admin') }, async () => ({ ok: true }));
  return app;
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('auth guards', () => {
  it('/api/health stays public when auth is enabled', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it('no token → 401 UNAUTHORIZED', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/t/any' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('token signed with another secret → 401', async () => {
    const other = await signAccessToken({ id: 'u1', role: 'admin' }, { ...cfg, jwtSecret: 'x'.repeat(40) });
    const res = await (await build()).inject({ method: 'GET', url: '/t/any', headers: bearer(other) });
    expect(res.statusCode).toBe(401);
  });

  it('expired token → 401', async () => {
    const expired = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setIssuer('baruna-api')
      .setAudience('baruna-dashboard')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(cfg.jwtSecret));
    const res = await (await build()).inject({ method: 'GET', url: '/t/any', headers: bearer(expired) });
    expect(res.statusCode).toBe(401);
  });

  it('valid token sets request.user; viewer on admin route → 403; admin → 200', async () => {
    const app = await build();
    const viewer = await signAccessToken({ id: 'v1', role: 'viewer' }, cfg);
    const admin = await signAccessToken({ id: 'a1', role: 'admin' }, cfg);

    const me = await app.inject({ method: 'GET', url: '/t/any', headers: bearer(viewer) });
    expect(me.json()).toEqual({ user: { id: 'v1', role: 'viewer' } });

    const forbidden = await app.inject({ method: 'GET', url: '/t/admin', headers: bearer(viewer) });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('FORBIDDEN');

    const ok = await app.inject({ method: 'GET', url: '/t/admin', headers: bearer(admin) });
    expect(ok.statusCode).toBe(200);
  });
});

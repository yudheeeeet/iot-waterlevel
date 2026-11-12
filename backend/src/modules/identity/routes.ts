import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import { parseInput } from '../../shared/validation.js';
import type { IdentityService, Session } from './service.js';
import type { AuthConfig } from './tokens.js';

export const REFRESH_COOKIE = 'rt';
const COOKIE_PATH = '/api/auth';

const LoginBody = z.object({
  email: z.email('Format email tidak valid').max(254),
  password: z.string().min(1, 'Password wajib diisi').max(200),
});

/** Login attempts per IP+email within the window (PRD ID-3). */
export const LOGIN_RATE_LIMIT = { max: 5, timeWindow: 15 * 60 * 1000 };

export const identityRoutes =
  (service: IdentityService, cfg: AuthConfig): FastifyPluginAsync =>
  async (app) => {
    const setRefreshCookie = (reply: FastifyReply, session: Session) =>
      reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
        path: COOKIE_PATH,
        httpOnly: true,
        sameSite: 'lax',
        secure: cfg.cookieSecure,
        expires: session.refreshExpiresAt,
      });

    const clearRefreshCookie = (reply: FastifyReply) =>
      reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH, httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure });

    const sessionBody = (s: Session) => ({ accessToken: s.accessToken, expiresIn: s.expiresIn, user: s.user });

    app.post(
      '/auth/login',
      {
        config: {
          public: true,
          rateLimit: {
            ...LOGIN_RATE_LIMIT,
            hook: 'preHandler',
            keyGenerator: (req) => {
              const email = (req.body as { email?: unknown } | undefined)?.email;
              return `${req.ip}|${typeof email === 'string' ? email.trim().toLowerCase() : ''}`;
            },
          },
        },
      },
      async (request, reply) => {
        const body = parseInput(LoginBody, request.body);
        const session = await service.login(body.email, body.password);
        setRefreshCookie(reply, session);
        return sessionBody(session);
      },
    );

    // refresh & logout read only the cookie. Their scope accepts any Content-Type and discards the
    // body, so clients that send a default form/JSON header without a body don't get 415/400.
    await app.register(async (scope) => {
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser('*', (_req, payload, done) => {
        payload.resume();
        payload.on('end', () => done(null, undefined));
        payload.on('error', done);
      });

      scope.post('/auth/refresh', { config: { public: true } }, async (request, reply) => {
        const token = request.cookies[REFRESH_COOKIE];
        if (!token) throw new AppError('INVALID_SESSION', 'Sesi tidak valid, silakan login kembali', 401);
        try {
          const session = await service.refresh(token);
          setRefreshCookie(reply, session);
          return sessionBody(session);
        } catch (err) {
          clearRefreshCookie(reply);
          throw err;
        }
      });

      // Public on purpose: logging out must work even when the access token has already expired.
      scope.post('/auth/logout', { config: { public: true } }, async (request, reply) => {
        await service.logout(request.cookies[REFRESH_COOKIE]);
        clearRefreshCookie(reply);
        return reply.status(204).send();
      });
    });

    app.get('/auth/me', async (request) => service.me(request.user!.id));
  };

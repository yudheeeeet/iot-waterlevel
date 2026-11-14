import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { Sql } from './db/client.js';
import { AppError, registerErrorHandling } from './shared/errors.js';
import { makeGuards } from './shared/authGuard.js';
import { healthRoutes, type HealthDeps } from './modules/health/routes.js';
import { identityRoutes } from './modules/identity/routes.js';
import { identityService } from './modules/identity/service.js';
import type { AuthConfig } from './modules/identity/tokens.js';
import type { BrokerProvisioner } from './modules/devices/broker/provisioner.js';
import { deviceRoutes } from './modules/devices/routes.js';
import { readingsRoutes } from './modules/readings/routes.js';
import { readingsService } from './modules/readings/service.js';
import { weatherRoutes } from './modules/weather/routes.js';
import { weatherCacheKey, weatherService, type WeatherConfig } from './modules/weather/service.js';
import { deviceService, type MqttPublicInfo } from './modules/devices/service.js';

export interface AppDeps extends HealthDeps {
  /** Database + auth config. Without them only /api/health is registered (used by unit tests). */
  sql?: Sql;
  auth?: AuthConfig;
  /** Broker adapter + firmware-facing broker address. Without them device routes are not registered. */
  broker?: BrokerProvisioner;
  mqttPublic?: MqttPublicInfo;
  /** Broker usernames a device id may not take (e.g. the backend account). */
  reservedDeviceIds?: string[];
  /** Weather location + sources. Without it /api/weather is not registered. */
  weather?: WeatherConfig;
  /** fetch used for BMKG / Open-Meteo (tests inject a fake). */
  fetch?: typeof fetch;
}

export interface BuildAppOptions {
  deps: AppDeps;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Builds the Fastify instance without listening.
 * Shared by `server.ts` (local / production) and the Vercel Function entry (Task 19).
 *
 * Every route under /api requires a valid access token (default deny),
 * unless it is registered with `config: { public: true }`.
 */
export async function buildApp({ deps, logger = false }: BuildAppOptions): Promise<FastifyInstance> {
  // Logger options (incl. redaction of tokens/passwords) come from shared/logger.ts.
  const app = Fastify({ logger, trustProxy: true });

  registerErrorHandling(app);
  registerBodyParsing(app);
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) =>
      new AppError(
        'TOO_MANY_REQUESTS',
        `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(ctx.ttl / 60_000)} menit`,
        429,
      ),
  });

  await app.register(
    async (api) => {
      const guards = deps.auth ? makeGuards(deps.auth) : undefined;
      if (guards) api.addHook('onRequest', guards.defaultDeny);

      await api.register(healthRoutes(deps));
      if (deps.sql && deps.auth) {
        await api.register(identityRoutes(identityService(deps.sql, deps.auth), deps.auth));
        await api.register(
          readingsRoutes(readingsService(deps.sql, deps.weather ? { weatherCacheKey: weatherCacheKey(deps.weather) } : {})),
        );
        if (deps.weather) {
          await api.register(weatherRoutes(weatherService(deps.sql, deps.weather, deps.fetch ?? fetch, api.log)));
        }
      }
      if (deps.sql && guards && deps.broker && deps.mqttPublic) {
        const service = deviceService({
          sql: deps.sql,
          broker: deps.broker,
          mqttPublic: deps.mqttPublic,
          reservedIds: ['admin', 'baruna-backend', ...(deps.reservedDeviceIds ?? [])],
          log: api.log,
        });
        await api.register(deviceRoutes(service, guards.requireRole('admin')));
      }
    },
    { prefix: '/api' },
  );

  return app;
}

/** Maps the validated api env onto the auth config used by the identity module and guards. */
export const authConfigFromEnv = (env: {
  JWT_SECRET: string;
  ACCESS_TOKEN_TTL_SEC: number;
  REFRESH_TOKEN_TTL_DAYS: number;
  COOKIE_SECURE?: boolean | undefined;
  NODE_ENV: string;
}): AuthConfig => ({
  jwtSecret: env.JWT_SECRET,
  accessTtlSec: env.ACCESS_TOKEN_TTL_SEC,
  refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
});

/**
 * Body-less POSTs (refresh, logout, token rotate) must work whatever Content-Type the client adds:
 * an empty body is accepted as `undefined` for any type. A non-empty body must be JSON (else 415).
 * JSON keeps Fastify's own parser (prototype-poisoning protection).
 */
function registerBodyParsing(app: FastifyInstance): void {
  const json = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser(['application/json', 'text/plain']);
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) =>
    body === '' ? done(null, undefined) : json(req, body as string, done),
  );
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) =>
    body === ''
      ? done(null, undefined)
      : done(new AppError('UNSUPPORTED_MEDIA_TYPE', 'Body harus JSON (Content-Type: application/json)', 415)),
  );
}

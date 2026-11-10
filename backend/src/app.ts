import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerErrorHandling } from './shared/errors.js';
import { healthRoutes, type HealthDeps } from './modules/health/routes.js';

export interface AppDeps extends HealthDeps {}

export interface BuildAppOptions {
  deps: AppDeps;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Builds the Fastify instance without listening.
 * Shared by `server.ts` (local / production) and the Vercel Function entry (Task 19).
 */
export async function buildApp({ deps, logger = false }: BuildAppOptions): Promise<FastifyInstance> {
  // Logger options (incl. redaction of tokens/passwords) come from shared/logger.ts.
  const app = Fastify({ logger, trustProxy: true });

  registerErrorHandling(app);

  await app.register(
    async (api) => {
      await api.register(healthRoutes(deps));
    },
    { prefix: '/api' },
  );

  return app;
}

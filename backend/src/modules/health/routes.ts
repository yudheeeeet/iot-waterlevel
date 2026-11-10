import type { FastifyPluginAsync } from 'fastify';

export interface HealthDeps {
  /** Returns true when the database answers. */
  checkDb: () => Promise<boolean>;
}

/** GET /api/health — public, no sensitive details. Worker status is added in Task 10. */
export const healthRoutes =
  (deps: HealthDeps): FastifyPluginAsync =>
  async (app) => {
    app.get('/health', { config: { public: true } }, async (_request, reply) => {
      const dbUp = await deps.checkDb();
      return reply.status(dbUp ? 200 : 503).send({
        status: dbUp ? 'ok' : 'degraded',
        db: dbUp ? 'up' : 'down',
        uptimeSec: Math.round(process.uptime()),
      });
    });
  };

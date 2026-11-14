import type { FastifyPluginAsync } from 'fastify';

export interface HealthDeps {
  /** Returns true when the database answers. */
  checkDb: () => Promise<boolean>;
  /** Worker heartbeat state (from worker_status). Omitted in unit tests → "unknown". */
  checkWorker?: () => Promise<'up' | 'down'>;
}

/**
 * GET /api/health — public, no sensitive details.
 * 503 only when the database is down; a stopped worker shows `worker: "down"` with status "degraded"
 * (the dashboard still works: online/offline is computed on read).
 */
export const healthRoutes =
  (deps: HealthDeps): FastifyPluginAsync =>
  async (app) => {
    app.get('/health', { config: { public: true } }, async (_request, reply) => {
      const dbUp = await deps.checkDb();
      const worker = dbUp && deps.checkWorker ? await deps.checkWorker().catch(() => 'down' as const) : 'unknown';
      return reply.status(dbUp ? 200 : 503).send({
        status: dbUp && worker !== 'down' ? 'ok' : 'degraded',
        db: dbUp ? 'up' : 'down',
        worker,
        uptimeSec: Math.round(process.uptime()),
      });
    });
  };

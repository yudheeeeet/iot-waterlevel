import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../shared/errors.js';

export interface HealthDeps {
  /** Returns true when the database answers. */
  checkDb: () => Promise<boolean>;
  /** Worker heartbeat state (from worker_status). Omitted in unit tests → "unknown". */
  checkWorker?: () => Promise<'up' | 'down'>;
  /** Vercel Cron secret for GET /api/cron/keepalive; without it the endpoint is disabled. */
  cronSecret?: string;
}

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

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

    /**
     * Daily Vercel Cron: a light DB query so the free Supabase project is not paused for inactivity.
     * Vercel sends `Authorization: Bearer $CRON_SECRET`.
     */
    app.get('/cron/keepalive', { config: { public: true } }, async (request) => {
      const auth = request.headers.authorization ?? '';
      if (!deps.cronSecret || !sameSecret(auth, `Bearer ${deps.cronSecret}`)) {
        throw new AppError('UNAUTHORIZED', 'Cron secret tidak valid', 401);
      }
      if (!(await deps.checkDb())) throw new AppError('DB_DOWN', 'Database tidak dapat dihubungi', 503);
      return { ok: true, at: new Date().toISOString() };
    });
  };

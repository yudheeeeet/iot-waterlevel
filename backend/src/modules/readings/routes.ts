import type { FastifyPluginAsync } from 'fastify';
import type { ReadingsService } from './service.js';

/** Readings endpoints: every logged-in user (default-deny /api scope). */
export const readingsRoutes =
  (service: ReadingsService): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: { id: string } }>('/devices/:id/readings', async (request) =>
      service.history(request.params.id, request.query),
    );
  };

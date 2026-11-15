import type { FastifyPluginAsync } from 'fastify';
import type { Sql } from '../../db/client.js';
import { exportReadings } from './export.js';
import type { ReadingsService } from './service.js';

/** Readings endpoints: every logged-in user (default-deny /api scope). */
export const readingsRoutes =
  (service: ReadingsService, sql: Sql): FastifyPluginAsync =>
  async (app) => {
    app.get('/summary', async () => service.summary());
    app.get<{ Params: { id: string } }>('/devices/:id/readings', async (request) =>
      service.history(request.params.id, request.query),
    );
    // CSV / XLSX download of stored readings (streamed).
    app.get<{ Params: { id: string } }>('/devices/:id/readings/export', async (request, reply) => {
      const device = await service.mustFind(request.params.id);
      const file = exportReadings(sql, device.id, request.query);
      return reply
        .header('content-type', file.contentType)
        .header('content-disposition', `attachment; filename="${file.filename}"`)
        .header('cache-control', 'no-store')
        .send(file.body);
    });
  };

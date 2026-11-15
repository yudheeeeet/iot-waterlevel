import type { FastifyPluginAsync } from 'fastify';
import type { Guard } from '../../shared/authGuard.js';
import type { DeviceService } from './service.js';

/**
 * Device endpoints (PRD §5). Reading is open to every logged-in user (default-deny /api scope);
 * every change requires the admin role.
 */
export const deviceRoutes =
  (service: DeviceService, requireAdmin: Guard): FastifyPluginAsync =>
  async (app) => {
    const admin = { preHandler: requireAdmin };
    type IdParams = { Params: { id: string } };

    app.get('/devices', async () => service.list());

    app.get<IdParams>('/devices/:id', async (request) => service.get(request.params.id));

    app.post('/devices', admin, async (request, reply) => {
      const issued = await service.create(request.body, request.user?.id ?? null);
      return reply.status(201).header('cache-control', 'no-store').send(issued);
    });

    app.patch<IdParams>('/devices/:id', admin, async (request) => service.update(request.params.id, request.body));

    app.post<IdParams>('/devices/:id/token/rotate', admin, async (request, reply) => {
      const issued = await service.rotateToken(request.params.id, request.user?.id ?? null);
      return reply.header('cache-control', 'no-store').send(issued);
    });

    app.delete<IdParams>('/devices/:id', admin, async (request, reply) => {
      await service.remove(request.params.id);
      return reply.status(204).send();
    });
  };

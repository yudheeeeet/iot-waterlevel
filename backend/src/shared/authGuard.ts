import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';
import { verifyAccessToken, type AuthConfig, type AuthUser, type Role } from '../modules/identity/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyContextConfig {
    /** Route is reachable without a login (default: false — every /api route requires auth). */
    public?: boolean;
  }
}

export type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function makeGuards(cfg: Pick<AuthConfig, 'jwtSecret'>) {
  /** Verifies `Authorization: Bearer <accessToken>` and sets request.user. */
  const requireAuth: Guard = async (request) => {
    if (request.user) return;
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', 'Silakan login terlebih dahulu', 401);
    }
    try {
      request.user = await verifyAccessToken(header.slice(7), cfg);
    } catch {
      throw new AppError('UNAUTHORIZED', 'Sesi tidak valid atau sudah kedaluwarsa', 401);
    }
  };

  /** Use after requireAuth (or inside the default-deny /api scope). */
  const requireRole =
    (role: Role): Guard =>
    async (request, reply) => {
      await requireAuth(request, reply);
      if (request.user?.role !== role) {
        throw new AppError('FORBIDDEN', 'Anda tidak memiliki akses untuk tindakan ini', 403);
      }
    };

  /** Default-deny hook for the /api scope: every route needs a login unless `config.public` is true. */
  const defaultDeny: Guard = async (request, reply) => {
    if (request.routeOptions.config?.public) return;
    await requireAuth(request, reply);
  };

  return { requireAuth, requireRole, defaultDeny };
}

import type { FastifyError, FastifyInstance } from 'fastify';

/** Business error with a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details: unknown };
}

export const errorBody = (code: string, message: string, details: unknown = null): ErrorBody => ({
  error: { code, message, details },
});

/** Every error leaves the API as `{ error: { code, message, details } }`. Internal details are never leaked. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send(errorBody('NOT_FOUND', `Route ${request.method} ${request.url} tidak ditemukan`));
  });

  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(errorBody(err.code, err.message, err.details));
    }
    if ('validation' in err && err.validation) {
      return reply.status(400).send(errorBody('VALIDATION_ERROR', 'Input tidak valid', err.validation));
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) {
      request.log.error({ err }, 'unhandled error');
      return reply.status(500).send(errorBody('INTERNAL_ERROR', 'Terjadi kesalahan pada server'));
    }
    return reply.status(status).send(errorBody(err.code ?? 'BAD_REQUEST', err.message));
  });
}

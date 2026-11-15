import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { apiDeps } from './apiDeps.js';
import { loadApiEnv } from './config/env.js';
import { createSql } from './db/client.js';
import { createBroker } from './modules/devices/broker/index.js';
import { loggerOptions } from './shared/logger.js';

/**
 * Vercel Function entry (backend/api/index.js re-exports this after `npm run build`).
 * The Fastify app is built once per function instance and reused across invocations.
 * DATABASE_URL should be the Supabase *transaction* pooler (port 6543); keep DB_POOL_MAX small (1–2).
 */
let app: Promise<FastifyInstance> | null = null;

async function init(): Promise<FastifyInstance> {
  const env = loadApiEnv();
  const sql = createSql(env.DATABASE_URL, { max: env.DB_POOL_MAX });
  const broker = createBroker(env, 'baruna-api-vercel');
  const instance = await buildApp({ deps: apiDeps(env, sql, broker), logger: loggerOptions(env) });
  await instance.ready();
  return instance;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const instance = await (app ??= init().catch((err: unknown) => {
    app = null; // retry on the next invocation
    throw err;
  }));
  instance.server.emit('request', req, res);
}

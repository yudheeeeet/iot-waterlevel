import { loadApiEnv } from './config/env.js';
import { createSql } from './db/client.js';
import { buildApp } from './app.js';
import { apiDeps } from './apiDeps.js';
import { loggerOptions } from './shared/logger.js';
import { createBroker } from './modules/devices/broker/index.js';

/** Long-running api (local development / own server). Vercel uses src/vercel.ts instead. */
const env = loadApiEnv();
const sql = createSql(env.DATABASE_URL, { max: env.DB_POOL_MAX });
const broker = createBroker(env, 'baruna-api');

const app = await buildApp({ deps: apiDeps(env, sql, broker), logger: loggerOptions(env) });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down api');
  await app.close();
  await broker.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.fatal({ err }, 'api failed to start');
  await sql.end({ timeout: 1 });
  process.exit(1);
}

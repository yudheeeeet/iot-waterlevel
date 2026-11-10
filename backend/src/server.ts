import { loadEnv } from './config/env.js';
import { createSql, pingDb } from './db/client.js';
import { buildApp } from './app.js';
import { loggerOptions } from './shared/logger.js';

const env = loadEnv();
const sql = createSql(env.DATABASE_URL);

const app = await buildApp({
  deps: { checkDb: () => pingDb(sql) },
  logger: loggerOptions(env),
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down api');
  await app.close();
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

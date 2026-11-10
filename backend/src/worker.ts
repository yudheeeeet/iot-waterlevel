import pino from 'pino';
import { loadEnv } from './config/env.js';
import { createSql, pingDb } from './db/client.js';
import { REDACT_PATHS } from './shared/logger.js';

/**
 * Worker entry: long-running process for MQTT ingestion, presence job, heartbeat and broker reconciliation.
 * Task 1 only provides the skeleton (start, DB check, graceful shutdown). Real work arrives in Tasks 7, 10, 11.
 */
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: '[redacted]' } }).child({
  proc: 'worker',
});
const sql = createSql(env.DATABASE_URL, { max: 3 });

const dbUp = await pingDb(sql);
log.info({ db: dbUp ? 'up' : 'down' }, 'worker started');

// Keeps the event loop alive until a shutdown signal; replaced by the MQTT client in Task 10.
const keepAlive = setInterval(() => {}, 60_000);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down worker');
  clearInterval(keepAlive);
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

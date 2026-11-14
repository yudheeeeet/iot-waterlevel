import { loadApiEnv } from './config/env.js';
import { createSql, pingDb } from './db/client.js';
import { authConfigFromEnv, buildApp } from './app.js';
import { loggerOptions } from './shared/logger.js';
import { createBroker } from './modules/devices/broker/index.js';
import { workerState } from './modules/health/workerStatus.js';

const env = loadApiEnv();
const sql = createSql(env.DATABASE_URL);
const broker = createBroker(env, 'baruna-api');

const app = await buildApp({
  deps: {
    checkDb: () => pingDb(sql),
    checkWorker: () => workerState(sql),
    sql,
    auth: authConfigFromEnv(env),
    broker,
    mqttPublic: { host: env.MQTT_PUBLIC_HOST, port: env.MQTT_PUBLIC_PORT, tls: env.MQTT_PUBLIC_TLS },
    reservedDeviceIds: env.MQTT_USERNAME ? [env.MQTT_USERNAME] : [],
    weather: {
      locationName: env.WEATHER_LOCATION_NAME,
      lat: env.WEATHER_LAT,
      lon: env.WEATHER_LON,
      bmkgAdm4: env.WEATHER_BMKG_ADM4,
      bmkgBaseUrl: env.BMKG_BASE_URL.replace(/\/$/, ''),
      openMeteoUrl: env.OPEN_METEO_URL,
    },
  },
  logger: loggerOptions(env),
});

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

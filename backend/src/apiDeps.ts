import { authConfigFromEnv, type AppDeps } from './app.js';
import type { ApiEnv } from './config/env.js';
import { pingDb, type Sql } from './db/client.js';
import type { BrokerProvisioner } from './modules/devices/broker/provisioner.js';
import { workerState } from './modules/health/workerStatus.js';

/** Dependencies of the HTTP api built from the validated env. Shared by server.ts and vercel.ts. */
export function apiDeps(env: ApiEnv, sql: Sql, broker: BrokerProvisioner): AppDeps {
  return {
    checkDb: () => pingDb(sql),
    checkWorker: () => workerState(sql),
    ...(env.CRON_SECRET ? { cronSecret: env.CRON_SECRET } : {}),
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
  };
}

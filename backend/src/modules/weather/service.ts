import type { Sql } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { mergeWeather, type Weather } from './merge.js';
import { fetchBmkg, fetchOpenMeteo, type Fetch } from './sources.js';

export interface WeatherConfig {
  locationName: string;
  lat: number;
  lon: number;
  bmkgAdm4: string;
  bmkgBaseUrl: string;
  openMeteoUrl: string;
}

/** PRD WX-4: one fetch per 30 minutes, whatever the number of users. Stored in the DB (Vercel has no shared memory). */
export const WEATHER_TTL_MS = 30 * 60_000;
export const weatherCacheKey = (cfg: Pick<WeatherConfig, 'lat' | 'lon'>) => `weather:${cfg.lat},${cfg.lon}`;

interface Log {
  warn: (obj: object, msg: string) => void;
}

export function weatherService(sql: Sql, cfg: WeatherConfig, f: Fetch = fetch, log?: Log) {
  const key = weatherCacheKey(cfg);

  async function readCache(): Promise<{ payload: Weather; fresh: boolean } | null> {
    const [row] = await sql<{ payload: Weather; fresh: boolean }[]>`
      select payload, expires_at > now() as fresh from weather_cache where cache_key = ${key}`;
    return row ?? null;
  }

  return {
    async get(now = Date.now()): Promise<Weather> {
      const cached = await readCache();
      if (cached?.fresh) return cached.payload;

      const [bmkg, om] = await Promise.allSettled([
        fetchBmkg(cfg.bmkgBaseUrl, cfg.bmkgAdm4, f),
        fetchOpenMeteo(cfg.openMeteoUrl, cfg.lat, cfg.lon, f),
      ]);
      if (bmkg.status === 'rejected') log?.warn({ err: String(bmkg.reason) }, 'BMKG unavailable');
      if (om.status === 'rejected') log?.warn({ err: String(om.reason) }, 'Open-Meteo unavailable');

      if (bmkg.status === 'rejected' && om.status === 'rejected') {
        if (cached) return { ...cached.payload, stale: true };
        throw new AppError('WEATHER_UNAVAILABLE', 'Data cuaca tidak tersedia (BMKG dan Open-Meteo gagal)', 503);
      }
      const weather = mergeWeather(
        bmkg.status === 'fulfilled' ? bmkg.value : null,
        om.status === 'fulfilled' ? om.value : null,
        now,
        cfg.locationName,
      );
      await sql`
        insert into weather_cache (cache_key, payload, fetched_at, expires_at)
        values (${key}, ${sql.json(weather as never)}, ${new Date(now)}, ${new Date(now + WEATHER_TTL_MS)})
        on conflict (cache_key) do update set
          payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`;
      return weather;
    },
  };
}

export type WeatherService = ReturnType<typeof weatherService>;

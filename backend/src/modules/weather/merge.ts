import type { Icon } from './codes.js';
import { bmkgCurrent, bmkgDaily, type BmkgSlot, type DailyForecast, type OpenMeteo } from './sources.js';

/**
 * Today + 7-day forecast, merged exactly like getDirect() in src/services/weather/weatherService.js:
 *   days 1–3 BMKG, days 4–7 Open-Meteo; Open-Meteo covers everything if BMKG is unavailable;
 *   "feels like" only from Open-Meteo.
 */
export interface Weather {
  location: string;
  today: {
    temperatureC: number | null;
    feelsLikeC: number | null;
    condition: string;
    icon: Icon;
    humidity: number | null;
    windMs: number | null;
    /** Estimated rainfall today = sum of forecast precipitation (not a gauge measurement). */
    rainfallMm: number | null;
    rainfallSource: 'BMKG' | 'Open-Meteo' | null;
    updatedAt: string;
    source: 'BMKG' | 'Open-Meteo';
  };
  forecast: DailyForecast[];
  sources: string[];
  fetchedAt: string;
  /** true when served from an old cache because both sources failed (PRD WX-5). */
  stale?: boolean;
}

/** YYYY-MM-DD in Asia/Jakarta. */
export function jakartaDateKey(t: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}

function nextDates(startKey: string, count: number): string[] {
  const base = new Date(`${startKey}T12:00:00+07:00`).getTime();
  return Array.from({ length: count }, (_, i) => jakartaDateKey(base + i * 86_400_000));
}

export function mergeWeather(bmkg: BmkgSlot[] | null, om: OpenMeteo | null, now: number, location: string): Weather {
  if (!bmkg && !om) throw new Error('Weather data is unavailable (BMKG and Open-Meteo both failed)');

  const todayKey = jakartaDateKey(now);
  const bmkgDays = bmkg ? bmkgDaily(bmkg) : [];
  const omDays = om?.daily ?? [];

  const forecast = nextDates(todayKey, 7).map((date, i): DailyForecast => {
    const fromBmkg = i < 3 ? bmkgDays.find((d) => d.date === date) : undefined;
    return (
      fromBmkg ??
      omDays.find((d) => d.date === date) ?? { date, tmax: null, tmin: null, rainMm: null, icon: 'cloud', condition: '—', source: null }
    );
  });

  const slot = bmkg ? bmkgCurrent(bmkg, now) : null;
  const omNow = om?.current;
  const todayBmkg = bmkgDays.find((d) => d.date === todayKey);
  const todayOm = omDays.find((d) => d.date === todayKey);

  const today: Weather['today'] = {
    temperatureC: slot?.temperatureC ?? omNow?.temperatureC ?? null,
    feelsLikeC: omNow?.feelsLikeC ?? null,
    condition: slot?.condition ?? omNow?.condition ?? '—',
    icon: slot?.icon ?? omNow?.icon ?? 'cloud',
    humidity: slot?.humidity ?? omNow?.humidity ?? null,
    windMs: slot?.windMs ?? omNow?.windMs ?? null,
    rainfallMm: todayBmkg?.rainMm ?? todayOm?.rainMm ?? null,
    rainfallSource: todayBmkg ? 'BMKG' : todayOm ? 'Open-Meteo' : null,
    updatedAt: new Date(now).toISOString(),
    source: slot ? 'BMKG' : 'Open-Meteo',
  };

  const sources = [...new Set([today.source, ...forecast.map((f) => f.source)].filter((s): s is NonNullable<typeof s> => !!s))];
  return { location, today, forecast, sources, fetchedAt: new Date(now).toISOString() };
}

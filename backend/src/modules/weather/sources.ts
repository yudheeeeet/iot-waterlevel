import { fromBmkg, fromWmo, SEVERITY, type Icon } from './codes.js';

/**
 * BMKG and Open-Meteo clients, ported from src/services/weather/{bmkg,openMeteo}.js.
 * Parsing is separated from fetching so it can be tested with recorded responses.
 */
export type Fetch = typeof fetch;
const TIMEOUT_MS = 8_000;

const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const round = (v: unknown): number | null => (v == null ? null : Math.round(Number(v)));

// ── BMKG: village-level forecast, 3 days, 3-hour steps. Attribution to BMKG is mandatory. ──
export interface BmkgSlot {
  time: Date;
  dateKey: string;
  temperatureC: number | null;
  humidity: number | null;
  windMs: number | null;
  rainMm: number;
  icon: Icon;
  condition: string;
}

export interface DailyForecast {
  date: string;
  tmax: number | null;
  tmin: number | null;
  rainMm: number | null;
  icon: Icon;
  condition: string;
  source: 'BMKG' | 'Open-Meteo' | null;
}

interface RawBmkgSlot {
  local_datetime?: string;
  utc_datetime?: string;
  t?: unknown;
  hu?: unknown;
  ws?: unknown;
  tp?: unknown;
  weather?: unknown;
  weather_desc_en?: string;
}

function normaliseSlot(s: RawBmkgSlot): BmkgSlot | null {
  if (!s?.local_datetime) return null;
  const { icon, condition } = fromBmkg(s.weather, s.weather_desc_en);
  const time = s.utc_datetime
    ? new Date(`${s.utc_datetime.replace(' ', 'T')}Z`)
    : new Date(`${s.local_datetime.replace(' ', 'T')}+07:00`);
  const ws = num(s.ws);
  return {
    time,
    dateKey: s.local_datetime.slice(0, 10),
    temperatureC: num(s.t),
    humidity: num(s.hu),
    windMs: ws == null ? null : +(ws / 3.6).toFixed(1), // BMKG ws is km/h
    rainMm: num(s.tp) ?? 0,
    icon,
    condition,
  };
}

export function parseBmkg(json: unknown): BmkgSlot[] {
  const data = (json as { data?: { cuaca?: RawBmkgSlot[][] }[] } | null)?.data?.[0]?.cuaca ?? [];
  const slots = data.flat().map(normaliseSlot).filter((s): s is BmkgSlot => s !== null);
  if (!slots.length) throw new Error('BMKG returned no forecast slots');
  return slots;
}

export async function fetchBmkg(baseUrl: string, adm4: string, f: Fetch = fetch): Promise<BmkgSlot[]> {
  const res = await f(`${baseUrl}/publik/prakiraan-cuaca?adm4=${encodeURIComponent(adm4)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`BMKG request failed (${res.status})`);
  return parseBmkg(await res.json());
}

/** Aggregates 3-hour slots into daily summaries keyed by YYYY-MM-DD (WIB). */
export function bmkgDaily(slots: BmkgSlot[]): DailyForecast[] {
  const byDay = new Map<string, BmkgSlot[]>();
  for (const s of slots) {
    if (!byDay.has(s.dateKey)) byDay.set(s.dateKey, []);
    byDay.get(s.dateKey)!.push(s);
  }
  return [...byDay.entries()].map(([date, list]) => {
    const temps = list.map((s) => s.temperatureC).filter((t): t is number => t != null);
    const worst = list.reduce((a, b) => (SEVERITY[b.icon] > SEVERITY[a.icon] ? b : a));
    return {
      date,
      tmax: temps.length ? Math.max(...temps) : null,
      tmin: temps.length ? Math.min(...temps) : null,
      rainMm: +list.reduce((sum, s) => sum + (s.rainMm || 0), 0).toFixed(1),
      icon: worst.icon,
      condition: worst.condition,
      source: 'BMKG',
    };
  });
}

/** Slot closest to "now" — used for the Today card. */
export function bmkgCurrent(slots: BmkgSlot[], now: number): BmkgSlot {
  return slots.reduce((best, s) => (Math.abs(s.time.getTime() - now) < Math.abs(best.time.getTime() - now) ? s : best));
}

// ── Open-Meteo: free, no key, 7-day daily forecast by coordinates. Licence CC BY 4.0. ──
export interface OpenMeteo {
  daily: DailyForecast[];
  current: {
    time: Date;
    temperatureC: number | null;
    feelsLikeC: number | null;
    humidity: number | null;
    windMs: number | null;
    icon: Icon;
    condition: string;
  } | null;
}

interface RawOpenMeteo {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
  };
  current?: {
    time: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
}

export function parseOpenMeteo(json: unknown): OpenMeteo {
  const j = json as RawOpenMeteo;
  const d = j.daily ?? {};
  const daily: DailyForecast[] = (d.time ?? []).map((date, i) => ({
    date,
    tmax: round(d.temperature_2m_max?.[i]),
    tmin: round(d.temperature_2m_min?.[i]),
    rainMm: +(d.precipitation_sum?.[i] ?? 0).toFixed(1),
    ...fromWmo(d.weather_code?.[i]),
    source: 'Open-Meteo',
  }));
  const c = j.current;
  const current = c
    ? {
        time: new Date(`${c.time}:00+07:00`),
        temperatureC: round(c.temperature_2m),
        feelsLikeC: round(c.apparent_temperature),
        humidity: round(c.relative_humidity_2m),
        windMs: c.wind_speed_10m == null ? null : +c.wind_speed_10m.toFixed(1),
        ...fromWmo(c.weather_code),
      }
    : null;
  return { daily, current };
}

export async function fetchOpenMeteo(url: string, lat: number, lon: number, f: Fetch = fetch): Promise<OpenMeteo> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'Asia/Jakarta',
    forecast_days: '7',
    wind_speed_unit: 'ms',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code',
  });
  const res = await f(`${url}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`);
  return parseOpenMeteo(await res.json());
}

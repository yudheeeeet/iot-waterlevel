/**
 * Open-Meteo — free, no API key, 7-day daily forecast by coordinates.
 * Used for days 4–7 (beyond BMKG's 3-day horizon) and as a fallback.
 * Data licence: CC BY 4.0 — attribution shown in the UI.
 */
import { config } from '../../config';
import { fromWmo } from './weatherCodes';

export async function fetchOpenMeteo({ lat, lon } = config.location) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    timezone: 'Asia/Jakarta',
    forecast_days: '7',
    wind_speed_unit: 'ms',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code',
  });
  const res = await fetch(`${config.weather.openMeteoUrl}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`);
  const json = await res.json();

  const d = json.daily || {};
  const daily = (d.time || []).map((date, i) => ({
    date,
    tmax: round(d.temperature_2m_max?.[i]),
    tmin: round(d.temperature_2m_min?.[i]),
    rainMm: +(d.precipitation_sum?.[i] ?? 0).toFixed(1),
    ...fromWmo(d.weather_code?.[i]),
    source: 'Open-Meteo',
  }));

  const c = json.current || {};
  const current = json.current
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

const round = (v) => (v == null ? null : Math.round(v));

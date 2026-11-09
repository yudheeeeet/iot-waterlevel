/**
 * Weather for the dashboard: today's conditions + 7-day forecast.
 *
 *   Days 1–3 → BMKG (primary, official)
 *   Days 4–7 → Open-Meteo (BMKG only publishes 3 days)
 *   If BMKG is unavailable, Open-Meteo covers all 7 days.
 *
 * Output shape (also the expected shape of GET /api/weather in backend mode):
 * {
 *   location: 'Bogor',
 *   today: { temperatureC, feelsLikeC, condition, icon, humidity, windMs,
 *            rainfallMm, rainfallSource, updatedAt, source },
 *   forecast: [{ date, tmax, tmin, rainMm, icon, condition, source }] (7 items),
 *   sources: ['BMKG', 'Open-Meteo'],
 *   fetchedAt
 * }
 */
import { config } from '../../config';
import { request } from '../apiClient';
import { jakartaDateKey } from '../../utils/format';
import { fetchBmkg, bmkgDaily, bmkgCurrent } from './bmkg';
import { fetchOpenMeteo } from './openMeteo';
import { mockWeather } from './mockWeather';

let cache = null;

export async function getWeather({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < config.weather.cacheMs) return cache.data;

  let data;
  if (config.weather.source === 'backend') data = await request('/api/weather');
  else if (config.weather.source === 'mock') data = mockWeather();
  else data = await getDirect();

  cache = { at: Date.now(), data };
  return data;
}

async function getDirect() {
  const [bmkgRes, omRes] = await Promise.allSettled([fetchBmkg(), fetchOpenMeteo()]);
  const bmkg = bmkgRes.status === 'fulfilled' ? bmkgRes.value : null;
  const om = omRes.status === 'fulfilled' ? omRes.value : null;
  if (!bmkg && !om) throw new Error('Weather data is unavailable (BMKG and Open-Meteo both failed)');

  const todayKey = jakartaDateKey();
  const bmkgDays = bmkg ? bmkgDaily(bmkg.slots) : [];
  const omDays = om?.daily || [];

  // Next 7 calendar days (WIB). BMKG for days 1–3, Open-Meteo for the rest / as fallback.
  const dates = nextDates(todayKey, 7);
  const forecast = dates.map((date, i) => {
    const fromBmkg = i < 3 ? bmkgDays.find((d) => d.date === date) : null;
    return fromBmkg || omDays.find((d) => d.date === date) || { date, tmax: null, tmin: null, rainMm: null, icon: 'cloud', condition: '—', source: null };
  });

  // Today card: BMKG slot nearest to now, feels-like from Open-Meteo (BMKG has none).
  const slot = bmkg ? bmkgCurrent(bmkg.slots) : null;
  const omNow = om?.current;
  const todayBmkg = bmkgDays.find((d) => d.date === todayKey);
  const todayOm = omDays.find((d) => d.date === todayKey);

  const today = {
    temperatureC: slot?.temperatureC ?? omNow?.temperatureC ?? null,
    feelsLikeC: omNow?.feelsLikeC ?? null,
    condition: slot?.condition ?? omNow?.condition ?? '—',
    icon: slot?.icon ?? omNow?.icon ?? 'cloud',
    humidity: slot?.humidity ?? omNow?.humidity ?? null,
    windMs: slot?.windMs ?? omNow?.windMs ?? null,
    // Estimated rainfall today = sum of forecast precipitation (not a gauge measurement)
    rainfallMm: todayBmkg?.rainMm ?? todayOm?.rainMm ?? null,
    rainfallSource: todayBmkg ? 'BMKG' : todayOm ? 'Open-Meteo' : null,
    updatedAt: new Date().toISOString(),
    source: slot ? 'BMKG' : 'Open-Meteo',
  };

  const sources = [...new Set([today.source, ...forecast.map((f) => f.source)].filter(Boolean))];
  return { location: config.location.name, today, forecast, sources, fetchedAt: new Date().toISOString() };
}

function nextDates(startKey, count) {
  const base = new Date(`${startKey}T12:00:00+07:00`).getTime();
  return Array.from({ length: count }, (_, i) => jakartaDateKey(base + i * 86400000));
}

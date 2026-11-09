/**
 * BMKG open data — village-level forecast, 3 days, 3-hour steps.
 * Endpoint: https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=<kode wilayah>
 * Attribution to BMKG is mandatory wherever this data is shown.
 */
import { config } from '../../config';
import { fromBmkg, SEVERITY } from './weatherCodes';

export async function fetchBmkg(adm4 = config.weather.bmkgAdm4) {
  const res = await fetch(`${config.weather.bmkgBaseUrl}/publik/prakiraan-cuaca?adm4=${encodeURIComponent(adm4)}`);
  if (!res.ok) throw new Error(`BMKG request failed (${res.status})`);
  const json = await res.json();
  const slots = (json?.data?.[0]?.cuaca || []).flat().map(normaliseSlot).filter(Boolean);
  if (!slots.length) throw new Error('BMKG returned no forecast slots');
  return { slots, lokasi: json?.lokasi || json?.data?.[0]?.lokasi };
}

function normaliseSlot(s) {
  if (!s?.local_datetime) return null;
  const { icon, condition } = fromBmkg(s.weather, s.weather_desc_en);
  const utc = s.utc_datetime ? new Date(`${s.utc_datetime.replace(' ', 'T')}Z`) : new Date(`${s.local_datetime.replace(' ', 'T')}+07:00`);
  return {
    time: utc,
    dateKey: s.local_datetime.slice(0, 10),
    temperatureC: num(s.t),
    humidity: num(s.hu),
    windMs: s.ws == null ? null : +(num(s.ws) / 3.6).toFixed(1), // BMKG ws is km/h
    rainMm: num(s.tp) ?? 0,
    icon,
    condition,
  };
}

/** Aggregate 3-hour slots into daily summaries keyed by YYYY-MM-DD (WIB). */
export function bmkgDaily(slots) {
  const byDay = new Map();
  slots.forEach((s) => {
    if (!byDay.has(s.dateKey)) byDay.set(s.dateKey, []);
    byDay.get(s.dateKey).push(s);
  });
  return [...byDay.entries()].map(([date, list]) => {
    const temps = list.map((s) => s.temperatureC).filter((t) => t != null);
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

/** Slot closest to "now" — used for the Today's Weather card. */
export function bmkgCurrent(slots, now = Date.now()) {
  return slots.reduce((best, s) => (Math.abs(s.time - now) < Math.abs(best.time - now) ? s : best));
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

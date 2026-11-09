// Central runtime configuration, read from Vite env variables (see .env.example).
const env = import.meta.env;

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  useMock: env.VITE_USE_MOCK !== 'false',
  apiUrl: (env.VITE_API_URL || '').replace(/\/$/, ''),
  wsUrl: env.VITE_WS_URL || '',
  pollIntervalMs: num(env.VITE_POLL_INTERVAL_MS, 60000),

  weather: {
    source: env.VITE_WEATHER_SOURCE || 'direct', // 'direct' | 'backend' | 'mock'
    bmkgAdm4: env.VITE_BMKG_ADM4 || '32.71.03.1002', // Kel. Paledang, Bogor Tengah
    bmkgBaseUrl: (env.VITE_BMKG_BASE_URL || '/bmkg').replace(/\/$/, ''),
    openMeteoUrl: 'https://api.open-meteo.com/v1/forecast',
    cacheMs: 30 * 60 * 1000,
  },

  location: {
    name: env.VITE_LOCATION_NAME || 'Bogor',
    lat: num(env.VITE_LOCATION_LAT, -6.595),
    lon: num(env.VITE_LOCATION_LON, 106.797),
    mapSubtitle:
      env.VITE_MAP_SUBTITLE || 'Ciliwung & Cisadane basin · Kota Bogor, West Java, Indonesia',
    mapZoom: num(env.VITE_MAP_ZOOM, 13),
  },

  logo: {
    url: env.VITE_LOGO_URL || '', // e.g. /logo.png (file in /public). Empty = bundled placeholder
  },

  user: {
    initials: env.VITE_USER_INITIALS || 'AR',
  },

  // Sensor-to-water distance thresholds (cm). Smaller distance = higher water surface.
  thresholds: {
    critical: 100, // < 100 cm
    warning: 200, // 100–199 cm
    max: 500, // gauge range 0–500 cm
  },

  sampleIntervalSec: 60,
};

// Offline weather sample (VITE_WEATHER_SOURCE=mock) — same shape as weatherService output.
import { config } from '../../config';
import { jakartaDateKey } from '../../utils/format';

const SAMPLE = [
  ['rain', 'Light rain', 29, 24, 8.5],
  ['cloud-sun', 'Partly cloudy', 30, 23, 2.0],
  ['rain', 'Rain', 28, 23, 12.4],
  ['storm', 'Thunderstorm', 28, 22, 18.2],
  ['rain', 'Light rain', 29, 23, 6.7],
  ['cloud-sun', 'Partly cloudy', 30, 24, 1.2],
  ['sun', 'Clear', 31, 24, 0],
];

export function mockWeather() {
  const base = Date.now();
  const forecast = SAMPLE.map(([icon, condition, tmax, tmin, rainMm], i) => ({
    date: jakartaDateKey(base + i * 86400000),
    icon, condition, tmax, tmin, rainMm,
    source: i < 3 ? 'BMKG' : 'Open-Meteo',
  }));
  return {
    location: config.location.name,
    today: {
      temperatureC: 27, feelsLikeC: 29, condition: 'Light rain', icon: 'rain',
      humidity: 82, windMs: 2.4, rainfallMm: 8.5, rainfallSource: 'BMKG',
      updatedAt: new Date().toISOString(), source: 'BMKG',
    },
    forecast,
    sources: ['BMKG', 'Open-Meteo'],
    fetchedAt: new Date().toISOString(),
  };
}

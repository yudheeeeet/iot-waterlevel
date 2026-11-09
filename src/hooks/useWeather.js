import { useCallback, useEffect, useState } from 'react';
import { getWeather } from '../services/weather/weatherService';

const REFRESH_MS = 30 * 60 * 1000; // forecasts change slowly; refresh every 30 min

export function useWeather() {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (force = false) => {
    try {
      setWeather(await getWeather({ force }));
      setError(null);
    } catch (e) {
      setError(e.message || 'Weather unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return { weather, loading, error, reload: () => load(true) };
}

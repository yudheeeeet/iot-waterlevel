import { Droplet, RefreshCw } from 'lucide-react';
import { formatDateTime, formatDayMonth, formatWeekday, jakartaDateKey } from '../utils/format';
import { WeatherIcon } from './ui';

export function TodayWeather({ weather, loading, error, onRetry }) {
  const t = weather?.today;
  return (
    <div className="card weather-today">
      <div className="weather-today__head">
        <h2 className="section-title section-title--sm">Today&apos;s Weather</h2>
        <span className="muted">{weather?.location || ''}</span>
      </div>

      {error && !t ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : (
        <>
          <div className="weather-today__now">
            <span className="weather-today__icon"><WeatherIcon kind={t?.icon} size={33} /></span>
            <strong className="weather-today__temp">{loading || t?.temperatureC == null ? '—' : `${t.temperatureC}°C`}</strong>
            <div className="weather-today__cond">
              <span>{t?.condition || '—'}</span>
              {t?.feelsLikeC != null && <small>Feels like {t.feelsLikeC}°C</small>}
            </div>
          </div>
          <div className="weather-today__metrics">
            <Metric label="Rainfall" value={t?.rainfallMm != null ? `${t.rainfallMm.toFixed(1)} mm` : '—'} hint="Estimated" />
            <Metric label="Humidity" value={t?.humidity != null ? `${t.humidity}%` : '—'} />
            <Metric label="Wind" value={t?.windMs != null ? `${t.windMs} m/s` : '—'} />
          </div>
          <p className="muted small">
            Updated {formatDateTime(t?.updatedAt)} · Source: {t?.source || '—'}
          </p>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className="weather-metric">
      <span className="muted" title={hint}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ForecastWeek({ weather, loading, error, onRetry }) {
  const days = weather?.forecast || [];
  const todayKey = jakartaDateKey();
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  const bmkgDays = days.filter((d) => d.source === 'BMKG').length;

  return (
    <div className="card forecast">
      <div className="forecast__head">
        <h2 className="section-title section-title--sm">7-Day Weather Forecast</h2>
        <span className="muted">
          {first && last ? `${formatDayMonth(`${first}T12:00:00+07:00`)}–${formatDayMonth(`${last}T12:00:00+07:00`)} · Min / max °C` : ''}
        </span>
      </div>

      {error && !days.length ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : (
        <>
          <div className="forecast__days">
            {(loading && !days.length ? Array.from({ length: 7 }, () => null) : days).map((d, i) => {
              if (!d) return <div key={i} className="forecast-day forecast-day--skeleton" />;
              const date = `${d.date}T12:00:00+07:00`;
              const isToday = d.date === todayKey;
              return (
                <div key={d.date} className={`forecast-day ${isToday ? 'forecast-day--active' : ''}`} title={`${d.condition} · ${d.source || 'n/a'}`}>
                  <div className="forecast-day__date">
                    <strong>{isToday ? 'Today' : formatWeekday(date)}</strong>
                    <span>{formatDayMonth(date)}</span>
                  </div>
                  <WeatherIcon kind={d.icon} size={28} className="forecast-day__icon" />
                  <div className="forecast-day__temp">
                    <strong>{d.tmax != null ? `${d.tmax}°` : '—'}</strong>
                    <span>{d.tmin != null ? `${d.tmin}°C` : ''}</span>
                  </div>
                  <div className="forecast-day__rain">
                    <Droplet size={12} strokeWidth={2} />
                    {d.rainMm != null ? `${d.rainMm.toFixed(1)} mm` : '—'}
                  </div>
                  <span className={`forecast-day__src ${d.source === 'BMKG' ? 'is-bmkg' : ''}`}>{d.source || ''}</span>
                </div>
              );
            })}
          </div>
          <p className="muted small forecast__sources">
            {bmkgDays > 0
              ? `Days 1–${bmkgDays}: BMKG · Days ${bmkgDays + 1}–7: Open-Meteo`
              : 'BMKG unavailable — all days from Open-Meteo'}
          </p>
        </>
      )}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="error-state">
      <span>{message}</span>
      <button type="button" className="chip-btn" onClick={onRetry}><RefreshCw size={14} /> Retry</button>
    </div>
  );
}

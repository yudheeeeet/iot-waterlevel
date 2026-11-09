import { config } from '../config';

export default function Footer({ weatherSources = [] }) {
  const weather = weatherSources.length ? `Weather data: ${weatherSources.join(' & ')}` : 'Weather data: BMKG & Open-Meteo';
  return (
    <footer className="dash-footer">
      <span>BARUNA INOTEK &nbsp;/&nbsp; Environmental telemetry</span>
      <span>
        {config.useMock && 'Demo data · Illustrative locations and thresholds · '}
        {weather} · All times WIB (UTC+7)
      </span>
    </footer>
  );
}

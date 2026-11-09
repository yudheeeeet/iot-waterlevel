import { Droplet, Radio, Ruler, CloudRain, Info } from 'lucide-react';
import { config } from '../config';
import { formatNumber, formatTime } from '../utils/format';

function MetricCard({ title, icon: Icon, value, unit, context, contextRight, loading }) {
  return (
    <div className="card metric">
      <div className="metric__head">
        <span className="metric__title">{title}</span>
        <span className="metric__icon"><Icon size={18} strokeWidth={1.75} /></span>
      </div>
      <div className="metric__value">
        <strong>{loading ? '—' : value}</strong>
        {unit && <span>{unit}</span>}
      </div>
      <div className="metric__context">
        <span>{context}</span>
        {contextRight && <span>{contextRight}</span>}
      </div>
    </div>
  );
}

export default function SummaryCards({ summary, selectedDevice, weather, loading }) {
  const total = summary?.devices?.total ?? 0;
  const online = summary?.devices?.online ?? 0;
  const offline = summary?.devices?.offline ?? 0;
  const pct = total ? Math.round((online / total) * 100) : 0;

  // "Current water level" follows the device selected on the map / gauge.
  const current = selectedDevice?.lastReading
    ? { deviceId: selectedDevice.id, ...selectedDevice.lastReading }
    : summary?.latestReading;

  // Rain gauge value from the backend wins; otherwise the weather-forecast estimate.
  const measuredRain = summary?.rainfallTodayMm;
  const rain = measuredRain ?? weather?.today?.rainfallMm;
  const rainContext = measuredRain != null
    ? 'Rainfall recorded today'
    : `Estimated today · ${weather?.today?.rainfallSource || 'forecast'}`;

  return (
    <div className="overview">
      <div className="overview__grid">
        <MetricCard
          title="Average Water Level" icon={Droplet} loading={loading}
          value={formatNumber(summary?.averageDistanceM)} unit="m"
          context="Average across monitored devices"
        />
        <MetricCard
          title="Active Devices" icon={Radio} loading={loading}
          value={online} unit={`/ ${total}`}
          context={`${pct}% online`} contextRight={`${offline} offline`}
        />
        <MetricCard
          title="Current Water Level" icon={Ruler} loading={loading}
          value={current ? formatNumber(current.distanceCm / 100) : '—'} unit="m"
          context={current ? `Latest reading · ${current.deviceId}, ${formatTime(current.timestamp)} WIB` : 'No reading yet'}
        />
        <MetricCard
          title="Today's Rainfall" icon={CloudRain}
          value={rain == null ? '—' : formatNumber(rain, 1)} unit="mm"
          context={rainContext}
        />
      </div>
      <div className="overview__note">
        <Info size={14} strokeWidth={1.75} />
        <span>Water level readings show sensor-to-water distance, not water depth. A smaller distance indicates a higher water surface.</span>
        {config.useMock && <strong className="overview__demo">DEMO DATA</strong>}
      </div>
    </div>
  );
}

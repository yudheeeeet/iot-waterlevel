import { Waves, Info } from 'lucide-react';
import { config } from '../config';
import { formatTime } from '../utils/format';
import { displayStatus, LEVEL_STATUS } from '../utils/status';
import { AccentChip, StatusBadge } from './ui';

// Gauge geometry (matches Figma: 466×206 frame, 290 px dial, 14 px arc)
const W = 466;
const H = 206;
const CX = W / 2;
const CY = 174;
const R = 138;
const STROKE = 14;

const angleFor = (cm) => Math.PI * (1 - Math.min(Math.max(cm, 0), config.thresholds.max) / config.thresholds.max);
const point = (a, r = R) => [CX + r * Math.cos(a), CY - r * Math.sin(a)];

function arc(fromCm, toCm) {
  const [x1, y1] = point(angleFor(fromCm));
  const [x2, y2] = point(angleFor(toCm));
  const large = Math.abs(angleFor(fromCm) - angleFor(toCm)) > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`;
}

export default function CurrentReading({ device }) {
  // Per-device thresholds from the backend; the config values are the fallback (mock).
  const critical = device?.thresholdCriticalCm ?? config.thresholds.critical;
  const warning = device?.thresholdWarningCm ?? config.thresholds.warning;
  const { max } = config.thresholds;
  const intervalSec = device?.reportingIntervalSec ?? config.sampleIntervalSec;
  const reading = device?.lastReading;
  const cm = reading?.distanceCm;
  const status = displayStatus(device);
  const gap = 2; // visual gap between zones, in cm

  const [mx, my] = cm != null ? point(angleFor(cm)) : [null, null];

  return (
    <div className="card gauge-card">
      <div className="gauge-card__head">
        <h2 className="section-title">Last reading</h2>
        {config.useMock ? (
          <AccentChip>Simulated live</AccentChip>
        ) : config.realtime ? (
          <AccentChip pulse>Live</AccentChip>
        ) : (
          <AccentChip>Auto-refresh {Math.round(config.pollIntervalMs / 1000)} s</AccentChip>
        )}
      </div>

      {device && (
        <div className="gauge-card__device">
          <StatusBadge status={status} />
        </div>
      )}

      <div className="gauge">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={cm != null ? `Distance ${cm} centimeters` : 'No reading'}>
          <path d={arc(0, critical - gap)} stroke="var(--error-500)" strokeWidth={STROKE} fill="none" />
          <path d={arc(critical + gap, warning - gap)} stroke="var(--warning-500)" strokeWidth={STROKE} fill="none" />
          <path d={arc(warning + gap, max)} stroke="var(--color-teal-600)" strokeWidth={STROKE} fill="none" />
          {cm != null && device?.online && (
            <circle cx={mx} cy={my} r={STROKE / 2 + 3} fill="#fff" stroke="var(--color-navy-900)" strokeWidth="3" />
          )}
          <text x={CX - R + 4} y={H - 4} className="gauge__tick" textAnchor="middle">0 cm</text>
          <text x={CX + R - 2} y={H - 4} className="gauge__tick" textAnchor="middle">{max} cm</text>
        </svg>
        <div className="gauge__value">
          <div>
            <strong>{cm ?? '—'}</strong>
            <span>cm</span>
          </div>
          <em>{cm != null ? `${(cm / 100).toFixed(2)} m` : '—'}</em>
          <Waves size={26} strokeWidth={1.5} />
        </div>
      </div>

      <div className="thresholds">
        {[
          ['critical', `< ${critical} cm`],
          ['warning', `${critical}–${warning - 1} cm`],
          ['normal', `${warning}–${max} cm`],
        ].map(([k, range]) => (
          <div key={k} className="threshold">
            <span className="threshold__label">
              <span className="dot" style={{ background: k === 'normal' ? 'var(--success-500)' : LEVEL_STATUS[k].color }} />
              {LEVEL_STATUS[k].label}
            </span>
            <span className="muted">{range}</span>
          </div>
        ))}
      </div>

      <p className="note">
        <Info size={14} strokeWidth={1.75} />
        <span>
          {device?.thresholdWarningCm != null ? 'Device thresholds' : 'Illustrative thresholds'}: a smaller gap means a higher water surface.
          {reading && ` Last reading ${formatTime(reading.timestamp, { seconds: true })} WIB · every ${intervalSec} sec.`}
          {device && !reading && ' No readings received yet.'}
          {device && !device.online && ' Device is currently offline.'}
        </span>
      </p>
    </div>
  );
}

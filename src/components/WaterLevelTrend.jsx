import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot,
} from 'recharts';
import { ChevronDown, CalendarDays, ArrowRight, Info } from 'lucide-react';
import { monitoringService } from '../services/monitoringService';
import { saveBlob } from '../services/apiClient';
import {
  formatDate, formatDateTime, formatTime, formatDayMonth, toLocalInputValue, fromLocalInputValue, jakartaDateKey,
} from '../utils/format';
import { levelStatusFromDistance, statusMeta } from '../utils/status';
import { Button } from './ui';

const HOUR = 3600 * 1000;
const RANGES = [
  { key: '6h', label: '6 Hours', ms: 6 * HOUR, live: true },
  { key: '12h', label: '12 Hours', ms: 12 * HOUR, live: true },
  { key: '24h', label: '24 Hours', ms: 24 * HOUR, live: true },
  { key: 'today', label: 'Today', live: true },
  { key: 'week', label: 'Weekly', ms: 7 * 24 * HOUR, live: false },
  { key: 'custom', label: 'Custom', live: false },
];

function windowFor(rangeKey, custom) {
  const now = Date.now();
  const r = RANGES.find((x) => x.key === rangeKey);
  if (rangeKey === 'today') return { from: new Date(`${jakartaDateKey()}T00:00:00+07:00`).getTime(), to: now };
  if (rangeKey === 'custom') return { from: custom.from, to: custom.to };
  return { from: now - r.ms, to: now };
}

export default function WaterLevelTrend({ devices, selectedId, onSelectDevice, lastReading }) {
  const [range, setRange] = useState('6h');
  const [custom, setCustom] = useState(() => ({ from: Date.now() - 6 * HOUR, to: Date.now() }));
  const [win, setWin] = useState(() => windowFor('6h'));
  const [data, setData] = useState([]);
  const [intervalSec, setIntervalSec] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(null);

  const device = devices.find((d) => d.id === selectedId);
  const rangeDef = RANGES.find((r) => r.key === range);

  // Fetch history whenever device or range changes
  useEffect(() => {
    if (!selectedId) return undefined;
    const w = windowFor(range, custom);
    if (!(w.from < w.to)) { setError('Start must be before end'); return undefined; }
    const ctrl = new AbortController();
    setWin(w);
    setLoading(true);
    setError(null);
    monitoringService
      .getReadings(selectedId, { from: w.from, to: w.to, signal: ctrl.signal })
      .then((res) => {
        setIntervalSec(res.intervalSec || 60);
        setData(res.points.map(toPoint));
      })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message || 'Failed to load readings'); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [selectedId, range, custom]);

  // Append realtime readings for live ranges and slide the window
  useEffect(() => {
    if (!lastReading || lastReading.deviceId !== selectedId || !rangeDef?.live) return;
    const p = toPoint(lastReading);
    const w = windowFor(range, custom);
    setWin(w);
    setData((prev) =>
      prev.length && prev[prev.length - 1].t >= p.t ? prev : [...prev.filter((x) => x.t >= w.from), p],
    );
  }, [lastReading, selectedId, range, custom, rangeDef]);

  const yDomain = useMemo(() => {
    if (!data.length) return [0, 5];
    const vals = data.map((d) => d.m);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 0.1) * 2) / 2);
    const hi = Math.ceil((Math.max(...vals) + 0.1) * 2) / 2;
    return [lo, Math.max(hi, lo + 1)];
  }, [data]);
  const yTicks = useMemo(() => {
    const t = [];
    for (let v = yDomain[0]; v <= yDomain[1] + 1e-9; v += 0.5) t.push(+v.toFixed(1));
    return t;
  }, [yDomain]);

  const multiDay = win.to - win.from > 24 * HOUR;
  const xTicks = useMemo(() => {
    const n = 7;
    return Array.from({ length: n }, (_, i) => win.from + ((win.to - win.from) * i) / (n - 1));
  }, [win]);

  const latest = data[data.length - 1];

  const doExport = useCallback(async (format) => {
    if (!selectedId) return;
    setExporting(format);
    try {
      const { blob, filename } = await monitoringService.exportReadings(selectedId, { from: win.from, to: win.to, format });
      saveBlob(blob, filename);
    } catch (e) {
      setError(e.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  }, [selectedId, win]);

  const onCustomChange = (key) => (e) => {
    const t = fromLocalInputValue(e.target.value)?.getTime();
    if (!t) return;
    setCustom((c) => ({ ...c, [key]: t }));
    setRange('custom');
  };

  const shownFrom = range === 'custom' ? custom.from : win.from;
  const shownTo = range === 'custom' ? custom.to : win.to;

  return (
    <div className="card trend">
      <div className="trend__head">
        <div>
          <h2 className="section-title">Water Level Trend</h2>
          <p className="section-sub section-sub--lg">Historical sensor readings and water surface distance.</p>
        </div>
        <div className="trend__actions">
          <label className="select">
            <select value={selectedId || ''} onChange={(e) => onSelectDevice(e.target.value)} aria-label="Device">
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.id} · {d.name}{d.online ? '' : ' (offline)'}</option>
              ))}
            </select>
            <ChevronDown size={16} />
          </label>
          <span className="vr" />
          <span className="muted">Export Data</span>
          <Button onClick={() => doExport('csv')} disabled={!!exporting || !data.length}>{exporting === 'csv' ? 'Exporting…' : 'Export CSV'}</Button>
          <Button onClick={() => doExport('xlsx')} disabled={!!exporting || !data.length}>{exporting === 'xlsx' ? 'Exporting…' : 'Export XLS'}</Button>
        </div>
      </div>

      <div className="trend__controls">
        <div className="segmented" role="tablist">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={range === r.key}
              className={range === r.key ? 'is-active' : ''}
              onClick={() => {
                if (r.key === 'custom') setCustom({ from: win.from, to: win.to });
                setRange(r.key);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="series-key">
          <span className="series-key__line" />
          Sensor-to-water distance
        </div>
      </div>

      <div className="trend__range">
        <span className="trend__interval">
          {describeWindow(win.from, win.to)} &nbsp;/&nbsp; {describeInterval(intervalSec)}
        </span>
        <div className="trend__custom">
          <span className="muted">Custom range</span>
          <label className="date-field">
            <input type="datetime-local" value={toLocalInputValue(shownFrom)} onChange={onCustomChange('from')} aria-label="From" />
            <CalendarDays size={16} />
          </label>
          <ArrowRight size={14} className="muted" />
          <label className="date-field">
            <input type="datetime-local" value={toLocalInputValue(shownTo)} onChange={onCustomChange('to')} aria-label="To" />
            <CalendarDays size={16} />
          </label>
        </div>
      </div>

      <div className="trend__chart">
        <span className="trend__ytitle">Distance (m)</span>
        {error && <div className="chart-overlay chart-overlay--error">{error}</div>}
        {!error && !loading && !data.length && <div className="chart-overlay">No readings in this period.</div>}
        {loading && !data.length && <div className="chart-overlay">Loading readings…</div>}
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data} margin={{ top: 12, right: 32, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0889a8" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#0889a8" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="t" type="number" scale="time" domain={[win.from, win.to]} ticks={xTicks}
              tickFormatter={(t) => (multiDay ? formatDayMonth(t) : formatTime(t))}
              tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} tickMargin={10}
            />
            <YAxis
              domain={yDomain} ticks={yTicks} tickFormatter={(v) => v.toFixed(1)}
              tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} width={44}
            />
            <Tooltip
              content={<TrendTooltip />}
              cursor={{ stroke: '#0889a8', strokeWidth: 1 }}
              defaultIndex={data.length ? data.length - 1 : undefined}
              isAnimationActive={false}
            />
            <Area
              type="monotone" dataKey="m" stroke="#0889a8" strokeWidth={2.5} fill="url(#trendFill)"
              dot={false} activeDot={{ r: 5, fill: '#0889a8', stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {latest && (
              <ReferenceDot x={latest.t} y={latest.m} r={5} fill="#0889a8" stroke="rgba(8,137,168,0.25)" strokeWidth={8} />
            )}
          </AreaChart>
        </ResponsiveContainer>
        <span className="trend__tz">WIB</span>
      </div>

      <div className="trend__foot">
        <span className="note">
          <Info size={13} strokeWidth={1.75} />
          Lower distance = higher water surface · Not water depth
        </span>
        {latest && device && (
          <strong className="trend__latest">
            Latest measurement: {latest.m.toFixed(2)} m · {statusMeta(device.online ? levelStatusFromDistance(latest.cm) : 'offline').label}
          </strong>
        )}
      </div>
    </div>
  );
}

function TrendTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="trend-tooltip">
      <span>{formatDate(p.t)} · {formatTime(p.t)} WIB</span>
      <strong>{p.cm} cm / {p.m.toFixed(2)} m</strong>
    </div>
  );
}

const toPoint = (r) => {
  const t = new Date(r.timestamp).getTime();
  return { t, cm: r.distanceCm, m: r.distanceCm / 100 };
};

function describeWindow(from, to) {
  if (jakartaDateKey(from) === jakartaDateKey(to)) return `${formatDate(from)} · ${formatTime(from)}–${formatTime(to)} WIB`;
  return `${formatDateTime(from, { suffix: false })} – ${formatDateTime(to)}`;
}

function describeInterval(sec) {
  if (!sec || sec <= 60) return '60-second samples';
  const min = Math.round(sec / 60);
  return min >= 60 ? `${Math.round(min / 60)}-hour averages` : `${min}-minute averages`;
}

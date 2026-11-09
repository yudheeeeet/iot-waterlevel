/**
 * In-browser mock of the backend described in the API contract (see README).
 * It returns exactly the shapes the real backend is expected to return, so
 * switching VITE_USE_MOCK=false needs no component changes.
 *
 * Device coordinates are ILLUSTRATIVE positions along the Ciliwung and
 * Cisadane rivers in Kota Bogor — replace them with real data from PostgreSQL.
 */
import { levelStatusFromDistance } from '../utils/status';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// base = typical sensor-to-water distance (cm); amp = daily swing
const SEED_DEVICES = [
  { id: 'BWN-001', name: 'Katulampa Weir', lat: -6.6318, lon: 106.8372, base: 310, amp: 45, online: true },
  { id: 'BWN-002', name: 'Muara Sari', lat: -6.6402, lon: 106.8148, base: 165, amp: 25, online: true },
  { id: 'BWN-003', name: 'Otista Bridge', lat: -6.6071, lon: 106.8031, base: 290, amp: 40, online: true },
  { id: 'BWN-004', name: 'Sempur', lat: -6.5902, lon: 106.8012, base: 340, amp: 35, online: true },
  { id: 'BWN-005', name: 'Bantarjati', lat: -6.5771, lon: 106.8152, base: 275, amp: 30, online: true },
  { id: 'BWN-006', name: 'Empang', lat: -6.6083, lon: 106.7902, base: 178, amp: 22, online: true },
  { id: 'BWN-007', name: 'Batutulis', lat: -6.6248, lon: 106.7992, base: 360, amp: 40, online: true },
  { id: 'BWN-008', name: 'Kedung Halang', lat: -6.5632, lon: 106.8091, base: 88, amp: 10, online: true },
  { id: 'BWN-009', name: 'Cibuluh', lat: -6.5561, lon: 106.8129, base: 300, amp: 35, online: true },
  { id: 'BWN-010', name: 'Kebon Pedes', lat: -6.5752, lon: 106.7958, base: 255, amp: 30, online: true },
  { id: 'BWN-011', name: 'Pasir Kuda', lat: -6.6049, lon: 106.7781, base: 320, amp: 35, online: true },
  { id: 'BWN-012', name: 'Sindang Barang', lat: -6.5801, lon: 106.7652, base: 285, amp: 30, online: true },
  { id: 'BWN-013', name: 'Cilendek', lat: -6.5703, lon: 106.7703, base: 300, amp: 30, online: false, offlineFor: 3 * HOUR },
  { id: 'BWN-014', name: 'Tanah Sareal', lat: -6.5549, lon: 106.7851, base: 270, amp: 30, online: false, offlineFor: 50 * MIN },
  { id: 'BWN-015', name: 'Cipaku', lat: -6.6278, lon: 106.7818, base: 330, amp: 35, online: false, offlineFor: 9 * HOUR },
];

const idx = (id) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0);

/** Smooth, deterministic distance curve so history and live values agree. */
function distanceAt(device, t) {
  const k = idx(device.id);
  const h = t / HOUR;
  const v =
    device.base +
    device.amp * Math.sin((2 * Math.PI * h) / 6 + k) +
    device.amp * 0.35 * Math.sin((2 * Math.PI * h) / 1.6 + k * 0.7) +
    device.amp * 0.12 * Math.sin((2 * Math.PI * h) / 0.37 + k * 1.3);
  return Math.max(20, Math.round(v));
}

const state = {
  devices: SEED_DEVICES.map((d) => ({
    ...d,
    lastSeen: d.online ? Date.now() : Date.now() - d.offlineFor,
    installedAt: '2026-01-15T00:00:00+07:00',
  })),
};

function toPublic(device, now = Date.now()) {
  const t = device.online ? now - (now % MIN) : device.lastSeen;
  const distanceCm = distanceAt(device, t);
  return {
    id: device.id,
    name: device.name,
    lat: device.lat,
    lon: device.lon,
    online: device.online,
    status: levelStatusFromDistance(distanceCm),
    lastReading: { distanceCm, timestamp: new Date(t).toISOString() },
    installedAt: device.installedAt,
  };
}

const find = (id) => {
  const d = state.devices.find((x) => x.id === id);
  if (!d) throw Object.assign(new Error(`Device ${id} not found`), { status: 404 });
  return d;
};

// ── REST mock ────────────────────────────────────────────────────
export const mockApi = {
  async getDevices() {
    await delay();
    return state.devices.map((d) => toPublic(d));
  },

  async createDevice({ id, name, lat, lon }) {
    await delay();
    if (state.devices.some((d) => d.id === id)) {
      throw Object.assign(new Error(`Device ${id} already exists`), { status: 409 });
    }
    const device = { id, name, lat, lon, base: 300, amp: 30, online: true, lastSeen: Date.now(), installedAt: new Date().toISOString() };
    state.devices.push(device);
    return toPublic(device);
  },

  async updateDevice(id, patch) {
    await delay();
    const d = find(id);
    Object.assign(d, pick(patch, ['name', 'lat', 'lon']));
    return toPublic(d);
  },

  async deleteDevice(id) {
    await delay();
    find(id);
    state.devices = state.devices.filter((d) => d.id !== id);
    return null;
  },

  async getSummary() {
    await delay(150);
    const devices = state.devices.map((d) => toPublic(d));
    const online = devices.filter((d) => d.online);
    const avgCm = online.length ? online.reduce((s, d) => s + d.lastReading.distanceCm, 0) / online.length : null;
    const latest = online.sort((a, b) => b.lastReading.timestamp.localeCompare(a.lastReading.timestamp))[0];
    return {
      averageDistanceM: avgCm == null ? null : +(avgCm / 100).toFixed(2),
      devices: { total: devices.length, online: online.length, offline: devices.length - online.length },
      latestReading: latest ? { deviceId: latest.id, ...latest.lastReading } : null,
      rainfallTodayMm: null, // backend may fill this from a rain gauge; UI falls back to the weather estimate
      lastUpdate: new Date().toISOString(),
    };
  },

  /** Downsampled history: at most ~600 points regardless of range. */
  async getReadings(id, { from, to }) {
    await delay(200);
    const d = find(id);
    const start = new Date(from).getTime();
    const end = Math.min(new Date(to).getTime(), d.online ? Date.now() : d.lastSeen);
    const step = Math.max(MIN, Math.ceil((end - start) / 600 / MIN) * MIN);
    const points = [];
    for (let t = start - (start % step) + step; t <= end; t += step) {
      points.push({ timestamp: new Date(t).toISOString(), distanceCm: distanceAt(d, t) });
    }
    return { deviceId: id, intervalSec: step / 1000, points };
  },

  async exportReadings(id, { from, to, format }) {
    const { points } = await this.getReadings(id, { from, to });
    const rows = points.map((p) => [id, p.timestamp, p.distanceCm, (p.distanceCm / 100).toFixed(2), levelStatusFromDistance(p.distanceCm)]);
    const header = ['device_id', 'timestamp', 'distance_cm', 'distance_m', 'status'];
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'xlsx') {
      return { blob: toSpreadsheetXml(header, rows), filename: `${id}_readings_${stamp}.xls` };
    }
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    return { blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename: `${id}_readings_${stamp}.csv` };
  },
};

// ── Realtime mock (stands in for WS /ws/readings) ────────────────
export function mockSubscribe(onMessage, { intervalMs = 10000 } = {}) {
  const emit = () => {
    const now = Date.now();
    state.devices.filter((d) => d.online).forEach((d) => {
      d.lastSeen = now;
      const distanceCm = distanceAt(d, now);
      onMessage({
        type: 'reading',
        data: { deviceId: d.id, distanceCm, timestamp: new Date(now).toISOString(), status: levelStatusFromDistance(distanceCm), online: true },
      });
    });
  };
  const timer = setInterval(emit, intervalMs);
  return () => clearInterval(timer);
}

// ── helpers ──────────────────────────────────────────────────────
function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

function toSpreadsheetXml(header, rows) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const row = (cells) => `<Row>${cells.map((c) => `<Cell><Data ss:Type="${typeof c === 'number' ? 'Number' : 'String'}">${esc(c)}</Data></Cell>`).join('')}</Row>`;
  const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Readings"><Table>${row(header)}${rows.map(row).join('')}</Table></Worksheet></Workbook>`;
  return new Blob([xml], { type: 'application/vnd.ms-excel' });
}


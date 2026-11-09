# Baruna Inotek · Water Level Monitoring — Frontend

React + Vite dashboard built from the Figma design **"PT Baruna Inovasi Teknologi" → BARUNA INOTEK · Water level monitoring**.

| Area | Library / source |
|---|---|
| UI | React 19 + Vite 7, plain CSS with design tokens (`src/styles/tokens.css`) |
| Map | Leaflet + react-leaflet (Esri World Imagery satellite, OpenTopoMap terrain) |
| Chart | Recharts (area chart) · custom SVG semicircle gauge |
| Icons | lucide-react (same icon set used in the Figma file) |
| Weather | BMKG open data (days 1–3) + Open-Meteo (days 4–7 & fallback), Kota Bogor |
| Sensor data | Backend REST + WebSocket (backend consumes MQTT QoS 1 and stores to PostgreSQL) |

## Run

```bash
npm install
cp .env.example .env      # already included; edit as needed
npm run dev               # http://localhost:5173
npm run build             # production build in dist/
```

With the default `.env` (`VITE_USE_MOCK=true`) the app runs fully without a backend: devices, history,
live updates (every 10 s), add/edit/remove and CSV/XLS export are served by `src/mocks/mockBackend.js`.
Weather is fetched live from BMKG (through the Vite `/bmkg` proxy) and Open-Meteo.
Set `VITE_WEATHER_SOURCE=mock` to work fully offline.

### Switching to the real backend
1. Set `VITE_USE_MOCK=false`.
2. In development, point `VITE_BACKEND_PROXY_TARGET` at your server (the Vite proxy forwards `/api` and `/ws`).
   In production, set `VITE_API_URL` (and `VITE_WS_URL` if the socket lives elsewhere).
3. For production, set `VITE_WEATHER_SOURCE=backend` and let the backend serve `/api/weather` (cached), since the
   `/bmkg` proxy only exists in the Vite dev server.

## Architecture

```
Sensor ──MQTT QoS1──► Broker ──► Backend ──► PostgreSQL
                                   ├── REST  /api/*        ─► frontend (initial data, history, export, CRUD)
                                   └── WS    /ws/readings  ─► frontend (live readings, status, summary)
BMKG + Open-Meteo ──► (backend cache, prod) ──► frontend
```

```
src/
  config.js                 env-driven settings, thresholds (100 / 200 / 500 cm)
  services/
    apiClient.js            fetch wrapper, file download helper
    monitoringService.js    devices, summary, readings, export  (mock ↔ REST switch)
    realtimeService.js      WebSocket with exponential-backoff reconnect (mock ↔ WS switch)
    weather/                BMKG + Open-Meteo fetch, normalisation, 7-day merge
  mocks/mockBackend.js      in-browser backend that follows the API contract below
  hooks/                    useMonitoring (data + realtime + CRUD), useWeather
  components/               Header, SummaryCards, map/DeviceMap, CurrentReading, Weather, WaterLevelTrend, Footer
  styles/                   tokens.css (Figma variables), app.css
```

## API contract expected from the backend

All timestamps ISO-8601 (UTC or with offset). Distances in **cm**, sensor-to-water (smaller = higher water).

**Device**
```json
{ "id": "BWN-003", "name": "Otista Bridge", "lat": -6.6071, "lon": 106.8031,
  "online": true, "status": "normal",
  "lastReading": { "distanceCm": 285, "timestamp": "2026-11-09T07:30:00Z" },
  "installedAt": "2026-01-15T00:00:00+07:00" }
```
`status`: `normal` (≥ 200 cm) · `warning` (100–199) · `critical` (< 100) — computed by the backend.
`online`: decided by the backend (e.g. no message for N × 60 s, or MQTT Last Will).

| Method | Path | Response / body |
|---|---|---|
| GET | `/api/devices` | `Device[]` |
| POST | `/api/devices` | body `{ id, name, lat, lon }` → `Device` |
| PATCH | `/api/devices/:id` | body `{ name?, lat?, lon? }` → `Device` |
| DELETE | `/api/devices/:id` | `204` |
| GET | `/api/summary` | `{ averageDistanceM, devices: { total, online, offline }, latestReading: { deviceId, distanceCm, timestamp }, rainfallTodayMm \| null, lastUpdate }` |
| GET | `/api/devices/:id/readings?from&to` | `{ deviceId, intervalSec, points: [{ timestamp, distanceCm }] }` — **downsample** long ranges (≈ ≤ 600 points) and set `intervalSec` |
| GET | `/api/devices/:id/readings/export?format=csv\|xlsx&from&to` | file download with `Content-Disposition: attachment; filename=…` |
| GET | `/api/weather` | same object as `weatherService` returns (see `src/services/weather/weatherService.js`) |
| WS | `/ws/readings` | JSON messages below |

WebSocket messages:
```json
{ "type": "reading", "data": { "deviceId": "BWN-003", "distanceCm": 284, "timestamp": "…", "status": "normal", "online": true } }
{ "type": "device_status", "data": { "deviceId": "BWN-013", "online": false, "lastSeen": "…" } }
{ "type": "summary", "data": { /* same as GET /api/summary */ } }
```

Backend notes:
- MQTT **QoS 1 is at-least-once** → de-duplicate with a unique constraint on `(device_id, timestamp)` and
  `INSERT … ON CONFLICT DO NOTHING`.
- `rainfallTodayMm` may stay `null` until a rain gauge exists; the UI then shows the BMKG forecast estimate.

## Weather logic (Kota Bogor)
- BMKG `api.bmkg.go.id/publik/prakiraan-cuaca?adm4=32.71.03.1002` (Kel. Paledang, Bogor Tengah) — change with `VITE_BMKG_ADM4`.
  3-hour slots are aggregated per day (min/max temp, total rain, most significant condition).
- Open-Meteo by coordinates (`VITE_LOCATION_LAT/LON`) fills days 4–7, the "feels like" value, and replaces BMKG entirely if BMKG fails.
- "Today's Rainfall" is an **estimate** (sum of forecast precipitation) unless the backend sends `rainfallTodayMm`.
- Attribution to BMKG (mandatory) and Open-Meteo (CC BY 4.0) is shown in the forecast card and footer.

## To finish before production
- Logo: put your file in `public/` and set `VITE_LOGO_URL=/your-file.png` in `.env` (or replace `src/assets/logo-baruna-inotek.svg`). The official white logo can be exported from
  Figma node **"SVG Logo Baruna Inotek B&W" (21037:140)**.
- Mock device coordinates are illustrative points along the Ciliwung/Cisadane in Kota Bogor — real ones come from PostgreSQL.
- Confirm the threshold values (100 / 200 / 500 cm) per site; they live in `src/config.js`.

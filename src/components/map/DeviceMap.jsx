import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ScaleControl, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Layers, Plus, Minus, Navigation, X } from 'lucide-react';
import { config } from '../../config';
import { formatDayMonth, formatTime } from '../../utils/format';
import { displayStatus, statusMeta, LEVEL_STATUS } from '../../utils/status';
import { Button, StatusBadge, Modal } from '../ui';
import DevicePanel from './DevicePanel';

const LAYERS = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics, GIS User Community',
    maxZoom: 19,
    overlay: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
  },
};

function markerIcon(device, { selected, showLabel }) {
  const status = displayStatus(device);
  const color = statusMeta(status).color;
  const label = showLabel
    ? `<span class="dm-label${selected ? ' dm-label--selected' : ''}">${device.id}${selected ? '' : ` · ${escapeHtml(device.name)}`}</span>`
    : '';
  const size = selected ? 32 : 24;
  return L.divIcon({
    className: 'dm',
    html: `<span class="dm-halo${selected ? ' dm-halo--selected' : ''}" style="--c:${color};width:${size}px;height:${size}px">
             <span class="dm-dot" style="background:${color}"></span>
           </span>${label}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

const draftIcon = L.divIcon({
  className: 'dm',
  html: '<span class="dm-halo dm-halo--draft"><span class="dm-dot"></span></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

export default function DeviceMap({ devices, selectedId, onSelect, onAdd, onUpdate, onRemove }) {
  const [map, setMap] = useState(null);
  const [layer, setLayer] = useState('satellite');
  const [panel, setPanel] = useState(null); // { mode: 'add'|'edit', draft: {id,name,lat,lon} }
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const fitted = useRef(false);

  const selected = devices.find((d) => d.id === selectedId);

  // Fit all devices on first load
  useEffect(() => {
    if (!map || fitted.current || devices.length === 0) return;
    map.fitBounds(L.latLngBounds(devices.map((d) => [d.lat, d.lon])), { padding: [40, 40], maxZoom: 15 });
    fitted.current = true;
  }, [map, devices]);

  const openAdd = () => {
    const c = map?.getCenter();
    setActionError(null);
    setPanel({ mode: 'add', draft: { id: nextId(devices), name: '', lat: round6(c?.lat ?? config.location.lat), lon: round6(c?.lng ?? config.location.lon) } });
  };
  const openEdit = () => {
    if (!selected) return;
    setActionError(null);
    setPanel({ mode: 'edit', draft: { id: selected.id, name: selected.name, lat: selected.lat, lon: selected.lon } });
  };

  const submitPanel = async (draft) => {
    setBusy(true);
    setActionError(null);
    try {
      if (panel.mode === 'add') await onAdd(draft);
      else await onUpdate(draft.id, { name: draft.name, lat: draft.lat, lon: draft.lon });
      setPanel(null);
    } catch (e) {
      setActionError(e.message || 'Could not save device');
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async () => {
    setBusy(true);
    try {
      await onRemove(selected.id);
      setConfirmRemove(false);
    } catch (e) {
      setActionError(e.message || 'Could not remove device');
      setConfirmRemove(false);
    } finally {
      setBusy(false);
    }
  };

  const tiles = LAYERS[layer];

  return (
    <div className="card map-card">
      <div className="map-card__head">
        <div>
          <h2 className="section-title">Device locations</h2>
          <p className="section-sub">{config.location.mapSubtitle}</p>
        </div>
        <button type="button" className="chip-btn" onClick={() => setLayer((l) => (l === 'satellite' ? 'terrain' : 'satellite'))}>
          <Layers size={15} strokeWidth={1.75} />
          {layer === 'satellite' ? 'Terrain view' : 'Satellite view'}
        </button>
      </div>

      <div className="map-card__map">
        <MapContainer
          ref={setMap}
          center={[config.location.lat, config.location.lon]}
          zoom={config.location.mapZoom}
          zoomControl={false}
          attributionControl
          className="leaflet-host"
        >
          <TileLayer key={layer} url={tiles.url} attribution={tiles.attribution} maxZoom={tiles.maxZoom} />
          {tiles.overlay && <TileLayer url={tiles.overlay} maxZoom={tiles.maxZoom} opacity={0.85} />}
          <ScaleControl position="bottomleft" imperial={false} />

          {devices.map((d) => (
            <DeviceMarker
              key={d.id}
              device={d}
              selected={d.id === selectedId}
              onSelect={onSelect}
            />
          ))}

          {panel && Number.isFinite(panel.draft.lat) && Number.isFinite(panel.draft.lon) && (
            <Marker position={[panel.draft.lat, panel.draft.lon]} icon={draftIcon} interactive={false} />
          )}
          {panel && (
            <PickCoordinates
              onPick={(lat, lon) => setPanel((p) => ({ ...p, draft: { ...p.draft, lat: round6(lat), lon: round6(lon) } }))}
            />
          )}
        </MapContainer>

        <div className="map-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => map?.zoomIn()}><Plus size={17} strokeWidth={1.75} /></button>
          <button type="button" aria-label="Zoom out" onClick={() => map?.zoomOut()}><Minus size={17} strokeWidth={1.75} /></button>
        </div>
        <div className="map-north" aria-hidden="true">
          <span>N</span>
          <Navigation size={18} strokeWidth={1.75} />
        </div>

        {panel && (
          <DevicePanel
            mode={panel.mode}
            draft={panel.draft}
            onChange={(draft) => setPanel((p) => ({ ...p, draft }))}
            onCancel={() => setPanel(null)}
            onSubmit={submitPanel}
            busy={busy}
            error={actionError}
          />
        )}
      </div>

      <div className="map-card__toolbar">
        <div className="legend">
          {['normal', 'warning', 'critical', 'offline'].map((k) => (
            <span key={k} className="legend__item">
              <span className="dot" style={{ background: LEVEL_STATUS[k].color }} />
              {LEVEL_STATUS[k].label}
            </span>
          ))}
        </div>
        {actionError && !panel && <span className="form-error">{actionError}</span>}
        <div className="map-card__actions">
          <Button variant="primary" onClick={openAdd}>Add Device</Button>
          <Button onClick={openEdit} disabled={!selected}>Edit Coordinates</Button>
          <Button variant="danger" onClick={() => setConfirmRemove(true)} disabled={!selected}>Remove Device</Button>
        </div>
      </div>

      {confirmRemove && selected && (
        <Modal
          title="Remove device?"
          onClose={() => setConfirmRemove(false)}
          footer={
            <>
              <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
              <Button variant="danger-solid" onClick={doRemove} disabled={busy}>{busy ? 'Removing…' : 'Remove'}</Button>
            </>
          }
        >
          <p>
            <strong>{selected.id} · {selected.name}</strong> will be removed from the dashboard.
            Its stored readings stay in the database unless the backend deletes them.
          </p>
        </Modal>
      )}
    </div>
  );
}

function DeviceMarker({ device, selected, onSelect }) {
  const ref = useRef(null);
  const status = displayStatus(device);
  const showLabel = selected || status === 'warning' || status === 'critical';
  const icon = useMemo(
    () => markerIcon(device, { selected, showLabel }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device.id, device.name, status, selected, showLabel],
  );

  useEffect(() => {
    if (selected) ref.current?.openPopup();
  }, [selected]);

  return (
    <Marker
      ref={ref}
      position={[device.lat, device.lon]}
      icon={icon}
      zIndexOffset={selected ? 1000 : status === 'normal' ? 0 : 500}
      eventHandlers={{ click: () => onSelect(device.id) }}
      title={`${device.id} · ${device.name}`}
    >
      <Popup className="dm-popup" closeButton={false} autoPanPadding={[24, 24]} minWidth={250}>
        <DevicePopup device={device} status={status} onClose={() => ref.current?.closePopup()} />
      </Popup>
    </Marker>
  );
}

function DevicePopup({ device, status, onClose }) {
  const r = device.lastReading;
  return (
    <div className="dm-popup__body">
      <div className="dm-popup__head">
        <div>
          <span className="dm-popup__id">{device.id}</span>
          <strong className="dm-popup__name">{device.name}</strong>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button>
      </div>
      <p className="dm-popup__coords">Lat {device.lat.toFixed(4)}° · Long {device.lon.toFixed(4)}°</p>
      <div className="dm-popup__reading">
        <div>
          <span className="muted">Sensor-to-water distance</span>
          <strong>{r ? `${(r.distanceCm / 100).toFixed(2)} m` : '—'}</strong>
        </div>
        <StatusBadge status={device.online ? 'normal' : 'offline'} label={device.online ? 'Online' : 'Offline'} />
      </div>
      <p className="dm-popup__updated">
        {r ? `Updated ${formatDayMonth(r.timestamp)} · ${formatTime(r.timestamp, { seconds: true })} WIB` : 'No readings yet'}
        {status !== 'offline' && status !== 'normal' && ` · ${statusMeta(status).label}`}
      </p>
    </div>
  );
}

function PickCoordinates({ onPick }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function nextId(devices) {
  const max = devices.reduce((m, d) => Math.max(m, Number(d.id.replace(/\D/g, '')) || 0), 0);
  return `BWN-${String(max + 1).padStart(3, '0')}`;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

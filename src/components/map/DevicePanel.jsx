import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { X, MousePointerClick } from 'lucide-react';
import { Button } from '../ui';

const NUMERIC_KEYS = new Set(['lat', 'lon', 'sensorHeightCm']);
const SENSOR_HEIGHT_MAX_CM = 2000;

/**
 * Floating form over the map for Add Device / Edit Device (name, coordinates, sensor height).
 * It is not a full-screen modal so the map stays clickable to pick coordinates.
 */
export default function DevicePanel({ mode, draft, onChange, onCancel, onSubmit, busy, error }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    L.DomEvent.disableClickPropagation(ref.current);
    L.DomEvent.disableScrollPropagation(ref.current);
  }, []);

  const set = (key) => (e) => {
    const raw = e.target.value;
    onChange({ ...draft, [key]: NUMERIC_KEYS.has(key) ? (raw === '' ? NaN : Number(raw)) : raw });
  };

  // Sensor height is optional: empty (NaN) is allowed, otherwise 0 < h ≤ 2000 cm (same rule as the backend).
  const height = draft.sensorHeightCm;
  const heightSet = Number.isFinite(height);
  const heightValid = !heightSet || (height > 0 && height <= SENSOR_HEIGHT_MAX_CM);

  const valid =
    /^[A-Za-z0-9-_]{2,32}$/.test(draft.id || '') &&
    (draft.name || '').trim().length > 0 &&
    Number.isFinite(draft.lat) && draft.lat >= -90 && draft.lat <= 90 &&
    Number.isFinite(draft.lon) && draft.lon >= -180 && draft.lon <= 180 &&
    heightValid;

  return (
    <form
      ref={ref}
      className="device-panel"
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit({ ...draft, name: draft.name.trim() }); }}
    >
      <div className="device-panel__head">
        <strong>{mode === 'add' ? 'Add device' : 'Edit device'}</strong>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onCancel}><X size={15} /></button>
      </div>

      <label className="field">
        <span>Device ID</span>
        <input value={draft.id} onChange={set('id')} disabled={mode === 'edit'} placeholder="BWN-016" />
      </label>
      <label className="field">
        <span>Location name</span>
        <input value={draft.name} onChange={set('name')} placeholder="e.g. Sempur Bridge" autoFocus={mode === 'add'} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Latitude</span>
          <input type="number" lang="en" inputMode="decimal" step="0.000001" min="-90" max="90" placeholder="-6.595000"
            value={Number.isFinite(draft.lat) ? draft.lat : ''} onChange={set('lat')} />
        </label>
        <label className="field">
          <span>Longitude</span>
          <input type="number" lang="en" inputMode="decimal" step="0.000001" min="-180" max="180" placeholder="106.797000"
            value={Number.isFinite(draft.lon) ? draft.lon : ''} onChange={set('lon')} />
        </label>
      </div>
      <p className="device-panel__hint"><MousePointerClick size={13} /> Click on the map to set the coordinates.</p>
      <label className="field">
        <span>Sensor height from substrate (cm)</span>
        <input type="number" lang="en" inputMode="decimal" step="0.01" min="0.01" max={SENSOR_HEIGHT_MAX_CM} placeholder="e.g. 380"
          aria-invalid={!heightValid} value={heightSet ? height : ''} onChange={set('sensorHeightCm')} />
        <small className={`field__help${heightValid ? '' : ' field__help--error'}`}>
          {!heightValid
            ? `Must be more than 0 and at most ${SENSOR_HEIGHT_MAX_CM} cm.`
            : heightSet
              ? `= ${(height / 100).toFixed(2)} m · used to show water depth`
              : 'Optional · used to show water depth'}
        </small>
      </label>
      {error && <p className="form-error">{error}</p>}

      <div className="device-panel__actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!valid || busy}>
          {busy ? 'Saving…' : mode === 'add' ? 'Add device' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

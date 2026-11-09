import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { X, MousePointerClick } from 'lucide-react';
import { Button } from '../ui';

/**
 * Floating form over the map for Add Device / Edit Coordinates.
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
    onChange({ ...draft, [key]: key === 'lat' || key === 'lon' ? (raw === '' ? NaN : Number(raw)) : raw });
  };

  const valid =
    /^[A-Za-z0-9-_]{2,32}$/.test(draft.id || '') &&
    (draft.name || '').trim().length > 0 &&
    Number.isFinite(draft.lat) && draft.lat >= -90 && draft.lat <= 90 &&
    Number.isFinite(draft.lon) && draft.lon >= -180 && draft.lon <= 180;

  return (
    <form
      ref={ref}
      className="device-panel"
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit({ ...draft, name: draft.name.trim() }); }}
    >
      <div className="device-panel__head">
        <strong>{mode === 'add' ? 'Add device' : 'Edit coordinates'}</strong>
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
          <input type="number" step="0.000001" value={Number.isFinite(draft.lat) ? draft.lat : ''} onChange={set('lat')} />
        </label>
        <label className="field">
          <span>Longitude</span>
          <input type="number" step="0.000001" value={Number.isFinite(draft.lon) ? draft.lon : ''} onChange={set('lon')} />
        </label>
      </div>
      <p className="device-panel__hint"><MousePointerClick size={13} /> Click on the map to set the coordinates.</p>
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

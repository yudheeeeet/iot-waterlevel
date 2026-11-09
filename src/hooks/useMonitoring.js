import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { monitoringService } from '../services/monitoringService';
import { subscribeRealtime } from '../services/realtimeService';
import { config } from '../config';

/**
 * Devices, summary and realtime state for the dashboard.
 * Initial data comes from REST; updates arrive over the realtime channel.
 */
export function useMonitoring() {
  const [devices, setDevices] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [realtimeState, setRealtimeState] = useState('connecting');
  const [lastReading, setLastReading] = useState(null); // most recent realtime reading (any device)
  const [lastUpdate, setLastUpdate] = useState(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const load = useCallback(async () => {
    try {
      const [devs, sum] = await Promise.all([monitoringService.getDevices(), monitoringService.getSummary()]);
      setDevices(devs);
      setSummary(sum);
      setLastUpdate(sum?.lastUpdate || new Date().toISOString());
      setSelectedId((cur) => cur ?? pickDefault(devs));
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime channel
  useEffect(() => {
    const unsubscribe = subscribeRealtime((msg) => {
      if (msg?.type === 'reading') {
        const r = msg.data;
        setDevices((list) =>
          list.map((d) =>
            d.id === r.deviceId
              ? { ...d, online: r.online ?? true, status: r.status ?? d.status, lastReading: { distanceCm: r.distanceCm, timestamp: r.timestamp } }
              : d,
          ),
        );
        setLastReading(r);
        setLastUpdate(r.timestamp);
      } else if (msg?.type === 'device_status') {
        const s = msg.data;
        setDevices((list) => list.map((d) => (d.id === s.deviceId ? { ...d, online: s.online } : d)));
      } else if (msg?.type === 'summary') {
        setSummary(msg.data);
        setLastUpdate(msg.data?.lastUpdate || new Date().toISOString());
      }
    }, setRealtimeState);
    return unsubscribe;
  }, []);

  // Fallback polling of the summary (keeps cards fresh if the socket is down,
  // and lets the backend correct anything derived on the client).
  useEffect(() => {
    const t = setInterval(async () => {
      try { setSummary(await monitoringService.getSummary()); } catch { /* keep last value */ }
    }, config.pollIntervalMs);
    return () => clearInterval(t);
  }, []);

  // Client-side summary derived from live device state; backend values win where present.
  const liveSummary = useMemo(() => {
    const online = devices.filter((d) => d.online && d.lastReading);
    const avgCm = online.length ? online.reduce((s, d) => s + d.lastReading.distanceCm, 0) / online.length : null;
    return {
      ...summary,
      averageDistanceM: avgCm != null ? +(avgCm / 100).toFixed(2) : summary?.averageDistanceM ?? null,
      devices: devices.length
        ? { total: devices.length, online: devices.filter((d) => d.online).length, offline: devices.filter((d) => !d.online).length }
        : summary?.devices,
    };
  }, [devices, summary]);

  // ── device CRUD ───────────────────────────────────────────────
  const addDevice = useCallback(async (input) => {
    const created = await monitoringService.createDevice(input);
    setDevices((list) => [...list, created]);
    setSelectedId(created.id);
    return created;
  }, []);

  const updateDevice = useCallback(async (id, patch) => {
    const updated = await monitoringService.updateDevice(id, patch);
    setDevices((list) => list.map((d) => (d.id === id ? { ...d, ...updated } : d)));
    return updated;
  }, []);

  const removeDevice = useCallback(async (id) => {
    await monitoringService.deleteDevice(id);
    setDevices((list) => {
      const next = list.filter((d) => d.id !== id);
      if (selectedRef.current === id) setSelectedId(pickDefault(next));
      return next;
    });
  }, []);

  const selectedDevice = devices.find((d) => d.id === selectedId) || null;

  return {
    devices, summary: liveSummary, selectedId, selectedDevice, setSelectedId,
    loading, error, reload: load, realtimeState, lastReading, lastUpdate,
    addDevice, updateDevice, removeDevice,
  };
}

function pickDefault(devices) {
  return (devices.find((d) => d.online) || devices[0])?.id ?? null;
}

/**
 * Monitoring data: devices, summary, readings history, export.
 * Each function switches between the mock backend and the real REST API
 * (contract documented in README.md).
 */
import { config } from '../config';
import { request, download } from './apiClient';
import { mockApi } from '../mocks/mockBackend';

const useMock = config.useMock;

export const monitoringService = {
  /** GET /api/devices → Device[] */
  getDevices: () => (useMock ? mockApi.getDevices() : request('/api/devices')),

  /** POST /api/devices  body { id, name, lat, lon } → Device */
  createDevice: (device) =>
    useMock ? mockApi.createDevice(device) : request('/api/devices', { method: 'POST', body: device }),

  /** PATCH /api/devices/:id  body { name?, lat?, lon? } → Device */
  updateDevice: (id, patch) =>
    useMock ? mockApi.updateDevice(id, patch) : request(`/api/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),

  /** DELETE /api/devices/:id → 204 */
  deleteDevice: (id) =>
    useMock ? mockApi.deleteDevice(id) : request(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** GET /api/summary → Summary */
  getSummary: () => (useMock ? mockApi.getSummary() : request('/api/summary')),

  /**
   * GET /api/devices/:id/readings?from&to&interval
   * → { deviceId, intervalSec, points: [{ timestamp, distanceCm }] }
   * The backend is expected to downsample long ranges.
   */
  getReadings: (id, { from, to, signal }) =>
    useMock
      ? mockApi.getReadings(id, { from, to })
      : request(`/api/devices/${encodeURIComponent(id)}/readings`, {
          query: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
          signal,
        }),

  /** GET /api/devices/:id/readings/export?format=csv|xlsx&from&to → file */
  exportReadings: async (id, { from, to, format }) => {
    if (useMock) return mockApi.exportReadings(id, { from, to, format });
    const { blob, filename } = await download(`/api/devices/${encodeURIComponent(id)}/readings/export`, {
      format,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    return { blob, filename: filename || `${id}_readings.${format}` };
  },
};

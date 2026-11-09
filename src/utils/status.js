import { config } from '../config';

export const LEVEL_STATUS = {
  normal: { key: 'normal', label: 'Normal', color: 'var(--success-500)', text: 'var(--success-600)', bg: 'var(--success-50)' },
  warning: { key: 'warning', label: 'Warning', color: 'var(--warning-500)', text: 'var(--warning-600)', bg: 'var(--warning-50)' },
  critical: { key: 'critical', label: 'Critical', color: 'var(--error-500)', text: 'var(--error-600)', bg: 'var(--error-50)' },
  offline: { key: 'offline', label: 'Offline', color: 'var(--offline-500)', text: 'var(--gray-light-500)', bg: 'var(--color-surface-subtle)' },
};

/** Level status from a sensor-to-water distance in cm (backend should send the same). */
export function levelStatusFromDistance(distanceCm) {
  if (distanceCm == null || Number.isNaN(distanceCm)) return 'offline';
  if (distanceCm < config.thresholds.critical) return 'critical';
  if (distanceCm < config.thresholds.warning) return 'warning';
  return 'normal';
}

/** Status shown on the map / badges: offline wins over level status. */
export function displayStatus(device) {
  if (!device) return 'offline';
  if (!device.online) return 'offline';
  return device.status || levelStatusFromDistance(device.lastReading?.distanceCm);
}

export const statusMeta = (key) => LEVEL_STATUS[key] || LEVEL_STATUS.offline;

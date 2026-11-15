import type { LevelStatus } from '../devices/repo.js';

/**
 * IN-5: status from the sensor-to-water distance (smaller distance = higher water).
 *   critical: level < threshold_critical_cm
 *   warning : level < threshold_warning_cm
 *   normal  : otherwise
 */
export function computeStatus(levelCm: number, t: { warningCm: number; criticalCm: number }): LevelStatus {
  if (levelCm < t.criticalCm) return 'critical';
  if (levelCm < t.warningCm) return 'warning';
  return 'normal';
}

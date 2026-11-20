/**
 * Water level (cm) = sensor height from substrate − sensor-to-water distance.
 * Same rule as the backend export (water_level_cm): null when either value is missing,
 * and a distance above the height (dry bed or a wrong height) is clamped to 0 and flagged.
 */
export function waterLevel(sensorHeightCm, distanceCm) {
  if (sensorHeightCm == null || distanceCm == null) return null;
  const cm = sensorHeightCm - distanceCm;
  return { cm: Math.max(0, cm), invalid: cm < 0 };
}

/** Water level of a device's latest reading, or null. */
export const deviceWaterLevel = (device) => waterLevel(device?.sensorHeightCm, device?.lastReading?.distanceCm);

/** "818.9" — water level is shown in cm with one decimal. */
export const formatLevelCm = (cm) => (cm == null || Number.isNaN(cm) ? '—' : Number(cm).toFixed(1));

export const MISSING_HEIGHT_HINT = 'Set sensor height in Edit Device';

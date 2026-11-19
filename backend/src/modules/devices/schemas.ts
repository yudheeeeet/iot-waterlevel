import { z } from 'zod';

/** Also the MQTT username and part of the topic: no '/', '+', '#' or spaces (same rule as the DB check). */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const DeviceId = z
  .string()
  .regex(DEVICE_ID_PATTERN, 'ID hanya boleh huruf, angka, "-" dan "_" (maksimal 64 karakter)');

const Name = z.string().trim().min(1, 'Nama wajib diisi').max(120, 'Nama maksimal 120 karakter');
const Lat = z.number({ error: 'lat wajib berupa angka' }).min(-90, 'lat harus -90..90').max(90, 'lat harus -90..90');
const Lon = z.number({ error: 'lon wajib berupa angka' }).min(-180, 'lon harus -180..180').max(180, 'lon harus -180..180');
const IntervalSec = z.number().int().min(10, 'Interval minimal 10 detik').max(3600, 'Interval maksimal 3600 detik');
const ThresholdCm = z.number().int().min(1).max(100_000);
const InstalledAt = z.iso.datetime({ offset: true, error: 'installedAt harus tanggal ISO-8601' });
/** Sensor height above the substrate (bottom of the water), cm like the readings; same range as the DB check. */
const SensorHeightCm = z
  .number({ error: 'sensorHeightCm wajib berupa angka' })
  .gt(0, 'sensorHeightCm harus lebih dari 0 cm')
  .max(2000, 'sensorHeightCm maksimal 2000 cm');

const thresholdOrder = (v: { thresholdWarningCm?: number | undefined; thresholdCriticalCm?: number | undefined }) =>
  v.thresholdWarningCm === undefined || v.thresholdCriticalCm === undefined || v.thresholdCriticalCm < v.thresholdWarningCm;
const thresholdOrderIssue = {
  message: 'thresholdCriticalCm harus lebih kecil dari thresholdWarningCm (jarak sensor ke air)',
  path: ['thresholdCriticalCm'],
};

export const CreateDeviceBody = z
  .object({
    id: DeviceId,
    name: Name,
    lat: Lat,
    lon: Lon,
    reportingIntervalSec: IntervalSec.optional(),
    thresholdWarningCm: ThresholdCm.optional(),
    thresholdCriticalCm: ThresholdCm.optional(),
    installedAt: InstalledAt.optional(),
    sensorHeightCm: SensorHeightCm.optional(),
  })
  .refine(thresholdOrder, thresholdOrderIssue);
export type CreateDeviceInput = z.infer<typeof CreateDeviceBody>;

export const UpdateDeviceBody = z
  .object({
    name: Name.optional(),
    lat: Lat.optional(),
    lon: Lon.optional(),
    reportingIntervalSec: IntervalSec.optional(),
    /** null = back to the default formula max(300, interval × 3). */
    offlineAfterSec: z.number().int().min(30).max(86_400).nullable().optional(),
    thresholdWarningCm: ThresholdCm.optional(),
    thresholdCriticalCm: ThresholdCm.optional(),
    installedAt: InstalledAt.nullable().optional(),
    /** null = clear it (water depth is no longer shown). */
    sensorHeightCm: SensorHeightCm.nullable().optional(),
    isEnabled: z.boolean().optional(),
    /** `manual` broker mode: the admin confirms the console steps were done. */
    brokerSynced: z.literal(true).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Tidak ada field yang diubah' })
  .refine(thresholdOrder, thresholdOrderIssue);
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceBody>;

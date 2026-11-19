import type { Sql } from '../../db/client.js';

export type BrokerSyncStatus = 'pending' | 'synced' | 'needs_token_rotation' | 'error';
export type LevelStatus = 'normal' | 'warning' | 'critical';

export interface DeviceRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  locationSource: 'manual' | 'gps';
  reportingIntervalSec: number;
  offlineAfterSec: number | null;
  /** offline_after_sec, or the default max(300, interval × 3). */
  effectiveOfflineAfterSec: number;
  thresholdWarningCm: number;
  thresholdCriticalCm: number;
  isEnabled: boolean;
  brokerSyncStatus: BrokerSyncStatus;
  lastSeenAt: Date | null;
  lastReadingCm: string | null; // numeric → string in postgres.js
  lastReadingAt: Date | null;
  lastStatus: LevelStatus | null;
  sensorHeightCm: string | null; // numeric → string in postgres.js
  installedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tokenLast4: string | null;
  online: boolean;
}

/** Columns that PATCH may change (camelCase input → column). */
export interface DevicePatch {
  name?: string;
  lat?: number;
  lon?: number;
  reporting_interval_sec?: number;
  offline_after_sec?: number | null;
  threshold_warning_cm?: number;
  threshold_critical_cm?: number;
  installed_at?: string | null;
  sensor_height_cm?: number | null;
  is_enabled?: boolean;
}

/**
 * Online is computed on read (PRD PR-1): last message within offline_after_sec
 * (default max(300 s, 3 × reporting interval)). One definition, reused by summary later.
 */
export const effectiveOfflineAfterSql = (sql: Sql) =>
  sql`coalesce(d.offline_after_sec, greatest(300, d.reporting_interval_sec * 3))`;
export const onlineSql = (sql: Sql) =>
  sql`(d.last_seen_at is not null and d.last_seen_at >= now() - make_interval(secs => ${effectiveOfflineAfterSql(sql)}))`;

const deviceCols = (sql: Sql) => sql`
  d.id, d.name, d.lat, d.lon, d.location_source as "locationSource",
  d.reporting_interval_sec as "reportingIntervalSec", d.offline_after_sec as "offlineAfterSec",
  ${effectiveOfflineAfterSql(sql)} as "effectiveOfflineAfterSec",
  d.threshold_warning_cm as "thresholdWarningCm", d.threshold_critical_cm as "thresholdCriticalCm",
  d.is_enabled as "isEnabled", d.broker_sync_status as "brokerSyncStatus",
  d.last_seen_at as "lastSeenAt", d.last_reading_cm as "lastReadingCm", d.last_reading_at as "lastReadingAt",
  d.last_status as "lastStatus", d.sensor_height_cm as "sensorHeightCm", d.installed_at as "installedAt",
  d.created_at as "createdAt", d.updated_at as "updatedAt",
  t.token_last4 as "tokenLast4",
  ${onlineSql(sql)} as online`;

const fromDevices = (sql: Sql) => sql`
  devices d left join device_tokens t on t.device_id = d.id and t.revoked_at is null`;

export const devicesRepo = (sql: Sql) => ({
  async list(): Promise<DeviceRow[]> {
    return sql<DeviceRow[]>`
      select ${deviceCols(sql)} from ${fromDevices(sql)} where d.deleted_at is null order by d.id`;
  },

  async find(id: string): Promise<DeviceRow | undefined> {
    const [row] = await sql<DeviceRow[]>`
      select ${deviceCols(sql)} from ${fromDevices(sql)} where d.id = ${id} and d.deleted_at is null`;
    return row;
  },

  /** Including soft-deleted devices: an id is never reused (it is also the MQTT username). */
  async idTaken(id: string): Promise<{ deleted: boolean } | undefined> {
    const [row] = await sql<{ deleted: boolean }[]>`select deleted_at is not null as deleted from devices where id = ${id}`;
    return row;
  },

  async insert(d: {
    id: string;
    name: string;
    lat: number;
    lon: number;
    reportingIntervalSec?: number | undefined;
    thresholdWarningCm?: number | undefined;
    thresholdCriticalCm?: number | undefined;
    installedAt?: string | undefined;
    sensorHeightCm?: number | undefined;
  }): Promise<void> {
    await sql`
      insert into devices (id, name, lat, lon, reporting_interval_sec, threshold_warning_cm, threshold_critical_cm,
                           installed_at, sensor_height_cm)
      values (${d.id}, ${d.name}, ${d.lat}, ${d.lon},
              ${d.reportingIntervalSec ?? 60}, ${d.thresholdWarningCm ?? 200}, ${d.thresholdCriticalCm ?? 100},
              ${d.installedAt ?? null}, ${d.sensorHeightCm ?? null})`;
  },

  async update(id: string, patch: DevicePatch): Promise<boolean> {
    const keys = Object.keys(patch) as (keyof DevicePatch)[];
    if (keys.length === 0) return (await this.find(id)) !== undefined;
    const rows = await sql`
      update devices set ${sql(patch, keys)}, updated_at = now()
      where id = ${id} and deleted_at is null returning id`;
    return rows.length > 0;
  },

  async setSyncStatus(id: string, status: BrokerSyncStatus): Promise<void> {
    await sql`update devices set broker_sync_status = ${status}, updated_at = now() where id = ${id}`;
  },

  /** Revokes the active token (if any) and stores a new one. */
  async replaceToken(deviceId: string, token: { hash: string; last4: string }, createdBy: string | null): Promise<void> {
    await sql`update device_tokens set revoked_at = now() where device_id = ${deviceId} and revoked_at is null`;
    await sql`
      insert into device_tokens (device_id, token_hash, token_last4, created_by)
      values (${deviceId}, ${token.hash}, ${token.last4}, ${createdBy})`;
  },

  /** Soft delete: readings stay; the device is disabled and its token revoked. */
  async softDelete(id: string): Promise<boolean> {
    const rows = await sql`
      update devices set deleted_at = now(), is_enabled = false, updated_at = now()
      where id = ${id} and deleted_at is null returning id`;
    if (rows.length === 0) return false;
    await sql`update device_tokens set revoked_at = now() where device_id = ${id} and revoked_at is null`;
    return true;
  },
});

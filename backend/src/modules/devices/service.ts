import type { Sql } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { parseInput } from '../../shared/validation.js';
import { BrokerError, readingsTopic, type BrokerProvisioner, type BrokerSetup, type ProvisionResult } from './broker/provisioner.js';
import { newDeviceToken } from './deviceToken.js';
import { devicesRepo, type BrokerSyncStatus, type DevicePatch, type DeviceRow } from './repo.js';
import { CreateDeviceBody, DEVICE_ID_PATTERN, UpdateDeviceBody } from './schemas.js';

/** Broker address shown to firmware authors (env MQTT_PUBLIC_*). */
export interface MqttPublicInfo {
  host: string;
  port: number;
  tls: boolean;
}

export interface DeviceServiceDeps {
  sql: Sql;
  broker: BrokerProvisioner;
  mqttPublic: MqttPublicInfo;
  /** Broker usernames a device may never take (admin, the backend account). */
  reservedIds: string[];
  log?: { warn: (obj: object, msg: string) => void };
}

/** Device as returned by the API: the README frontend shape plus admin fields. */
export interface PublicDevice {
  id: string;
  name: string;
  lat: number;
  lon: number;
  online: boolean;
  status: DeviceRow['lastStatus'];
  lastReading: { distanceCm: number; timestamp: string } | null;
  installedAt: string | null;
  lastSeen: string | null;
  isEnabled: boolean;
  locationSource: DeviceRow['locationSource'];
  reportingIntervalSec: number;
  offlineAfterSec: number;
  thresholdWarningCm: number;
  thresholdCriticalCm: number;
  brokerSyncStatus: BrokerSyncStatus;
  tokenLast4: string | null;
}

export interface BrokerOutcome {
  brokerSetup?: BrokerSetup;
  brokerError?: { code: string; message: string };
}

/** Response of create / rotate: the token appears here and nowhere else, ever. */
export type IssuedDevice = PublicDevice &
  BrokerOutcome & {
    token: string;
    mqtt: { host: string; port: number; tls: boolean; topic: string; username: string };
  };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toPublicDevice(r: DeviceRow): PublicDevice {
  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    online: r.online,
    status: r.lastStatus,
    lastReading: r.lastReadingAt && r.lastReadingCm !== null ? { distanceCm: Number(r.lastReadingCm), timestamp: r.lastReadingAt.toISOString() } : null,
    installedAt: iso(r.installedAt),
    lastSeen: iso(r.lastSeenAt),
    isEnabled: r.isEnabled,
    locationSource: r.locationSource,
    reportingIntervalSec: r.reportingIntervalSec,
    offlineAfterSec: r.effectiveOfflineAfterSec,
    thresholdWarningCm: r.thresholdWarningCm,
    thresholdCriticalCm: r.thresholdCriticalCm,
    brokerSyncStatus: r.brokerSyncStatus,
    tokenLast4: r.tokenLast4,
  };
}

const notFound = (id: string) => new AppError('DEVICE_NOT_FOUND', `Device ${id} tidak ditemukan`, 404);
const pgCode = (err: unknown) => (err as { code?: string } | null)?.code;

export function deviceService(deps: DeviceServiceDeps) {
  const { sql, broker } = deps;
  const repo = devicesRepo(sql);
  const reserved = new Set(deps.reservedIds.map((x) => x.toLowerCase()));

  async function mustFind(id: string): Promise<DeviceRow> {
    const row = DEVICE_ID_PATTERN.test(id) ? await repo.find(id) : undefined;
    if (!row) throw notFound(id);
    return row;
  }

  /**
   * Runs a broker operation and records the outcome in broker_sync_status.
   * Broker failures never fail the request: the DB change stands, the admin sees `brokerError`,
   * and can retry (rotate token) — the worker also reconciles on start.
   */
  async function syncBroker(id: string, op: () => Promise<ProvisionResult>): Promise<BrokerOutcome> {
    try {
      const r = await op();
      await repo.setSyncStatus(id, r.synced ? 'synced' : 'pending');
      return r.setup ? { brokerSetup: r.setup } : {};
    } catch (err) {
      const code = err instanceof BrokerError ? err.code : 'BROKER_ERROR';
      const message = err instanceof BrokerError ? err.message : 'Gagal menghubungi broker';
      deps.log?.warn({ deviceId: id, code, err: err instanceof BrokerError ? undefined : err }, 'broker sync failed');
      await repo.setSyncStatus(id, code === 'BROKER_ACCOUNT_MISSING' ? 'needs_token_rotation' : 'error');
      return { brokerError: { code, message } };
    }
  }

  const mqttInfo = (id: string) => ({ ...deps.mqttPublic, topic: readingsTopic(id), username: id });

  return {
    async list(): Promise<PublicDevice[]> {
      return (await repo.list()).map(toPublicDevice);
    },

    async get(id: string): Promise<PublicDevice> {
      return toPublicDevice(await mustFind(id));
    },

    async create(body: unknown, actorId: string | null): Promise<IssuedDevice> {
      const input = parseInput(CreateDeviceBody, body);
      if (reserved.has(input.id.toLowerCase())) {
        throw new AppError('VALIDATION_ERROR', 'Input tidak valid', 400, [
          { field: 'id', message: `ID "${input.id}" dicadangkan untuk akun sistem broker` },
        ]);
      }
      const taken = await repo.idTaken(input.id);
      if (taken) {
        throw new AppError(
          'DEVICE_EXISTS',
          taken.deleted
            ? `ID ${input.id} pernah dipakai device yang sudah dihapus; gunakan ID lain`
            : `Device ${input.id} sudah ada`,
          409,
        );
      }

      const token = newDeviceToken();
      try {
        await sql.begin(async (tx) => {
          const r = devicesRepo(tx as unknown as Sql);
          await r.insert(input);
          await r.replaceToken(input.id, token, actorId);
        });
      } catch (err) {
        if (pgCode(err) === '23505') throw new AppError('DEVICE_EXISTS', `Device ${input.id} sudah ada`, 409);
        throw err;
      }

      const outcome = await syncBroker(input.id, () => broker.createDevice(input.id, token.token));
      const device = toPublicDevice(await mustFind(input.id));
      return { ...device, ...outcome, token: token.token, mqtt: mqttInfo(input.id) };
    },

    async update(id: string, body: unknown): Promise<PublicDevice & BrokerOutcome> {
      const input = parseInput(UpdateDeviceBody, body);
      const current = await mustFind(id);

      if (input.brokerSynced && broker.provider !== 'manual') {
        throw new AppError('BROKER_SYNC_NOT_MANUAL', 'brokerSynced hanya dipakai pada mode broker manual (HiveMQ)', 400);
      }

      const patch: DevicePatch = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.lat !== undefined) patch.lat = input.lat;
      if (input.lon !== undefined) patch.lon = input.lon;
      if (input.reportingIntervalSec !== undefined) patch.reporting_interval_sec = input.reportingIntervalSec;
      if (input.offlineAfterSec !== undefined) patch.offline_after_sec = input.offlineAfterSec;
      if (input.thresholdWarningCm !== undefined) patch.threshold_warning_cm = input.thresholdWarningCm;
      if (input.thresholdCriticalCm !== undefined) patch.threshold_critical_cm = input.thresholdCriticalCm;
      if (input.installedAt !== undefined) patch.installed_at = input.installedAt;
      if (input.isEnabled !== undefined) patch.is_enabled = input.isEnabled;

      try {
        await repo.update(id, patch);
      } catch (err) {
        if (pgCode(err) === '23514') {
          throw new AppError('VALIDATION_ERROR', 'Input tidak valid', 400, [
            { field: 'thresholdCriticalCm', message: 'thresholdCriticalCm harus lebih kecil dari thresholdWarningCm' },
          ]);
        }
        throw err;
      }

      let outcome: BrokerOutcome = {};
      const enabled = input.isEnabled;
      if (enabled !== undefined && enabled !== current.isEnabled) {
        outcome = await syncBroker(id, () => broker.setEnabled(id, enabled));
      }
      if (input.brokerSynced) await repo.setSyncStatus(id, 'synced');
      return { ...toPublicDevice(await mustFind(id)), ...outcome };
    },

    /** New token; the old one stops working immediately (mosquitto: live connection dropped). */
    async rotateToken(id: string, actorId: string | null): Promise<IssuedDevice> {
      const current = await mustFind(id);
      const token = newDeviceToken();
      await sql.begin(async (tx) => {
        await devicesRepo(tx as unknown as Sql).replaceToken(id, token, actorId);
      });
      const outcome = await syncBroker(id, async () => {
        const r = await broker.setPassword(id, token.token);
        // A missing account is recreated enabled; keep a disabled device disabled.
        if (r.synced && !current.isEnabled) await broker.setEnabled(id, false);
        return r;
      });
      return { ...toPublicDevice(await mustFind(id)), ...outcome, token: token.token, mqtt: mqttInfo(id) };
    },

    async remove(id: string): Promise<void> {
      if (!DEVICE_ID_PATTERN.test(id) || !(await repo.softDelete(id))) throw notFound(id);
      try {
        await broker.deleteDevice(id);
      } catch (err) {
        // The device is gone from the DB; the worker's reconciliation removes the leftover account.
        deps.log?.warn({ deviceId: id, code: (err as { code?: string }).code }, 'broker delete failed');
      }
    },
  };
}

export type DeviceService = ReturnType<typeof deviceService>;

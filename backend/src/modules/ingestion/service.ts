import type { Sql } from '../../db/client.js';
import { effectiveOfflineAfterSql, onlineSql, type LevelStatus } from '../devices/repo.js';
import { insertEvents, transitionsOnMessage } from '../presence/presence.js';
import { deviceIdFromTopic, parsePayload, validateTimestamp, type Reading } from './payload.js';
import { computeStatus } from './status.js';
import { nextLastStored, shouldStore, type LastStored } from './storagePolicy.js';

export type IngestResult =
  | { outcome: 'ignored'; reason: 'bad_topic' | 'unknown_device' | 'disabled_device'; deviceId: string | null }
  | { outcome: 'rejected'; reason: 'invalid_json' | 'invalid_payload' | 'invalid_timestamp'; deviceId: string; message: string }
  | {
      outcome: 'accepted';
      deviceId: string;
      /** valid readings in the message */
      received: number;
      stored: number;
      /** exact re-deliveries (same ts) dropped by the primary key */
      duplicates: number;
      /** same value within the heartbeat window */
      unchanged: number;
      /** readings dropped for their timestamp (future / clock unset) inside an otherwise valid message */
      rejectedTs: number;
      /** server time − newest reading ts (device clock lag), for the log */
      lagMs: number;
    };

interface DeviceState {
  id: string;
  isEnabled: boolean;
  thresholdWarningCm: number;
  thresholdCriticalCm: number;
  heartbeatSec: number;
  deadbandCm: string;
  lastStoredCm: string | null;
  lastStoredAt: Date | null;
  lastReadingAt: Date | null;
  online: boolean;
  lastSeenAt: Date | null;
  offlineAfterSec: number;
  lastEventOnline: boolean | null;
}

/**
 * Handles one MQTT message end to end, in one transaction (row lock on the device):
 * validate → store per policy → update last_* → record presence transition.
 * Never throws for bad input; DB errors propagate (the consumer retries).
 */
export async function ingestMessage(sql: Sql, topic: string, payload: Buffer | string, now = new Date()): Promise<IngestResult> {
  const deviceId = deviceIdFromTopic(topic);
  if (!deviceId) return { outcome: 'ignored', reason: 'bad_topic', deviceId: null };

  const parsed = parsePayload(payload);
  if (!parsed.ok) return { outcome: 'rejected', reason: parsed.error.reason, deviceId, message: parsed.error.message };

  const valid: Reading[] = [];
  let rejectedTs = 0;
  for (const r of parsed.readings) {
    if (validateTimestamp(r.ts, now).ok) valid.push(r);
    else rejectedTs++;
  }

  return sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as Sql;
    const [d] = await tx<DeviceState[]>`
      select d.id, d.is_enabled as "isEnabled",
             d.threshold_warning_cm as "thresholdWarningCm", d.threshold_critical_cm as "thresholdCriticalCm",
             d.heartbeat_sec as "heartbeatSec", d.deadband_cm as "deadbandCm",
             d.last_stored_cm as "lastStoredCm", d.last_stored_at as "lastStoredAt",
             d.last_reading_at as "lastReadingAt", d.last_seen_at as "lastSeenAt",
             ${onlineSql(tx)} as online, ${effectiveOfflineAfterSql(tx)} as "offlineAfterSec",
             (select e.online from device_status_events e where e.device_id = d.id
              order by e.at desc, e.id desc limit 1) as "lastEventOnline"
      from devices d where d.id = ${deviceId} and d.deleted_at is null
      for update of d`;
    if (!d) return { outcome: 'ignored', reason: 'unknown_device', deviceId } as const;
    if (!d.isEnabled) return { outcome: 'ignored', reason: 'disabled_device', deviceId } as const;
    if (valid.length === 0) {
      return { outcome: 'rejected', reason: 'invalid_timestamp', deviceId, message: 'Semua reading ditolak: ts di masa depan atau jam device belum sinkron (NTP)' } as const;
    }

    const thresholds = { warningCm: d.thresholdWarningCm, criticalCm: d.thresholdCriticalCm };
    const settings = { heartbeatSec: d.heartbeatSec, deadbandCm: Number(d.deadbandCm) };
    let ref: LastStored | null =
      d.lastStoredAt && d.lastStoredCm !== null ? { levelCm: Number(d.lastStoredCm), at: d.lastStoredAt } : null;
    let stored = 0;
    let duplicates = 0;
    let unchanged = 0;

    const ordered = [...valid].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    for (const r of ordered) {
      const decision = shouldStore(ref, r, settings);
      if (!decision.store) {
        unchanged++;
        continue;
      }
      const inserted = await tx`
        insert into readings (device_id, channel, ts, level_cm, status)
        values (${deviceId}, 1, ${r.ts}, ${r.levelCm}, ${computeStatus(r.levelCm, thresholds)})
        on conflict do nothing returning 1`;
      if (inserted.length === 0) {
        duplicates++;
        continue;
      }
      stored++;
      ref = nextLastStored(ref, r);
    }

    const newest = ordered[ordered.length - 1]!;
    const newer = !d.lastReadingAt || newest.ts.getTime() > d.lastReadingAt.getTime();
    const status: LevelStatus = computeStatus(newest.levelCm, thresholds);
    await tx`
      update devices set
        last_seen_at   = ${now},
        last_reading_cm = case when ${newer} then ${newest.levelCm}::numeric else last_reading_cm end,
        last_reading_at = case when ${newer} then ${newest.ts}::timestamptz else last_reading_at end,
        last_status     = case when ${newer} then ${status} else last_status end,
        last_stored_cm  = ${ref?.levelCm ?? null},
        last_stored_at  = ${ref?.at ?? null}
      where id = ${deviceId}`;

    await insertEvents(
      tx,
      deviceId,
      transitionsOnMessage(
        { online: d.online, lastSeenAt: d.lastSeenAt, offlineAfterSec: d.offlineAfterSec, lastEventOnline: d.lastEventOnline },
        now,
      ),
    );

    return {
      outcome: 'accepted',
      deviceId,
      received: valid.length,
      stored,
      duplicates,
      unchanged,
      rejectedTs,
      lagMs: now.getTime() - newest.ts.getTime(),
    } as const;
  });
}

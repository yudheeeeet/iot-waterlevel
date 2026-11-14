import type { Sql } from '../../db/client.js';
import { effectiveOfflineAfterSql, onlineSql } from '../devices/repo.js';

/**
 * Device presence (PRD §3.4).
 * - PR-1: `online` is computed on read in SQL (devices/repo.ts onlineSql), so the dashboard is right
 *   even when the worker is down.
 * - PR-2/PR-3: transitions are recorded in device_status_events: `timeout` by the worker job,
 *   `reading` when a message arrives from an offline device.
 */
export interface PresenceEvent {
  online: boolean;
  reason: 'timeout' | 'reading';
  at: Date;
}

export interface PresenceState {
  /** online according to the rule, before this message */
  online: boolean;
  lastSeenAt: Date | null;
  offlineAfterSec: number;
  /** most recent recorded event, null when none */
  lastEventOnline: boolean | null;
}

/**
 * Events to record when a valid message arrives. If the device had silently gone offline and the
 * job has not recorded it yet (worker was down), the missing `timeout` is back-filled at the moment
 * the device actually went offline, so the history stays in order.
 */
export function transitionsOnMessage(state: PresenceState, now: Date): PresenceEvent[] {
  if (state.online) return [];
  const events: PresenceEvent[] = [];
  if (state.lastSeenAt && state.lastEventOnline !== false) {
    events.push({ online: false, reason: 'timeout', at: new Date(state.lastSeenAt.getTime() + state.offlineAfterSec * 1000) });
  }
  events.push({ online: true, reason: 'reading', at: now });
  return events;
}

export async function insertEvents(sql: Sql, deviceId: string, events: PresenceEvent[]): Promise<void> {
  for (const e of events) {
    await sql`insert into device_status_events (device_id, online, reason, at) values (${deviceId}, ${e.online}, ${e.reason}, ${e.at})`;
  }
}

/**
 * Worker job (every 30 s): records `timeout` for devices that went offline since their last
 * `online` event. Time of the event = last_seen_at + offline window. Returns the device ids.
 */
export async function recordTimeouts(sql: Sql): Promise<string[]> {
  const rows = await sql<{ deviceId: string }[]>`
    insert into device_status_events (device_id, online, reason, at)
    select d.id, false, 'timeout', d.last_seen_at + make_interval(secs => ${effectiveOfflineAfterSql(sql)})
    from devices d
    where d.deleted_at is null
      and d.last_seen_at is not null
      and not ${onlineSql(sql)}
      and coalesce((select e.online from device_status_events e
                    where e.device_id = d.id order by e.at desc, e.id desc limit 1), true)
    returning device_id as "deviceId"`;
  return rows.map((r) => r.deviceId);
}

import type { Sql } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { devicesRepo, type DeviceRow } from '../devices/repo.js';
import { DEVICE_ID_PATTERN } from '../devices/schemas.js';
import { parseRange } from './range.js';
import { buildSeries, offlineIntervals, pickStepMs, type Point, type PresenceEventLite } from './series.js';

export interface History {
  deviceId: string;
  intervalSec: number;
  points: Point[];
}

export function readingsService(sql: Sql) {
  const devices = devicesRepo(sql);

  /** Existing (not deleted) device, or 404. */
  async function mustFind(id: string): Promise<DeviceRow> {
    const d = DEVICE_ID_PATTERN.test(id) ? await devices.find(id) : undefined;
    if (!d) throw new AppError('DEVICE_NOT_FOUND', `Device ${id} tidak ditemukan`, 404);
    return d;
  }

  return {
    mustFind,

    /** GET /api/devices/:id/readings — downsampled, carried forward, null while offline. */
    async history(id: string, query: unknown, now = new Date()): Promise<History> {
      const device = await mustFind(id);
      const { from, to } = parseRange(query, now);
      const fromMs = from.getTime();
      const endMs = Math.min(to.getTime(), now.getTime()); // no points in the future
      const stepMs = pickStepMs(fromMs, to.getTime());
      if (endMs <= fromMs) return { deviceId: id, intervalSec: stepMs / 1000, points: [] };
      const end = new Date(endMs);

      const [buckets, before, events] = await Promise.all([
        sql<{ b: string; avg: number }[]>`
          select (extract(epoch from date_bin(make_interval(secs => ${stepMs / 1000}), ts, timestamptz '1970-01-01 00:00:00+00')) * 1000)::bigint as b,
                 avg(level_cm)::float8 as avg
          from readings
          where device_id = ${id} and channel = 1 and ts >= ${from} and ts < ${end}
          group by 1`,
        sql<{ level: string }[]>`
          select level_cm as level from readings
          where device_id = ${id} and channel = 1 and ts < ${from}
          order by ts desc limit 1`,
        sql<{ at: Date; online: boolean; inRange: boolean }[]>`
          (select at, online, false as "inRange" from device_status_events
             where device_id = ${id} and at < ${from} order by at desc, id desc limit 1)
          union all
          (select at, online, true from device_status_events
             where device_id = ${id} and at >= ${from} and at < ${end})`,
      ]);

      const lite = (e: { at: Date; online: boolean }): PresenceEventLite => ({ at: e.at.getTime(), online: e.online });
      const prior = events.find((e) => !e.inRange);
      // Offline right now by the rule (PR-1) even if the worker has not recorded the timeout yet.
      const offlineSince =
        !device.online && device.lastSeenAt ? device.lastSeenAt.getTime() + device.effectiveOfflineAfterSec * 1000 : null;

      const points = buildSeries({
        fromMs,
        toMs: endMs,
        stepMs,
        averages: new Map(buckets.map((r) => [Number(r.b), r.avg])),
        initial: before[0] ? Number(before[0].level) : null,
        offline: offlineIntervals(prior ? lite(prior) : null, events.filter((e) => e.inRange).map(lite), offlineSince),
      });
      return { deviceId: id, intervalSec: stepMs / 1000, points };
    },
  };
}

export type ReadingsService = ReturnType<typeof readingsService>;

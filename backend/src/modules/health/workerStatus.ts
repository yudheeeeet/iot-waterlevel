import type { Sql } from '../../db/client.js';

/** The worker writes a heartbeat every 30 s; older than this means it is down (PRD IN-7). */
export const WORKER_STALE_SEC = 90;

export async function writeHeartbeat(
  sql: Sql,
  w: { workerId: string; mqttConnected: boolean; brokerHost: string; startedAt: Date },
): Promise<void> {
  await sql`
    insert into worker_status (worker_id, heartbeat_at, mqtt_connected, broker_url_host, started_at)
    values (${w.workerId}, now(), ${w.mqttConnected}, ${w.brokerHost}, ${w.startedAt})
    on conflict (worker_id) do update set
      heartbeat_at = excluded.heartbeat_at,
      mqtt_connected = excluded.mqtt_connected,
      broker_url_host = excluded.broker_url_host,
      started_at = excluded.started_at`;
}

/** up = a worker sent a heartbeat within WORKER_STALE_SEC and is connected to the broker. */
export async function workerState(sql: Sql): Promise<'up' | 'down'> {
  const [row] = await sql<{ up: boolean }[]>`
    select exists (
      select 1 from worker_status
      where heartbeat_at > now() - make_interval(secs => ${WORKER_STALE_SEC}) and mqtt_connected
    ) as up`;
  return row?.up ? 'up' : 'down';
}

/** Host part of the broker URL, for the status row (never credentials). */
export const brokerHost = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || (u.protocol === 'mqtts:' ? '8883' : '1883')}`;
  } catch {
    return 'unknown';
  }
};

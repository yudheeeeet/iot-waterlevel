import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MqttClient } from 'mqtt';
import type { Sql } from '../../db/client.js';
import { connectMqtt } from '../../shared/mqttClient.js';
import { createTestSql, hasTestDb, resetTestDb } from '../../test/testDb.js';
import { connectDevice, hasTestBroker, publishRc, sleep, testBrokerConn } from '../../test/testBroker.js';
import { createBroker } from '../devices/broker/index.js';
import { readingsTopic } from '../devices/broker/provisioner.js';
import { recordTimeouts } from '../presence/presence.js';
import { createIngestion } from './consumer.js';
import { ingestMessage } from './service.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const topic = (id: string) => `baruna/devices/${id}/readings`;
const msg = (ts: Date | number, level: number) => JSON.stringify({ ts: ts instanceof Date ? ts.toISOString() : ts, level });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

describe.skipIf(!hasTestDb)('ingestion (DB)', () => {
  let sql: Sql;
  beforeAll(async () => {
    sql = createTestSql();
    await resetTestDb(sql);
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  let id: string;
  beforeEach(async () => {
    id = `ING-${randomBytes(3).toString('hex').toUpperCase()}`;
    await sql`insert into devices (id, name, lat, lon) values (${id}, ${id}, -6.6, 106.8)`;
  });
  const rows = async (deviceId = id) =>
    (await sql<{ ts: Date; level: string; status: string }[]>`
      select ts, level_cm as level, status from readings where device_id = ${deviceId} order by ts`).map((r) => ({
      ...r,
      level: Number(r.level),
    }));
  const device = async () => (await sql`select * from devices where id = ${id}`)[0]!;
  const events = async () =>
    (await sql<{ online: boolean; reason: string }[]>`select online, reason from device_status_events where device_id = ${id} order by at, id`).map(
      (e) => `${e.online ? 'online' : 'offline'}:${e.reason}`,
    );

  it('stores the first reading, updates last_* and marks the device online', async () => {
    const ts = minutesAgo(1);
    const r = await ingestMessage(sql, topic(id), msg(ts, 285.456));
    expect(r).toMatchObject({ outcome: 'accepted', stored: 1, received: 1 });
    expect(await rows()).toEqual([{ ts, level: 285.46, status: 'normal' }]);
    const d = await device();
    expect(Number(d.last_reading_cm)).toBe(285.46);
    expect(d.last_reading_at).toEqual(ts);
    expect(d.last_status).toBe('normal');
    expect(d.last_seen_at).not.toBeNull();
    expect(Number(d.last_stored_cm)).toBe(285.46);
    expect(await events()).toEqual(['online:reading']);
  });

  it('QoS 1 duplicate (same message twice) → one row', async () => {
    const m = msg(minutesAgo(1), 150);
    await ingestMessage(sql, topic(id), m);
    const again = await ingestMessage(sql, topic(id), m);
    expect(again).toMatchObject({ outcome: 'accepted', stored: 0 });
    expect(await rows()).toHaveLength(1);
  });

  it('constant level: 60 messages over an hour → 4 rows; every message still updates last_seen', async () => {
    const start = Date.now() - 60 * 60_000;
    for (let m = 0; m < 60; m++) await ingestMessage(sql, topic(id), msg(new Date(start + m * 60_000), 250));
    expect(await rows()).toHaveLength(4);
    const d = await device();
    expect(d.last_reading_at).toEqual(new Date(start + 59 * 60_000));
  });

  it('noise: every change is stored; status follows thresholds', async () => {
    const levels = [250, 250.3, 199.9, 199.9, 99.5];
    for (const [i, l] of levels.entries()) await ingestMessage(sql, topic(id), msg(minutesAgo(10 - i), l));
    expect((await rows()).map((r) => [r.level, r.status])).toEqual([
      [250, 'normal'],
      [250.3, 'normal'],
      [199.9, 'warning'],
      [99.5, 'critical'],
    ]);
    expect((await device()).last_status).toBe('critical');
  });

  it('batch with an older re-sent reading: stored, but last_reading stays the newest', async () => {
    await ingestMessage(sql, topic(id), msg(minutesAgo(1), 200));
    const r = await ingestMessage(
      sql,
      topic(id),
      JSON.stringify({ readings: [{ ts: minutesAgo(30).toISOString(), level: 200 }, { ts: minutesAgo(20).toISOString(), level: 210 }] }),
    );
    expect(r).toMatchObject({ outcome: 'accepted', stored: 2 });
    expect(await rows()).toHaveLength(3);
    expect(Number((await device()).last_reading_cm)).toBe(200);
  });

  it('future timestamp / unset clock rejected; invalid payload rejected; nothing touches the device', async () => {
    expect(await ingestMessage(sql, topic(id), msg(new Date(Date.now() + 10 * 60_000), 100))).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_timestamp',
    });
    expect(await ingestMessage(sql, topic(id), msg(10, 100))).toMatchObject({ outcome: 'rejected', reason: 'invalid_timestamp' });
    expect(await ingestMessage(sql, topic(id), 'garbage')).toMatchObject({ outcome: 'rejected', reason: 'invalid_json' });
    expect(await ingestMessage(sql, topic(id), '{"ts":1794600000,"level":-5}')).toMatchObject({ outcome: 'rejected', reason: 'invalid_payload' });
    expect(await rows()).toHaveLength(0);
    expect((await device()).last_seen_at).toBeNull();
  });

  it('unknown, disabled and deleted devices are ignored', async () => {
    expect(await ingestMessage(sql, topic('NOPE-1'), msg(minutesAgo(1), 100))).toMatchObject({ outcome: 'ignored', reason: 'unknown_device' });
    await sql`update devices set is_enabled = false where id = ${id}`;
    expect(await ingestMessage(sql, topic(id), msg(minutesAgo(1), 100))).toMatchObject({ outcome: 'ignored', reason: 'disabled_device' });
    await sql`update devices set deleted_at = now() where id = ${id}`;
    expect(await ingestMessage(sql, topic(id), msg(minutesAgo(1), 100))).toMatchObject({ outcome: 'ignored', reason: 'unknown_device' });
    expect(await ingestMessage(sql, 'baruna/devices/x/y/readings', '{}')).toMatchObject({ outcome: 'ignored', reason: 'bad_topic' });
    expect(await rows()).toHaveLength(0);
  });

  describe('presence', () => {
    /** Moves the device's whole timeline (last_seen and its events) into the past, as if time passed. */
    const age = (minutes: number) => sql.begin(async (tx) => {
      await tx`update devices set last_seen_at = last_seen_at - make_interval(mins => ${minutes}) where id = ${id}`;
      await tx`update device_status_events set at = at - make_interval(mins => ${minutes}) where device_id = ${id}`;
    });

    it('timeout recorded once after the window; next message → online again', async () => {
      await ingestMessage(sql, topic(id), msg(minutesAgo(1), 100));
      expect(await recordTimeouts(sql)).not.toContain(id); // still online

      await age(6);
      expect(await recordTimeouts(sql)).toContain(id);
      expect(await recordTimeouts(sql)).not.toContain(id); // not twice
      expect(await events()).toEqual(['online:reading', 'offline:timeout']);

      await ingestMessage(sql, topic(id), msg(minutesAgo(0), 101));
      expect(await events()).toEqual(['online:reading', 'offline:timeout', 'online:reading']);
    });

    it('offline while the worker was down: the missing timeout is back-filled before the new online event', async () => {
      await ingestMessage(sql, topic(id), msg(minutesAgo(1), 100));
      await age(20);
      await ingestMessage(sql, topic(id), msg(minutesAgo(0), 100)); // no recordTimeouts in between
      const evs = await sql<{ online: boolean; at: Date }[]>`select online, at from device_status_events where device_id = ${id} order by at, id`;
      expect(evs.map((e) => e.online)).toEqual([true, false, true]);
      // timeout dated at last_seen + 300 s ≈ 15 minutes ago
      expect(Math.abs(evs[1]!.at.getTime() - minutesAgo(15).getTime())).toBeLessThan(5_000);
    });

    it('a device that never sent data gets no timeout event', async () => {
      expect(await recordTimeouts(sql)).not.toContain(id);
    });
  });
});

describe.skipIf(!hasTestDb || !hasTestBroker)('ingestion end-to-end (local Mosquitto)', () => {
  let sql: Sql;
  let worker: MqttClient;
  let ingestion: ReturnType<typeof createIngestion>;
  const broker = createBroker(
    { BROKER_PROVIDER: 'mosquitto', MQTT_URL: testBrokerConn.url, MQTT_USERNAME: testBrokerConn.username, MQTT_PASSWORD: testBrokerConn.password },
    'test-e2e',
  );
  const id = `E2E-ING-${randomBytes(3).toString('hex').toUpperCase()}`;

  beforeAll(async () => {
    sql = createTestSql();
    await sql`insert into devices (id, name, lat, lon) values (${id}, ${id}, -6.6, 106.8)`;
    await broker.createDevice(id, 'pw-e2e');
    ingestion = createIngestion(sql, silent);
    worker = connectMqtt(testBrokerConn, 'test-worker', { customHandleAcks: ingestion.customHandleAcks });
    ingestion.attach(worker);
    await new Promise((r) => worker.once('connect', r));
    await sleep(300); // subscription in place
  });
  afterAll(async () => {
    await worker?.endAsync();
    await broker.deleteDevice(id).catch(() => {});
    await broker.close();
    await sql?.end({ timeout: 5 });
  });

  it('device publishes (incl. duplicates) → rows in the DB via the consumer', async () => {
    const dev = await connectDevice(id, 'pw-e2e');
    const t0 = Date.now() - 5 * 60_000;
    for (let i = 0; i < 3; i++) {
      const payload = msg(new Date(t0 + i * 60_000), 200 + i);
      expect(await publishRc(dev, readingsTopic(id), payload)).toBe(0);
      expect(await publishRc(dev, readingsTopic(id), payload)).toBe(0); // duplicate
    }
    await dev.endAsync();
    for (let i = 0; i < 20 && (await sql`select 1 from readings where device_id = ${id}`).length < 3; i++) await sleep(100);
    await ingestion.drain();
    const stored = await sql`select level_cm from readings where device_id = ${id} order by ts`;
    expect(stored.map((r) => Number(r.level_cm))).toEqual([200, 201, 202]);
    const c = ingestion.takeCounters();
    expect(c).toMatchObject({ messages: 6, stored: 3, failed: 0 });
  });
});

import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { Sql } from '../../db/client.js';
import { createTestSql, hasTestDb, resetTestDb } from '../../test/testDb.js';
import { closedWithin, connectDevice, hasTestBroker, publishRc, testBrokerConn } from '../../test/testBroker.js';
import { identityService } from '../identity/service.js';
import { sha256, signAccessToken, type AuthConfig } from '../identity/tokens.js';
import { createBroker } from './broker/index.js';
import { manualProvisioner } from './broker/manual.js';
import { BrokerError, readingsTopic, type BrokerProvisioner } from './broker/provisioner.js';

const cfg: AuthConfig = { jwtSecret: 'k'.repeat(40), accessTtlSec: 900, refreshTtlDays: 7, cookieSecure: false };
const mqttPublic = { host: 'mqtt.example.test', port: 1883, tls: false };

/** In-memory broker that records calls; `failWith` makes the next calls throw. */
function fakeBroker() {
  const calls: string[] = [];
  let failWith: BrokerError | null = null;
  const op = (name: string) => async (id: string, arg?: unknown) => {
    calls.push(`${name}:${id}${typeof arg === 'boolean' ? `:${arg}` : ''}`);
    if (failWith) throw failWith;
    return { synced: true };
  };
  const broker: BrokerProvisioner = {
    provider: 'mosquitto',
    createDevice: op('create'),
    setPassword: op('setPassword'),
    setEnabled: op('setEnabled'),
    deleteDevice: op('delete'),
    listDevices: async () => [],
    close: async () => {},
  };
  return { broker, calls, fail: (e: BrokerError | null) => (failWith = e) };
}

describe.skipIf(!hasTestDb)('devices (DB)', () => {
  let sql: Sql;
  let adminToken: string;
  let viewerToken: string;
  let logLines: string[];

  beforeAll(async () => {
    sql = createTestSql();
    await resetTestDb(sql);
    const ids = identityService(sql, cfg);
    const admin = await ids.createUser({ email: 'admin@test.local', name: 'Admin', role: 'admin', password: 'admin-pass-123' });
    const viewer = await ids.createUser({ email: 'viewer@test.local', name: 'Viewer', role: 'viewer', password: 'viewer-pass-123' });
    adminToken = await signAccessToken({ id: admin.id, role: 'admin' }, cfg);
    viewerToken = await signAccessToken({ id: viewer.id, role: 'viewer' }, cfg);
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  async function makeApp(broker: BrokerProvisioner): Promise<FastifyInstance> {
    logLines = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(String(chunk));
        cb();
      },
    });
    return buildApp({
      deps: { checkDb: async () => true, sql, auth: cfg, broker, mqttPublic, reservedDeviceIds: ['backend-user'] },
      logger: { level: 'trace', stream },
    });
  }

  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  const body = { id: 'BWN-001', name: 'Jembatan Otista', lat: -6.6071, lon: 106.8031 };

  describe('with a fake mosquitto broker', () => {
    let app: FastifyInstance;
    let fake: ReturnType<typeof fakeBroker>;
    beforeEach(async () => {
      fake = fakeBroker();
      app = await makeApp(fake.broker);
    });
    const create = (payload: object, token = adminToken) =>
      app.inject({ method: 'POST', url: '/api/devices', headers: as(token), payload });

    it('admin creates a device: token shown once, stored only as hash, mqtt info included', async () => {
      const res = await create(body);
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const d = res.json();
      expect(d.token).toMatch(/^bwn_[A-Za-z0-9_-]{43}$/);
      expect(d).toMatchObject({
        id: 'BWN-001',
        name: 'Jembatan Otista',
        online: false,
        status: null,
        lastReading: null,
        isEnabled: true,
        reportingIntervalSec: 60,
        offlineAfterSec: 300,
        thresholdWarningCm: 200,
        thresholdCriticalCm: 100,
        brokerSyncStatus: 'synced',
        tokenLast4: d.token.slice(-4),
        mqtt: { host: 'mqtt.example.test', port: 1883, tls: false, topic: 'baruna/devices/BWN-001/readings', username: 'BWN-001' },
      });
      expect(fake.calls).toEqual(['create:BWN-001']);

      const [tok] = await sql`select token_hash, token_last4 from device_tokens where device_id = 'BWN-001'`;
      expect(tok!.token_hash).toBe(sha256(d.token));
      const dump = JSON.stringify(await sql`select * from device_tokens`);
      expect(dump).not.toContain(d.token);

      const list = await app.inject({ method: 'GET', url: '/api/devices', headers: as(viewerToken) });
      expect(list.statusCode).toBe(200);
      expect(list.body).not.toContain(d.token);
      expect(list.json()).toHaveLength(1);
      expect(logLines.join('')).not.toContain(d.token);
    });

    it('GET requires login; viewer can read', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/devices' })).statusCode).toBe(401);
      const one = await app.inject({ method: 'GET', url: '/api/devices/BWN-001', headers: as(viewerToken) });
      expect(one.statusCode).toBe(200);
      expect(one.json().token).toBeUndefined();
      const missing = await app.inject({ method: 'GET', url: '/api/devices/NOPE', headers: as(viewerToken) });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('DEVICE_NOT_FOUND');
    });

    it('viewer gets 403 on every change', async () => {
      const reqs = [
        { method: 'POST' as const, url: '/api/devices', payload: { ...body, id: 'BWN-X' } },
        { method: 'PATCH' as const, url: '/api/devices/BWN-001', payload: { name: 'x' } },
        { method: 'POST' as const, url: '/api/devices/BWN-001/token/rotate' },
        { method: 'DELETE' as const, url: '/api/devices/BWN-001' },
      ];
      for (const r of reqs) {
        const res = await app.inject({ ...r, headers: as(viewerToken) });
        expect(res.statusCode, `${r.method} ${r.url}`).toBe(403);
        expect(res.json().error.code).toBe('FORBIDDEN');
      }
      expect(fake.calls).toEqual([]);
    });

    it('validation: coordinates, id format, reserved ids, thresholds → 400 with field', async () => {
      const cases: [object, string][] = [
        [{ ...body, id: 'BWN-V1', lat: 91 }, 'lat'],
        [{ ...body, id: 'BWN-V2', lon: -181 }, 'lon'],
        [{ ...body, id: 'bad/id' }, 'id'],
        [{ ...body, id: 'ADMIN' }, 'id'],
        [{ ...body, id: 'backend-user' }, 'id'],
        [{ ...body, id: 'BWN-V3', name: '' }, 'name'],
        [{ ...body, id: 'BWN-V4', thresholdWarningCm: 100, thresholdCriticalCm: 150 }, 'thresholdCriticalCm'],
        [{ ...body, id: 'BWN-V5', reportingIntervalSec: 5 }, 'reportingIntervalSec'],
      ];
      for (const [payload, field] of cases) {
        const res = await create(payload);
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
        expect(res.json().error.details.map((d: { field: string }) => d.field)).toContain(field);
      }
      expect(fake.calls).toEqual([]);
    });

    it('duplicate id → 409 DEVICE_EXISTS', async () => {
      const res = await create(body);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('DEVICE_EXISTS');
    });

    it('broker failure: device is still created, sync status error, error shown to admin', async () => {
      fake.fail(new BrokerError('BROKER_TIMEOUT', 'Broker tidak membalas perintah createClient dalam 5 detik'));
      const res = await create({ ...body, id: 'BWN-ERR' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        brokerSyncStatus: 'error',
        brokerError: { code: 'BROKER_TIMEOUT', message: expect.stringContaining('5 detik') },
      });
      expect(typeof res.json().token).toBe('string'); // admin can still retry by rotating the token
    });

    it('PATCH updates fields; threshold order checked against stored values', async () => {
      const ok = await app.inject({
        method: 'PATCH',
        url: '/api/devices/BWN-001',
        headers: as(adminToken),
        payload: { name: 'Otista', lat: -6.6, reportingIntervalSec: 120, thresholdWarningCm: 250, installedAt: '2026-01-15T00:00:00+07:00' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({
        name: 'Otista',
        lat: -6.6,
        reportingIntervalSec: 120,
        offlineAfterSec: 360,
        thresholdWarningCm: 250,
        installedAt: '2026-01-14T17:00:00.000Z',
      });

      const bad = await app.inject({
        method: 'PATCH',
        url: '/api/devices/BWN-001',
        headers: as(adminToken),
        payload: { thresholdCriticalCm: 300 },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.details[0].field).toBe('thresholdCriticalCm');

      const empty = await app.inject({ method: 'PATCH', url: '/api/devices/BWN-001', headers: as(adminToken), payload: {} });
      expect(empty.statusCode).toBe(400);

      const notManual = await app.inject({
        method: 'PATCH',
        url: '/api/devices/BWN-001',
        headers: as(adminToken),
        payload: { brokerSynced: true },
      });
      expect(notManual.json().error.code).toBe('BROKER_SYNC_NOT_MANUAL');
    });

    it('online is computed from last_seen_at and the offline window', async () => {
      await sql`update devices set last_seen_at = now() - interval '5 minutes' where id = 'BWN-001'`; // window 360 s
      expect((await app.inject({ method: 'GET', url: '/api/devices/BWN-001', headers: as(viewerToken) })).json().online).toBe(true);
      await sql`update devices set last_seen_at = now() - interval '7 minutes' where id = 'BWN-001'`;
      expect((await app.inject({ method: 'GET', url: '/api/devices/BWN-001', headers: as(viewerToken) })).json().online).toBe(false);
    });

    it('rotate issues a new token and revokes the old one', async () => {
      const before = await sql`select token_hash from device_tokens where device_id = 'BWN-001' and revoked_at is null`;
      const res = await app.inject({ method: 'POST', url: '/api/devices/BWN-001/token/rotate', headers: as(adminToken) });
      expect(res.statusCode).toBe(200);
      const d = res.json();
      expect(d.token).toMatch(/^bwn_/);
      expect(d.mqtt.username).toBe('BWN-001');
      expect(fake.calls).toEqual(['setPassword:BWN-001']);
      const active = await sql`select token_hash from device_tokens where device_id = 'BWN-001' and revoked_at is null`;
      expect(active).toHaveLength(1);
      expect(active[0]!.token_hash).toBe(sha256(d.token));
      expect(active[0]!.token_hash).not.toBe(before[0]!.token_hash);
    });

    it('isEnabled toggles the broker account only when it changes', async () => {
      const patch = (isEnabled: boolean) =>
        app.inject({ method: 'PATCH', url: '/api/devices/BWN-001', headers: as(adminToken), payload: { isEnabled } });
      expect((await patch(false)).json().isEnabled).toBe(false);
      await patch(false);
      expect((await patch(true)).json().isEnabled).toBe(true);
      expect(fake.calls).toEqual(['setEnabled:BWN-001:false', 'setEnabled:BWN-001:true']);
    });

    it('missing broker account on enable → needs_token_rotation', async () => {
      await app.inject({ method: 'PATCH', url: '/api/devices/BWN-001', headers: as(adminToken), payload: { isEnabled: false } });
      fake.fail(new BrokerError('BROKER_ACCOUNT_MISSING', 'Akun device BWN-001 tidak ada di broker; lakukan rotasi token'));
      const res = await app.inject({ method: 'PATCH', url: '/api/devices/BWN-001', headers: as(adminToken), payload: { isEnabled: true } });
      expect(res.json()).toMatchObject({ isEnabled: true, brokerSyncStatus: 'needs_token_rotation', brokerError: { code: 'BROKER_ACCOUNT_MISSING' } });
    });

    it('DELETE soft-deletes, removes the broker account, and the id cannot be reused', async () => {
      await sql`insert into readings (device_id, ts, level_cm, status) values ('BWN-ERR', now(), 250, 'normal')`;
      const del = await app.inject({ method: 'DELETE', url: '/api/devices/BWN-ERR', headers: as(adminToken) });
      expect(del.statusCode).toBe(204);
      expect(fake.calls).toEqual(['delete:BWN-ERR']);
      expect((await app.inject({ method: 'GET', url: '/api/devices/BWN-ERR', headers: as(adminToken) })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: '/api/devices/BWN-ERR', headers: as(adminToken) })).statusCode).toBe(404);
      expect(await sql`select 1 from readings where device_id = 'BWN-ERR'`).toHaveLength(1); // history kept
      expect(await sql`select 1 from device_tokens where device_id = 'BWN-ERR' and revoked_at is null`).toHaveLength(0);
      const reuse = await create({ ...body, id: 'BWN-ERR' });
      expect(reuse.statusCode).toBe(409);
      expect(reuse.json().error.message).toContain('sudah dihapus');
    });

    it('DELETE still succeeds when the broker is down (reconciliation cleans up later)', async () => {
      await create({ ...body, id: 'BWN-DOWN' });
      fake.fail(new BrokerError('BROKER_UNAVAILABLE', 'Broker MQTT tidak dapat dihubungi'));
      expect((await app.inject({ method: 'DELETE', url: '/api/devices/BWN-DOWN', headers: as(adminToken) })).statusCode).toBe(204);
    });
  });

  describe('manual broker (HiveMQ)', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      app = await makeApp(manualProvisioner());
    });

    it('create returns console steps and stays pending until the admin confirms', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/devices', headers: as(adminToken), payload: { ...body, id: 'BWN-HMQ' } });
      expect(res.statusCode).toBe(201);
      const d = res.json();
      expect(d.brokerSyncStatus).toBe('pending');
      expect(d.brokerSetup).toMatchObject({ action: 'create', credential: { username: 'BWN-HMQ' } });
      expect(d.brokerSetup.steps.length).toBeGreaterThan(3);

      const done = await app.inject({
        method: 'PATCH',
        url: '/api/devices/BWN-HMQ',
        headers: as(adminToken),
        payload: { brokerSynced: true },
      });
      expect(done.json().brokerSyncStatus).toBe('synced');

      const rot = await app.inject({ method: 'POST', url: '/api/devices/BWN-HMQ/token/rotate', headers: as(adminToken) });
      expect(rot.json()).toMatchObject({ brokerSyncStatus: 'pending', brokerSetup: { action: 'update_password' } });
    });
  });

  describe.skipIf(!hasTestBroker)('end-to-end with local Mosquitto', () => {
    let app: FastifyInstance;
    let broker: BrokerProvisioner;
    const id = `E2E-${Date.now().toString(36).toUpperCase()}`;

    beforeAll(async () => {
      broker = createBroker({ BROKER_PROVIDER: 'mosquitto', MQTT_URL: testBrokerConn.url, MQTT_USERNAME: testBrokerConn.username, MQTT_PASSWORD: testBrokerConn.password }, 'test-api');
      app = await makeApp(broker);
    });
    afterAll(async () => {
      await broker?.deleteDevice(id).catch(() => {});
      await broker?.close();
    });

    it('create → publish with the token; rotate / disable / delete cut the device off', async () => {
      const created = (await app.inject({ method: 'POST', url: '/api/devices', headers: as(adminToken), payload: { ...body, id } })).json();
      expect(created.brokerSyncStatus).toBe('synced');
      const dev = await connectDevice(id, created.token);
      expect(await publishRc(dev, readingsTopic(id), '{"level":250}')).toBe(0);
      expect(await publishRc(dev, readingsTopic('BWN-001'))).toBe(135);

      const rotated = (await app.inject({ method: 'POST', url: `/api/devices/${id}/token/rotate`, headers: as(adminToken) })).json();
      expect(await closedWithin(dev, 2000)).toBe(true);
      await expect(connectDevice(id, created.token)).rejects.toThrow();
      const dev2 = await connectDevice(id, rotated.token);

      await app.inject({ method: 'PATCH', url: `/api/devices/${id}`, headers: as(adminToken), payload: { isEnabled: false } });
      expect(await closedWithin(dev2, 2000)).toBe(true);
      await expect(connectDevice(id, rotated.token)).rejects.toThrow();
      await app.inject({ method: 'PATCH', url: `/api/devices/${id}`, headers: as(adminToken), payload: { isEnabled: true } });
      const dev3 = await connectDevice(id, rotated.token);

      expect((await app.inject({ method: 'DELETE', url: `/api/devices/${id}`, headers: as(adminToken) })).statusCode).toBe(204);
      expect(await closedWithin(dev3, 2000)).toBe(true);
      await expect(connectDevice(id, rotated.token)).rejects.toThrow();
    });
  });
});

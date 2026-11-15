import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Sql } from '../../db/client.js';
import { createTestSql, hasTestDb, resetTestDb } from '../../test/testDb.js';
import { connectDevice, hasTestBroker, testBrokerConn } from '../../test/testBroker.js';
import { createBroker } from './broker/index.js';
import { manualProvisioner } from './broker/manual.js';
import type { BrokerProvisioner } from './broker/provisioner.js';
import { reconcileBroker } from './reconcile.js';

describe.skipIf(!hasTestDb)('reconcileBroker', () => {
  let sql: Sql;
  beforeAll(async () => {
    sql = createTestSql();
    await resetTestDb(sql);
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it('manual provider cannot list accounts → nothing to do', async () => {
    expect(await reconcileBroker(sql, manualProvisioner())).toBeNull();
  });

  describe.skipIf(!hasTestBroker)('local Mosquitto', () => {
    let broker: BrokerProvisioner;
    const p = `RC-${randomBytes(3).toString('hex').toUpperCase()}-`;
    const [OK, MISS, DIS, STRAY, GONE] = ['OK', 'MISS', 'DIS', 'STRAY', 'GONE'].map((s) => p + s) as [string, string, string, string, string];

    beforeAll(async () => {
      broker = createBroker(
        { BROKER_PROVIDER: 'mosquitto', MQTT_URL: testBrokerConn.url, MQTT_USERNAME: testBrokerConn.username, MQTT_PASSWORD: testBrokerConn.password },
        'test-reconcile',
      );
      const insert = (id: string, enabled = true, deleted = false) => sql`
        insert into devices (id, name, lat, lon, is_enabled, broker_sync_status, deleted_at)
        values (${id}, ${id}, -6.6, 106.8, ${enabled}, 'synced', ${deleted ? new Date() : null})`;
      await insert(OK);
      await insert(MISS);
      await insert(DIS, false);
      await insert(GONE, false, true); // soft-deleted, account left behind
      for (const id of [OK, DIS, STRAY, GONE]) await broker.createDevice(id, `pw-${id}`);
    });
    afterAll(async () => {
      for (const id of [OK, MISS, DIS, STRAY, GONE]) await broker?.deleteDevice(id).catch(() => {});
      await broker?.close();
    });

    it('DB is the source of truth: stray accounts removed, missing ones flagged, enabled state fixed', async () => {
      const report = await reconcileBroker(sql, broker, { scope: (id) => id.startsWith(p) });
      expect(report!.removed.sort()).toEqual([GONE, STRAY].sort());
      expect(report!.missing).toEqual([MISS]);
      expect(report!.fixedEnabled).toEqual([DIS]);

      const [miss] = await sql`select broker_sync_status from devices where id = ${MISS}`;
      expect(miss!.broker_sync_status).toBe('needs_token_rotation');
      await expect(connectDevice(STRAY, `pw-${STRAY}`)).rejects.toThrow();
      await expect(connectDevice(DIS, `pw-${DIS}`)).rejects.toThrow();
      const ok = await connectDevice(OK, `pw-${OK}`);
      await ok.endAsync();

      // second run: nothing left to fix
      expect(await reconcileBroker(sql, broker, { scope: (id) => id.startsWith(p) })).toEqual({
        removed: [],
        missing: [MISS],
        fixedEnabled: [],
      });
    });
  });
});

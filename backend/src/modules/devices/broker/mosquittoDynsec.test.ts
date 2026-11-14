import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { MqttClient } from 'mqtt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMqtt } from '../../../shared/mqttClient.js';
import { closedWithin, connectDevice, hasTestBroker, publishRc, sleep, testBrokerConn } from '../../../test/testBroker.js';
import { manualProvisioner } from './manual.js';
import { DEVICE_ROLE, mosquittoDynsec } from './mosquittoDynsec.js';
import { readingsTopic, type BrokerProvisioner } from './provisioner.js';

/** A connected client that accepts everything and never answers (broker without Dynamic Security). */
function silentClient(connected = true): MqttClient {
  const c = new EventEmitter() as unknown as MqttClient & { connected: boolean };
  c.connected = connected;
  c.subscribeAsync = (async () => [{ topic: 'x', qos: 1 }]) as unknown as MqttClient['subscribeAsync'];
  c.publish = ((_t: string, _m: string, _o: unknown, cb?: (err?: Error) => void) => {
    cb?.();
    return c;
  }) as unknown as MqttClient['publish'];
  return c;
}

describe('mosquitto adapter (unit)', () => {
  it('no reply within the timeout → BROKER_TIMEOUT', async () => {
    const p = mosquittoDynsec(silentClient(), { timeoutMs: 200 });
    await expect(p.createDevice('DEV-1', 'pw')).rejects.toMatchObject({ code: 'BROKER_TIMEOUT', statusCode: 504 });
  });

  it('broker not reachable → BROKER_UNAVAILABLE', async () => {
    const p = mosquittoDynsec(silentClient(false), { timeoutMs: 200 });
    await expect(p.deleteDevice('DEV-1')).rejects.toMatchObject({ code: 'BROKER_UNAVAILABLE' });
  });
});

describe('manual adapter (HiveMQ)', () => {
  it('never syncs by itself and returns console steps naming the device and its topics', async () => {
    const p = manualProvisioner();
    const r = await p.createDevice('BWN-001', 'bwn_secret');
    expect(r.synced).toBe(false);
    expect(r.setup?.action).toBe('create');
    expect(r.setup?.credential).toEqual({
      username: 'BWN-001',
      topics: ['baruna/devices/BWN-001/readings', 'baruna/devices/BWN-001/status'],
      permission: 'publish',
    });
    expect(r.setup?.steps.join('\n')).toContain('Username: BWN-001');
    expect(JSON.stringify(r)).not.toContain('bwn_secret'); // the token is shown once by the API, not copied here
    expect((await p.setPassword('BWN-001', 'x')).setup?.action).toBe('update_password');
    expect((await p.setEnabled('BWN-001', false)).setup?.action).toBe('disable');
    expect((await p.deleteDevice('BWN-001')).setup?.action).toBe('delete');
    expect(await p.listDevices()).toBeNull();
  });
});

describe.skipIf(!hasTestBroker)('mosquitto adapter (local broker)', () => {
  let backend: MqttClient;
  let broker: BrokerProvisioner;
  const received: string[] = [];
  const run = randomBytes(3).toString('hex').toUpperCase();
  const A = `T-${run}-A`;
  const B = `T-${run}-B`;

  beforeAll(async () => {
    backend = connectMqtt(testBrokerConn, 'test-backend');
    broker = mosquittoDynsec(backend);
    backend.on('message', (topic) => {
      if (!topic.startsWith('$')) received.push(topic);
    });
    await new Promise((r) => backend.once('connect', r));
    await backend.subscribeAsync('baruna/devices/#', { qos: 1 });
  });
  afterAll(async () => {
    await broker?.deleteDevice(A).catch(() => {});
    await broker?.deleteDevice(B).catch(() => {});
    await broker?.close();
    await backend?.endAsync();
  });

  it('a created device can publish only to its own topic', async () => {
    await expect(broker.createDevice(A, 'pw-a-1')).resolves.toEqual({ synced: true });
    const dev = await connectDevice(A, 'pw-a-1');
    expect(await publishRc(dev, readingsTopic(A))).toBe(0);
    expect(await publishRc(dev, readingsTopic('SOMEONE-ELSE'))).toBe(135);
    await sleep(300);
    expect(received).toContain(readingsTopic(A));
    expect(received).not.toContain(readingsTopic('SOMEONE-ELSE'));
    await dev.endAsync();
  });

  it('wrong password is refused', async () => {
    await expect(connectDevice(A, 'wrong')).rejects.toThrow(/Not authorized|Bad User Name or Password/i);
  });

  it('setPassword drops the live connection; old password refused, new accepted', async () => {
    const dev = await connectDevice(A, 'pw-a-1');
    await broker.setPassword(A, 'pw-a-2');
    expect(await closedWithin(dev, 2000)).toBe(true);
    await expect(connectDevice(A, 'pw-a-1')).rejects.toThrow();
    const again = await connectDevice(A, 'pw-a-2');
    await again.endAsync();
  });

  it('disable drops and refuses the device; enable lets it back in', async () => {
    const dev = await connectDevice(A, 'pw-a-2');
    await broker.setEnabled(A, false);
    expect(await closedWithin(dev, 2000)).toBe(true);
    await expect(connectDevice(A, 'pw-a-2')).rejects.toThrow();
    expect((await broker.listDevices())?.find((d) => d.id === A)).toEqual({ id: A, disabled: true });

    await broker.setEnabled(A, true);
    const back = await connectDevice(A, 'pw-a-2');
    await back.endAsync();
  });

  it('listDevices returns only device accounts', async () => {
    await broker.createDevice(B, 'pw-b');
    const ids = (await broker.listDevices())!.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([A, B]));
    expect(ids).not.toContain(testBrokerConn.username);
    expect(ids).not.toContain('admin');
  });

  it('delete drops and refuses the device; deleting twice is fine', async () => {
    const dev = await connectDevice(B, 'pw-b');
    await broker.deleteDevice(B);
    expect(await closedWithin(dev, 2000)).toBe(true);
    await expect(connectDevice(B, 'pw-b')).rejects.toThrow();
    await expect(broker.deleteDevice(B)).resolves.toEqual({ synced: true });
    await expect(broker.setEnabled(B, true)).rejects.toMatchObject({ code: 'BROKER_ACCOUNT_MISSING' });
  });

  it('setPassword recreates a missing device account', async () => {
    await broker.setPassword(B, 'pw-b-2');
    const dev = await connectDevice(B, 'pw-b-2');
    expect(await publishRc(dev, readingsTopic(B))).toBe(0);
    await dev.endAsync();
  });

  it('never touches non-device accounts (admin, backend)', async () => {
    for (const id of ['admin', testBrokerConn.username]) {
      await expect(broker.createDevice(id, 'hijack')).rejects.toMatchObject({ code: 'BROKER_USERNAME_CONFLICT' });
      await expect(broker.setPassword(id, 'hijack')).rejects.toMatchObject({ code: 'BROKER_USERNAME_CONFLICT' });
      await expect(broker.deleteDevice(id)).rejects.toMatchObject({ code: 'BROKER_USERNAME_CONFLICT' });
    }
    // backend account still works with its real password
    const c = await connectMqtt(testBrokerConn, 'test-check');
    await new Promise((r) => c.once('connect', r));
    await c.endAsync();
    expect(DEVICE_ROLE).toBe('baruna-device');
  });
});

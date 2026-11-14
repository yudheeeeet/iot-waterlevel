import { describe, expect, it } from 'vitest';
import { hasTestBroker, testBrokerConn } from '../test/testBroker.js';
import { explainMqttError, pingBroker } from './brokerPing.js';

describe('explainMqttError', () => {
  it('points at the likely cause', () => {
    expect(explainMqttError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x' })).toContain('Host tidak ditemukan');
    expect(explainMqttError({ code: 135, message: 'Connection refused: Not authorized' })).toContain('Username/password ditolak');
    expect(explainMqttError(new Error('connack timeout'))).toContain('Timeout');
  });
});

describe('pingBroker', () => {
  it('unreachable port → readable failure, no password in output', async () => {
    const r = await pingBroker({ url: 'mqtt://127.0.0.1:1', username: 'u', password: 'super-secret' }, { timeoutMs: 1500 });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain('super-secret');
  });

  it.skipIf(!hasTestBroker)('local backend account: connected, publish denied by design (subscribe only)', async () => {
    const r = await pingBroker(testBrokerConn, { count: 2, timeoutMs: 3000 });
    expect(r).toMatchObject({ ok: true, publishDenied: true, roundTripsMs: [] });
  });

  it.skipIf(!hasTestBroker)('local broker: wrong password explained', async () => {
    const r = await pingBroker({ ...testBrokerConn, password: 'wrong' }, { timeoutMs: 3000 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Username/password ditolak');
  });
});

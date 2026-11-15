import { randomUUID } from 'node:crypto';
import type { MqttClient } from 'mqtt';
import { waitConnected } from '../../../shared/mqttClient.js';
import {
  BrokerError,
  TOPIC_PREFIX,
  type BrokerDeviceAccount,
  type BrokerProvisioner,
  type ProvisionResult,
} from './provisioner.js';

/**
 * `mosquitto` adapter: manages device accounts through the Dynamic Security plugin
 * (`$CONTROL/dynamic-security/v1`), without editing files or restarting the broker.
 *
 * All devices share one role whose ACL uses `%u` (= the connecting username = device id),
 * so a device can publish only to its own topics:
 *   baruna/devices/{id}/readings, baruna/devices/{id}/status
 * Everything else (other devices' topics, subscribing) falls back to the default ACL, which denies it.
 */
export const DEVICE_ROLE = 'baruna-device';
const CONTROL_TOPIC = '$CONTROL/dynamic-security/v1';
const RESPONSE_TOPIC = `${CONTROL_TOPIC}/response`;
const DEVICE_ACLS = [`${TOPIC_PREFIX}/%u/readings`, `${TOPIC_PREFIX}/%u/status`];

interface DynsecResponse {
  command: string;
  error?: string;
  data?: unknown;
  correlationData?: string;
}
interface DynsecClientInfo {
  username: string;
  disabled?: boolean;
  roles?: { rolename: string }[];
}

const hasDeviceRole = (c: DynsecClientInfo | undefined) => !!c?.roles?.some((r) => r.rolename === DEVICE_ROLE);

export interface MosquittoOptions {
  /** Max wait for connect + reply per command (PRD: 5 s → BROKER_TIMEOUT). */
  timeoutMs?: number;
}

export function mosquittoDynsec(client: MqttClient, { timeoutMs = 5_000 }: MosquittoOptions = {}): BrokerProvisioner {
  const pending = new Map<string, (r: DynsecResponse) => void>();
  let subscribed: Promise<void> | null = null;
  let roleReady: Promise<void> | null = null;

  client.on('message', (topic, payload) => {
    if (topic !== RESPONSE_TOPIC) return;
    let body: { responses?: DynsecResponse[] };
    try {
      body = JSON.parse(payload.toString()) as typeof body;
    } catch {
      return;
    }
    for (const r of body.responses ?? []) {
      if (r.correlationData) pending.get(r.correlationData)?.(r);
    }
  });

  const subscribe = () =>
    (subscribed ??= client
      .subscribeAsync(RESPONSE_TOPIC, { qos: 1 })
      .then((granted) => {
        if (granted.some((g) => g.qos >= 128)) {
          throw new BrokerError('BROKER_ERROR', 'Akun backend tidak diizinkan membaca balasan Dynamic Security (cek ACL baruna-backend)');
        }
      })
      .catch((err: unknown) => {
        subscribed = null;
        throw err;
      }));

  /** Sends one command and waits for its reply. Throws BrokerError on timeout / no connection. */
  async function send(command: Record<string, unknown> & { command: string }): Promise<DynsecResponse> {
    const deadline = Date.now() + timeoutMs;
    try {
      await waitConnected(client, timeoutMs);
    } catch {
      throw new BrokerError('BROKER_UNAVAILABLE', 'Broker MQTT tidak dapat dihubungi');
    }
    await subscribe();

    const id = randomUUID();
    return new Promise<DynsecResponse>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          pending.delete(id);
          reject(new BrokerError('BROKER_TIMEOUT', `Broker tidak membalas perintah ${command.command} dalam ${timeoutMs / 1000} detik`));
        },
        Math.max(0, deadline - Date.now()),
      );
      pending.set(id, (r) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(r);
      });
      client.publish(CONTROL_TOPIC, JSON.stringify({ commands: [{ ...command, correlationData: id }] }), { qos: 1 }, (err) => {
        if (!err) return;
        clearTimeout(timer);
        pending.delete(id);
        reject(new BrokerError('BROKER_ERROR', `Gagal mengirim perintah ke broker: ${err.message}`));
      });
    });
  }

  /** Like send(), but a reply with `error` becomes a BrokerError unless listed in `ok`. */
  async function run(command: Record<string, unknown> & { command: string }, ok: string[] = []): Promise<DynsecResponse> {
    const r = await send(command);
    if (r.error && !ok.some((e) => r.error!.includes(e))) {
      throw new BrokerError('BROKER_ERROR', `Dynamic Security ${command.command}: ${r.error}`);
    }
    return r;
  }

  /** Creates the shared device role once per process (idempotent; repairs missing ACLs). */
  const ensureRole = () =>
    (roleReady ??= (async () => {
      await run({ command: 'createRole', rolename: DEVICE_ROLE }, ['already exists']);
      for (const topic of DEVICE_ACLS) {
        await run({ command: 'addRoleACL', rolename: DEVICE_ROLE, acltype: 'publishClientSend', topic, allow: true }, [
          'already exists',
        ]);
      }
    })().catch((err: unknown) => {
      roleReady = null;
      throw err;
    }));

  async function getClient(id: string): Promise<DynsecClientInfo | undefined> {
    const r = await run({ command: 'getClient', username: id }, ['not found']);
    return (r.data as { client?: DynsecClientInfo } | undefined)?.client;
  }

  /** Refuses to touch broker accounts that are not device accounts (e.g. admin, baruna-backend). */
  async function assertDeviceAccount(id: string): Promise<DynsecClientInfo | undefined> {
    const info = await getClient(id);
    if (info && !hasDeviceRole(info)) {
      throw new BrokerError('BROKER_USERNAME_CONFLICT', `Username "${id}" sudah dipakai akun broker lain (bukan device)`);
    }
    return info;
  }

  const synced: ProvisionResult = { synced: true };

  async function createDevice(id: string, password: string): Promise<ProvisionResult> {
    await ensureRole();
    const r = await run({ command: 'createClient', username: id, password, roles: [{ rolename: DEVICE_ROLE }] }, ['already exists']);
    if (r.error) {
      // Left over from an earlier attempt: reuse it only if it is a device account.
      await assertDeviceAccount(id);
      await run({ command: 'setClientPassword', username: id, password });
      await run({ command: 'enableClient', username: id });
    }
    return synced;
  }

  return {
    provider: 'mosquitto',
    createDevice,

    async setPassword(id, password) {
      const info = await assertDeviceAccount(id);
      if (!info) return createDevice(id, password);
      await run({ command: 'setClientPassword', username: id, password });
      return synced;
    },

    async setEnabled(id, enabled) {
      const info = await assertDeviceAccount(id);
      if (!info) {
        throw new BrokerError('BROKER_ACCOUNT_MISSING', `Akun device ${id} tidak ada di broker; lakukan rotasi token`);
      }
      await run({ command: enabled ? 'enableClient' : 'disableClient', username: id });
      return synced;
    },

    async deleteDevice(id) {
      const info = await assertDeviceAccount(id);
      if (info) await run({ command: 'deleteClient', username: id }, ['not found']);
      return synced;
    },

    async listDevices(): Promise<BrokerDeviceAccount[]> {
      const r = await run({ command: 'listClients', verbose: true, count: -1, offset: 0 });
      const clients = (r.data as { clients?: DynsecClientInfo[] } | undefined)?.clients ?? [];
      return clients.filter(hasDeviceRole).map((c) => ({ id: c.username, disabled: c.disabled === true }));
    },

    async close() {
      for (const resolve of pending.values()) resolve({ command: 'closed', error: 'closed' });
      pending.clear();
    },
  };
}

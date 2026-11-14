import type { Sql } from '../../db/client.js';
import type { BrokerProvisioner } from './broker/provisioner.js';
import { devicesRepo } from './repo.js';

export interface ReconcileReport {
  /** Broker accounts with no live device in the DB → deleted. */
  removed: string[];
  /** Live devices with no broker account → needs_token_rotation (the real token is not stored). */
  missing: string[];
  /** Accounts whose enabled state differed from the DB → corrected. */
  fixedEnabled: string[];
}

export interface ReconcileOptions {
  /** Limits which device ids are touched (tests share the local broker with development). */
  scope?: (id: string) => boolean;
}

/**
 * PRD DV-5: the DB is the source of truth for device accounts on Mosquitto.
 * Returns null when the provider cannot list accounts (`manual`).
 */
export async function reconcileBroker(
  sql: Sql,
  broker: BrokerProvisioner,
  { scope = () => true }: ReconcileOptions = {},
): Promise<ReconcileReport | null> {
  const accounts = await broker.listDevices();
  if (accounts === null) return null;

  const repo = devicesRepo(sql);
  const devices = await sql<{ id: string; isEnabled: boolean; brokerSyncStatus: string }[]>`
    select id, is_enabled as "isEnabled", broker_sync_status as "brokerSyncStatus"
    from devices where deleted_at is null`;
  const byId = new Map(devices.filter((d) => scope(d.id)).map((d) => [d.id, d]));
  const onBroker = new Map(accounts.filter((a) => scope(a.id)).map((a) => [a.id, a]));
  const report: ReconcileReport = { removed: [], missing: [], fixedEnabled: [] };

  for (const account of onBroker.values()) {
    const device = byId.get(account.id);
    if (!device) {
      await broker.deleteDevice(account.id);
      report.removed.push(account.id);
    } else if (account.disabled === device.isEnabled) {
      await broker.setEnabled(account.id, device.isEnabled);
      report.fixedEnabled.push(account.id);
    }
  }
  for (const device of byId.values()) {
    if (onBroker.has(device.id)) continue;
    if (device.brokerSyncStatus !== 'needs_token_rotation') await repo.setSyncStatus(device.id, 'needs_token_rotation');
    report.missing.push(device.id);
  }
  return report;
}

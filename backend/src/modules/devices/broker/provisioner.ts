import { AppError } from '../../../shared/errors.js';

/**
 * Broker adapter: keeps one MQTT account per device (username = device id, password = device token).
 *
 * - `mosquitto`: accounts are managed automatically through the Dynamic Security plugin.
 * - `manual`   : the broker cannot be managed by the backend (HiveMQ Cloud free tier); every call returns
 *                the steps the admin performs in the broker console instead.
 */
export type BrokerProvider = 'mosquitto' | 'manual';

export const TOPIC_PREFIX = 'baruna/devices';
export const readingsTopic = (deviceId: string) => `${TOPIC_PREFIX}/${deviceId}/readings`;
export const statusTopic = (deviceId: string) => `${TOPIC_PREFIX}/${deviceId}/status`;

/** Instructions for the admin when the broker must be configured by hand (`manual`). */
export interface BrokerSetup {
  action: 'create' | 'update_password' | 'disable' | 'enable' | 'delete';
  title: string;
  steps: string[];
  credential: { username: string; topics: string[]; permission: 'publish' };
}

export interface ProvisionResult {
  /** true = the broker already reflects the change; false = an admin still has to apply `setup`. */
  synced: boolean;
  setup?: BrokerSetup;
}

export interface BrokerDeviceAccount {
  id: string;
  disabled: boolean;
}

export interface BrokerProvisioner {
  readonly provider: BrokerProvider;
  createDevice(id: string, password: string): Promise<ProvisionResult>;
  /** Replaces the password (old connections are dropped). Recreates the account if it is missing. */
  setPassword(id: string, password: string): Promise<ProvisionResult>;
  setEnabled(id: string, enabled: boolean): Promise<ProvisionResult>;
  /** Idempotent: deleting a missing account succeeds. */
  deleteDevice(id: string): Promise<ProvisionResult>;
  /** Device accounts on the broker, or null when the provider cannot list them (`manual`). */
  listDevices(): Promise<BrokerDeviceAccount[] | null>;
  close(): Promise<void>;
}

/** Broker failures. `code` is stable and shown to the admin; secrets never appear in the message. */
export class BrokerError extends AppError {
  constructor(
    code:
      | 'BROKER_TIMEOUT'
      | 'BROKER_UNAVAILABLE'
      | 'BROKER_ERROR'
      | 'BROKER_ACCOUNT_MISSING'
      | 'BROKER_USERNAME_CONFLICT',
    message: string,
  ) {
    const status = { BROKER_TIMEOUT: 504, BROKER_UNAVAILABLE: 503, BROKER_USERNAME_CONFLICT: 409 }[code as string] ?? 502;
    super(code, message, status);
    this.name = 'BrokerError';
  }
}

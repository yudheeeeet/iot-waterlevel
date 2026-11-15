import { randomBytes } from 'node:crypto';
import { sha256 } from '../identity/tokens.js';

/**
 * Device token = MQTT password hard-coded in the firmware (PRD DV-2).
 * Shown once; the database keeps only the SHA-256 hash and the last 4 characters.
 */
export const DEVICE_TOKEN_PREFIX = 'bwn_';

export function newDeviceToken(): { token: string; hash: string; last4: string } {
  const token = DEVICE_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: sha256(token), last4: token.slice(-4) };
}

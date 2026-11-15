import type { MqttClient } from 'mqtt';
import { connectMqtt } from '../../../shared/mqttClient.js';
import { manualProvisioner } from './manual.js';
import { mosquittoDynsec } from './mosquittoDynsec.js';
import type { BrokerProvider, BrokerProvisioner } from './provisioner.js';

export interface BrokerEnv {
  BROKER_PROVIDER: BrokerProvider;
  MQTT_URL?: string | undefined;
  MQTT_USERNAME?: string | undefined;
  MQTT_PASSWORD?: string | undefined;
}

/**
 * Picks the adapter from BROKER_PROVIDER. In `mosquitto` mode it opens an MQTT connection
 * (env validation guarantees the credentials are present); `manual` opens nothing.
 * Pass an existing client (the worker's) to share one connection.
 */
export function createBroker(env: BrokerEnv, clientIdPrefix: string, existing?: MqttClient): BrokerProvisioner {
  if (env.BROKER_PROVIDER === 'manual') return manualProvisioner();
  const client =
    existing ?? connectMqtt({ url: env.MQTT_URL!, username: env.MQTT_USERNAME!, password: env.MQTT_PASSWORD! }, clientIdPrefix);
  // Connection errors surface per command as BROKER_UNAVAILABLE / BROKER_TIMEOUT; without a listener an
  // 'error' event would crash the process.
  if (!existing) client.on('error', () => {});
  const broker = mosquittoDynsec(client);
  return {
    ...broker,
    async close() {
      await broker.close();
      if (!existing) await client.endAsync();
    },
  };
}

import type { IClientOptions, MqttClient } from 'mqtt';
import type { Sql } from '../../db/client.js';
import { TOPIC_PREFIX } from '../devices/broker/provisioner.js';
import { ingestMessage, type IngestResult } from './service.js';

export const READINGS_SUBSCRIPTION = `${TOPIC_PREFIX}/+/readings`;

interface Log {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/** PRD IN-8 counters, logged periodically and reset. */
export interface IngestCounters {
  messages: number;
  stored: number;
  duplicates: number;
  unchanged: number;
  rejected: number;
  ignored: number;
  failed: number;
}
const zero = (): IngestCounters => ({ messages: 0, stored: 0, duplicates: 0, unchanged: 0, rejected: 0, ignored: 0, failed: 0 });

/**
 * Message pipeline for the worker. Messages are handled one at a time, in arrival order, and the
 * QoS 1 PUBACK is sent only after the DB transaction (customHandleAcks): a crash mid-way leaves
 * the message un-acked, so the broker re-delivers it to the persistent session.
 */
export function createIngestion(sql: Sql, log: Log, { retries = 3, retryBaseMs = 1_000 } = {}) {
  let counters = zero();
  let chain: Promise<void> = Promise.resolve();

  function count(r: IngestResult) {
    counters.messages++;
    if (r.outcome === 'ignored') {
      counters.ignored++;
      log.warn({ topic: r.deviceId ?? undefined, deviceId: r.deviceId, reason: r.reason }, 'message ignored');
    } else if (r.outcome === 'rejected') {
      counters.rejected++;
      log.warn({ deviceId: r.deviceId, reason: r.reason, detail: r.message }, 'message rejected');
    } else {
      counters.stored += r.stored;
      counters.duplicates += r.duplicates;
      counters.unchanged += r.unchanged;
      counters.rejected += r.rejectedTs;
      if (r.rejectedTs) log.warn({ deviceId: r.deviceId, rejectedTs: r.rejectedTs }, 'readings with invalid timestamp dropped');
      log.info({ deviceId: r.deviceId, stored: r.stored, received: r.received, lagMs: r.lagMs }, 'reading');
    }
  }

  async function handle(topic: string, payload: Buffer): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        count(await ingestMessage(sql, topic, payload));
        return;
      } catch (err) {
        if (attempt >= retries) {
          counters.failed++;
          log.error({ err, topic }, 'message failed after retries (dropped)');
          return;
        }
        await new Promise((r) => setTimeout(r, retryBaseMs * 2 ** attempt));
      }
    }
  }

  /** For mqtt.js `customHandleAcks`: handle, then ack (always 0 — retries happen here, not via the broker). */
  const customHandleAcks: NonNullable<IClientOptions['customHandleAcks']> = (topic, message, _packet, done) => {
    if (!topic.startsWith(`${TOPIC_PREFIX}/`)) return done(0);
    chain = chain.then(() => handle(topic, message)).finally(() => done(0));
  };

  return {
    customHandleAcks,
    /** Subscribe on every connect (no-op for the broker if the persistent session already has it). */
    attach(client: MqttClient) {
      client.on('connect', () => {
        client.subscribe(READINGS_SUBSCRIPTION, { qos: 1 }, (err, granted) => {
          if (err || granted?.some((g) => g.qos >= 128)) {
            log.error({ err: err?.message, granted }, `subscribe ${READINGS_SUBSCRIPTION} failed`);
          } else {
            log.info({ topic: READINGS_SUBSCRIPTION }, 'subscribed');
          }
        });
      });
    },
    /** Returns and resets the counters. */
    takeCounters(): IngestCounters {
      const c = counters;
      counters = zero();
      return c;
    },
    /** Resolves when everything received so far has been handled. */
    drain: () => chain,
  };
}

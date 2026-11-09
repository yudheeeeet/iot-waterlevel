/**
 * Realtime updates pushed by the backend (the backend consumes MQTT QoS 1,
 * de-duplicates, stores to PostgreSQL, then broadcasts here).
 *
 * Expected WebSocket messages (JSON):
 *   { type: 'reading',       data: { deviceId, distanceCm, timestamp, status, online } }
 *   { type: 'device_status', data: { deviceId, online, lastSeen } }
 *   { type: 'summary',       data: Summary }
 */
import { config } from '../config';
import { mockSubscribe } from '../mocks/mockBackend';

function wsUrl() {
  if (config.wsUrl) return config.wsUrl;
  if (config.apiUrl) return `${config.apiUrl.replace(/^http/, 'ws')}/ws/readings`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/readings`;
}

/**
 * Subscribe to realtime messages.
 * @param {(msg: object) => void} onMessage
 * @param {(state: 'connecting'|'open'|'closed') => void} [onState]
 * @returns {() => void} unsubscribe
 */
export function subscribeRealtime(onMessage, onState = () => {}) {
  if (config.useMock) {
    onState('open');
    const stop = mockSubscribe(onMessage);
    return () => { stop(); onState('closed'); };
  }

  let socket;
  let retry = 0;
  let timer;
  let closedByUser = false;

  const connect = () => {
    onState('connecting');
    socket = new WebSocket(wsUrl());
    socket.onopen = () => { retry = 0; onState('open'); };
    socket.onmessage = (event) => {
      try { onMessage(JSON.parse(event.data)); } catch { /* ignore malformed frame */ }
    };
    socket.onclose = () => {
      onState('closed');
      if (closedByUser) return;
      const wait = Math.min(30000, 1000 * 2 ** retry++); // exponential backoff, max 30 s
      timer = setTimeout(connect, wait);
    };
    socket.onerror = () => socket.close();
  };

  connect();
  return () => {
    closedByUser = true;
    clearTimeout(timer);
    socket?.close();
  };
}

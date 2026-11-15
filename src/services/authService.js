/**
 * Login session for the real backend.
 *
 * - The access token (15 min) lives only in memory, never in localStorage.
 * - The refresh token is an httpOnly cookie set by the backend (path /api/auth), so a page reload
 *   restores the session through POST /api/auth/refresh.
 * - apiClient calls refresh() once on a 401 and retries; concurrent 401s share one refresh.
 * In mock mode there is no login: a local admin user is used.
 */
import { config } from '../config';

let accessToken = null;
let user = config.useMock ? { id: 'mock', name: 'Demo Admin', email: 'demo@baruna.local', role: 'admin' } : null;
let refreshing = null;
const listeners = new Set();

const notify = () => listeners.forEach((fn) => fn(user));

export const authService = {
  getAccessToken: () => accessToken,
  getUser: () => user,
  isAdmin: () => user?.role === 'admin',

  /** Subscribe to login / logout changes. Returns unsubscribe. */
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  async login(email, password) {
    let res;
    try {
      res = await fetch(url('/api/auth/login'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new Error('Cannot reach the server. Check that the dashboard and the backend API are running.');
    }
    if (res.status >= 502 || (res.status === 500 && !res.headers.get('content-type')?.includes('json'))) {
      throw new Error('The backend API is not responding. Check that it is running (backend: npm run dev).');
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error?.message || `Login failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    setSession(body);
    return user;
  },

  /** New access token from the refresh cookie. Resolves true/false; never throws. */
  refresh() {
    if (config.useMock) return Promise.resolve(true);
    refreshing ??= fetch(url('/api/auth/refresh'), { method: 'POST', credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) throw new Error('refresh failed');
        setSession(await res.json());
        return true;
      })
      .catch(() => {
        clearSession();
        return false;
      })
      .finally(() => { refreshing = null; });
    return refreshing;
  },

  async logout() {
    try {
      await fetch(url('/api/auth/logout'), { method: 'POST', credentials: 'same-origin' });
    } finally {
      clearSession();
    }
  },

  /** Called by apiClient when the session cannot be renewed. */
  expire: () => clearSession(),
};

function setSession(body) {
  accessToken = body.accessToken;
  user = body.user;
  notify();
}

function clearSession() {
  const had = user !== null;
  accessToken = null;
  user = null;
  if (had) notify();
}

function url(path) {
  return `${config.apiUrl || ''}${path}`;
}

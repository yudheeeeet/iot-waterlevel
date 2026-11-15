import { config } from '../config';
import { authService } from './authService';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function buildUrl(path, query) {
  const base = config.apiUrl || '';
  const url = new URL(`${base}${path}`, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
  }
  return url.toString();
}

/**
 * fetch with the access token. On 401: refresh once and retry; if refreshing fails the session is
 * cleared (the app shows the login page).
 */
async function authedFetch(url, init = {}) {
  const send = () => {
    const token = authService.getAccessToken();
    return fetch(url, {
      ...init,
      credentials: 'same-origin',
      headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  };
  let res = await send();
  if (res.status === 401 && !config.useMock) {
    if (await authService.refresh()) res = await send();
    else authService.expire();
  }
  return res;
}

/** Error body of the backend: { error: { code, message, details } }. */
async function toError(res, fallback) {
  let payload = null;
  try { payload = await res.json(); } catch { /* not json */ }
  const details = payload?.error?.details;
  const detail = Array.isArray(details) && details[0]?.message ? `: ${details.map((d) => d.message).join(', ')}` : '';
  return new ApiError((payload?.error?.message || payload?.message || `${fallback} (${res.status})`) + detail, res.status, payload);
}

/** JSON request against the backend REST API. */
export async function request(path, { method = 'GET', body, query, signal } = {}) {
  const res = await authedFetch(buildUrl(path, query), {
    method,
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await toError(res, 'Request failed');
  if (res.status === 204) return null;
  return res.json();
}

/** Binary download (e.g. CSV/XLSX export). Returns { blob, filename }. */
export async function download(path, query) {
  const res = await authedFetch(buildUrl(path, query));
  if (!res.ok) throw await toError(res, 'Download failed');
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return { blob: await res.blob(), filename: match ? decodeURIComponent(match[1]) : null };
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { config } from '../config';

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

/** JSON request against the backend REST API. */
export async function request(path, { method = 'GET', body, query, signal } = {}) {
  const res = await fetch(buildUrl(path, query), {
    method,
    signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let payload = null;
    try { payload = await res.json(); } catch { /* not json */ }
    throw new ApiError(payload?.message || `Request failed (${res.status})`, res.status, payload);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Binary download (e.g. CSV/XLSX export). Returns { blob, filename }. */
export async function download(path, query) {
  const res = await fetch(buildUrl(path, query));
  if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status);
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

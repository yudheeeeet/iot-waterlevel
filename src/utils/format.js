const TZ = 'Asia/Jakarta';

const parts = (date, options) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...options })
      .formatToParts(new Date(date))
      .map((p) => [p.type, p.value]),
  );

/** 07 Nov 2026, 14:30 WIB */
export function formatDateTime(date, { seconds = false, suffix = true } = {}) {
  if (!date) return '—';
  const p = parts(date, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false,
  });
  const time = seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
  return `${p.day} ${p.month} ${p.year}, ${time}${suffix ? ' WIB' : ''}`;
}

/** 14:30 or 14:30:00 */
export function formatTime(date, { seconds = false } = {}) {
  if (!date) return '—';
  const p = parts(date, { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false });
  return seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
}

/** 07 Nov */
export function formatDayMonth(date) {
  const p = parts(date, { day: '2-digit', month: 'short' });
  return `${p.day} ${p.month}`;
}

/** 07 Nov 2026 */
export function formatDate(date) {
  const p = parts(date, { day: '2-digit', month: 'short', year: 'numeric' });
  return `${p.day} ${p.month} ${p.year}`;
}

/** Mon */
export function formatWeekday(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' }).format(new Date(date));
}

/** YYYY-MM-DD in Jakarta time */
export function jakartaDateKey(date = new Date()) {
  const p = parts(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Value for <input type="datetime-local"> in Jakarta time */
export function toLocalInputValue(date) {
  const p = parts(date, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Parse an <input type="datetime-local"> value as Jakarta time (UTC+7, no DST). */
export function fromLocalInputValue(value) {
  if (!value) return null;
  return new Date(`${value}:00+07:00`);
}

export const cmToM = (cm) => (cm == null ? null : cm / 100);

export function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits);
}

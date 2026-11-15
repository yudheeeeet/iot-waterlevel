import { useEffect, useRef, useState } from 'react';
import { Bell, LogOut } from 'lucide-react';
import { config } from '../config';
import { formatDateTime } from '../utils/format';
import { displayStatus, statusMeta } from '../utils/status';
import bundledLogo from '../assets/logo-baruna-inotek.svg';

// Your own logo: put the file in /public (e.g. public/logo.png) and set VITE_LOGO_URL=/logo.png in .env.
// Without VITE_LOGO_URL the bundled src/assets/logo-baruna-inotek.svg is used.
const logoUrl = config.logo.url || bundledLogo;

export default function Header({ devices, summary, lastUpdate, realtimeState, user, onLogout }) {
  const total = summary?.devices?.total ?? devices.length;
  const online = summary?.devices?.online ?? devices.filter((d) => d.online).length;
  // 'open' = WebSocket connected; 'polling' = REST refresh working (MVP, VITE_REALTIME=off)
  const connected = realtimeState === 'open' || realtimeState === 'polling';

  return (
    <header className="sys-header">
      <Logo />
      <span className="sys-header__divider sys-header__divider--tall" />
      <div className="sys-header__identity">
        <h1>Water Level Monitoring</h1>
        <p>Real-Time IoT Monitoring System</p>
      </div>
      <div className="sys-header__update">
        <div className="sys-header__connection">
          <span className="dot" style={{ background: connected ? 'var(--success-500)' : 'var(--warning-500)' }} />
          <strong>{online} of {total} devices connected</strong>
        </div>
        <span>Last update · {formatDateTime(lastUpdate)}</span>
      </div>
      <span className="sys-header__divider" />
      <Notifications devices={devices} />
      <UserMenu user={user} onLogout={onLogout} />
    </header>
  );
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
}

/** Avatar with the signed-in user, role and Sign out. */
function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="notif" ref={ref}>
      <button type="button" className="sys-header__avatar" aria-label="Account" onClick={() => setOpen((o) => !o)}>
        {user ? initials(user.name) : config.user.initials}
      </button>
      {open && user && (
        <div className="notif__panel user-menu">
          <strong>{user.name}</strong>
          <span className="muted">{user.email}</span>
          <span className="user-menu__role">{user.role === 'admin' ? 'Admin' : 'Viewer'}</span>
          <button type="button" className="btn btn--secondary user-menu__logout" onClick={onLogout}>
            <LogOut size={15} strokeWidth={1.75} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Logo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="logo-fallback" aria-label="Baruna Inotek">
        <span>BARUNA</span><span>INOTEK</span>
      </div>
    );
  }
  return <img className="sys-header__logo" src={logoUrl} alt="Baruna Inotek" onError={() => setFailed(true)} />;
}

/** Bell with unread dot; alerts are devices currently in warning/critical or offline. */
function Notifications({ devices }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState('');
  const ref = useRef(null);

  const alerts = devices
    .map((d) => ({ device: d, status: displayStatus(d) }))
    .filter((a) => a.status !== 'normal')
    .sort((a, b) => rank(b.status) - rank(a.status));
  const signature = alerts.map((a) => `${a.device.id}:${a.status}`).join('|');
  const unread = alerts.length > 0 && signature !== seen;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="notif" ref={ref}>
      <button
        type="button"
        className="notif__btn"
        aria-label={`Notifications${unread ? ' (unread)' : ''}`}
        onClick={() => { setOpen((o) => !o); setSeen(signature); }}
      >
        <Bell size={20} strokeWidth={1.75} />
        {unread && <span className="notif__dot" />}
      </button>
      {open && (
        <div className="notif__panel">
          <div className="notif__title">Device alerts</div>
          {alerts.length === 0 && <p className="notif__empty">All devices are normal.</p>}
          {alerts.map(({ device, status }) => (
            <div key={device.id} className="notif__item">
              <span className="dot" style={{ background: statusMeta(status).color }} />
              <div>
                <strong>{device.id} · {device.name}</strong>
                <span>
                  {statusMeta(status).label}
                  {device.lastReading && status !== 'offline' && ` · ${(device.lastReading.distanceCm / 100).toFixed(2)} m`}
                  {status === 'offline' && device.lastReading && ` · last seen ${formatDateTime(device.lastReading.timestamp)}`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const rank = (s) => ({ critical: 3, warning: 2, offline: 1 }[s] || 0);

import { useEffect } from 'react';
import { X, Sun, CloudSun, Cloud, CloudFog, CloudRain, CloudLightning } from 'lucide-react';
import { statusMeta } from '../../utils/status';

export function Card({ className = '', children, ...rest }) {
  return <section className={`card ${className}`} {...rest}>{children}</section>;
}

export function StatusBadge({ status, label }) {
  const meta = statusMeta(status);
  return (
    <span className="badge" style={{ background: meta.bg, color: meta.text }}>
      <span className="dot" style={{ background: meta.color }} />
      {label || meta.label}
    </span>
  );
}

/** Small teal chip, e.g. "Simulated live", "Live" */
export function AccentChip({ children, pulse = false }) {
  return (
    <span className="badge badge--accent">
      <span className={`dot dot--accent ${pulse ? 'dot--pulse' : ''}`} />
      {children}
    </span>
  );
}

export function Button({ variant = 'secondary', className = '', ...rest }) {
  return <button type="button" className={`btn btn--${variant} ${className}`} {...rest} />;
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

const WEATHER_ICONS = { sun: Sun, 'cloud-sun': CloudSun, cloud: Cloud, fog: CloudFog, rain: CloudRain, storm: CloudLightning };

export function WeatherIcon({ kind, size = 28, strokeWidth = 1.75, ...rest }) {
  const Icon = WEATHER_ICONS[kind] || Cloud;
  return <Icon size={size} strokeWidth={strokeWidth} {...rest} />;
}

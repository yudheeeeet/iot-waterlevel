import { useState } from 'react';
import { Copy, Check, AlertTriangle, KeyRound, Download } from 'lucide-react';
import { Button, Modal } from '../ui';
import { buildCredentialsText, credentialsFileName, downloadTextFile } from '../../utils/credentialsFile';

/**
 * Shown once after "Add device" or "Rotate token": the device token and MQTT settings for the
 * firmware. The token cannot be shown again (the backend keeps only its hash).
 * The modal cannot be dismissed until the token was downloaded, copied, or the admin confirms
 * saving it some other way.
 * With a manual broker (HiveMQ) the console steps are listed and the admin confirms when done.
 */
export default function DeviceCredentials({ issued, onClose, onMarkSynced }) {
  const [marking, setMarking] = useState(false);
  const [synced, setSynced] = useState(issued.brokerSyncStatus === 'synced');
  const [error, setError] = useState(null);
  const [downloaded, setDownloaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { mqtt, brokerSetup, brokerError } = issued;
  const saved = !issued.token || downloaded || copied || confirmed;

  const download = () => {
    const now = new Date();
    downloadTextFile(credentialsFileName(issued.id, now), buildCredentialsText(issued, now));
    setDownloaded(true);
  };

  const markSynced = async () => {
    setMarking(true);
    setError(null);
    try {
      await onMarkSynced(issued.id);
      setSynced(true);
    } catch (e) {
      setError(e.message || 'Could not update the device');
    } finally {
      setMarking(false);
    }
  };

  return (
    <Modal
      title={`Device credentials · ${issued.id}`}
      onClose={onClose}
      locked={!saved}
      footer={<Button variant="primary" onClick={onClose} disabled={!saved}>Close</Button>}
    >
      <div className="creds">
        <p className="creds__warning">
          <KeyRound size={15} strokeWidth={1.75} />
          <span>
            This token is shown <strong>only once</strong> and cannot be displayed again. Download or copy it now;
            if it is lost, rotate the token and flash the firmware again.
          </span>
        </p>

        {issued.token && (
          <>
            <Button variant="primary" onClick={download} className="creds__download">
              {downloaded ? <Check size={16} strokeWidth={1.75} /> : <Download size={16} strokeWidth={1.75} />}
              {downloaded ? 'Downloaded · download again' : 'Download credentials (.txt)'}
            </Button>
            <p className="muted creds__hint">
              Keep the file in a password manager or a restricted folder. Anyone holding it can send data as this device.
            </p>
            <CopyRow label="Token (MQTT password)" value={issued.token} mono onCopied={() => setCopied(true)} />
          </>
        )}
        {mqtt && (
          <>
            <CopyRow label="Username / client ID" value={mqtt.username} mono />
            <CopyRow label="Broker" value={`${mqtt.host}:${mqtt.port}${mqtt.tls ? ' (TLS)' : ''}`} mono />
            <CopyRow label="Topic" value={mqtt.topic} mono />
          </>
        )}

        {brokerError && (
          <p className="creds__error">
            <AlertTriangle size={15} strokeWidth={1.75} />
            <span>
              Broker not updated ({brokerError.code}): {brokerError.message}. The device is saved; use <strong>Rotate token</strong> to retry.
            </span>
          </p>
        )}

        {brokerSetup && (
          <div className="creds__setup">
            <strong>{brokerSetup.title}</strong>
            <ol>
              {brokerSetup.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
            {['create', 'update_password'].includes(brokerSetup.action) && (
              synced ? (
                <p className="creds__ok"><Check size={15} /> Marked as set up in the broker.</p>
              ) : (
                <Button onClick={markSynced} disabled={marking}>{marking ? 'Saving…' : 'Mark as set up in broker'}</Button>
              )
            )}
            {error && <p className="form-error">{error}</p>}
          </div>
        )}

        {issued.token && !downloaded && !copied && (
          <label className="creds__confirm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I have saved the token another way</span>
          </label>
        )}
      </div>
    </Modal>
  );
}

function CopyRow({ label, value, mono, onCopied }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the value is still selectable */ }
  };
  return (
    <div className="creds__row">
      <span className="muted">{label}</span>
      <div className="creds__value">
        <code className={mono ? 'creds__mono' : ''}>{value}</code>
        <button type="button" className="icon-btn" aria-label={`Copy ${label}`} onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import { authService } from '../services/authService';
import { Button } from './ui';
import bundledLogo from '../assets/logo-baruna-inotek.svg';
import { config } from '../config';

const logoUrl = config.logo.url || bundledLogo;

/** Sign-in page. Every dashboard user must log in (PRD ID-1). */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authService.login(email.trim(), password);
    } catch (err) {
      setError(err.message || 'Login failed');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        {/* The logo is white (made for the navy header), so it sits on a navy band. */}
        <div className="login-card__brand">
          <img className="login-card__logo" src={logoUrl} alt="Baruna Inotek" />
        </div>
        <div>
          <h1 className="login-card__title">Water Level Monitoring</h1>
          <p className="section-sub">Sign in to continue</p>
        </div>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <div className="password-input">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="password-input__toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
            </button>
          </div>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button variant="primary" type="submit" disabled={busy || !email || !password} className="login-card__submit">
          <LogIn size={16} strokeWidth={1.75} /> {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <footer className="login-footer">© 2026 PT Baruna Inotek</footer>
    </div>
  );
}

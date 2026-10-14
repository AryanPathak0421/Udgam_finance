import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import AuthShell from '../components/AuthShell.jsx';
import Icon from '../components/Icon.jsx';

const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!PASSWORD_RE.test(password)) return setError('Password must be 8–64 characters with letters and numbers');
    if (password !== confirm) return setError('Passwords do not match');
    setSubmitting(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.errors?.password || err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <div className="auth-card">
          <h1>Invalid link</h1>
          <p className="auth-sub">This password reset link is incomplete. Please request a new one.</p>
          <Link to="/forgot-password" className="auth-submit as-link">
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell>
        <div className="auth-card">
          <div className="auth-icon-circle ok">
            <Icon name="check" size={26} />
          </div>
          <h1>Password updated</h1>
          <p className="auth-sub">Your password has been changed. Sign in with your new password.</p>
          <Link to="/login" className="auth-submit as-link">
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h1>Set a new password</h1>
        <p className="auth-sub">Choose a strong password you have not used before.</p>

        {error && (
          <div className="alert" role="alert">
            {error}{' '}
            {error.includes('expired') && (
              <Link to="/forgot-password" className="auth-link">
                Request a new link
              </Link>
            )}
          </div>
        )}

        <label htmlFor="password">New password</label>
        <div className="input-icon">
          <Icon name="lock" size={18} />
          <input
            id="password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="8+ characters, letters and numbers"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
          <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
            <Icon name={show ? 'eyeoff' : 'eye'} size={18} />
          </button>
        </div>

        <label htmlFor="confirm">Confirm password</label>
        <div className="input-icon">
          <Icon name="lock" size={18} />
          <input
            id="confirm"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Re-enter the password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        <button className="auth-submit" type="submit" disabled={submitting || !password || !confirm}>
          {submitting ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import AuthShell from '../components/AuthShell.jsx';
import Icon from '../components/Icon.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.errors?.email || err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell>
        <div className="auth-card">
          <div className="auth-icon-circle">
            <Icon name="mail" size={26} />
          </div>
          <h1>Check your email</h1>
          <p className="auth-sub">
            If <strong>{email.trim()}</strong> is registered, we have sent a password reset link to it. The link is
            valid for 60 minutes.
          </p>
          <p className="auth-sub">Did not receive it? Check your spam folder, or try again in a few minutes.</p>
          <Link to="/login" className="auth-submit as-link">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h1>Forgot password?</h1>
        <p className="auth-sub">Enter your registered email and we will send you a link to reset your password.</p>

        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        <label htmlFor="email">Registered email</label>
        <div className="input-icon">
          <Icon name="mail" size={18} />
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </div>

        <button className="auth-submit" type="submit" disabled={submitting || !email}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>

        <div className="auth-row center">
          <Link to="/login" className="auth-link">
            ← Back to sign in
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

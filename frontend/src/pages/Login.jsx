import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AuthShell from '../components/AuthShell.jsx';
import Icon from '../components/Icon.jsx';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        {/* Switch to Employee Mobile App Banner */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          background: 'linear-gradient(135deg, #eef7f6, #eff1fe)',
          border: '1.5px solid #107870',
          borderRadius: 12,
          padding: '12px 14px',
          marginBottom: 20
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#107870', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📱</span> Employee & Field App
            </div>
            <div style={{ fontSize: '0.8rem', color: '#555', marginTop: 2 }}>
              कर्मचारी एवं फील्ड लॉगिन (mPIN)
            </div>
          </div>
          <Link
            to="/employee/login"
            style={{
              padding: '8px 14px',
              background: '#107870',
              color: '#ffffff',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: '0.82rem',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 6px rgba(16,120,112,0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            Open App ➔
          </Link>
        </div>

        <h1>Welcome back</h1>
        <p className="auth-sub">Sign in to continue to the admin panel</p>

        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}

        <label htmlFor="email">Email</label>
        <div className="input-icon">
          <Icon name="mail" size={18} />
          <input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </div>

        <label htmlFor="password">Password</label>
        <div className="input-icon">
          <Icon name="lock" size={18} />
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button
            type="button"
            className="eye"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            <Icon name={showPassword ? 'eyeoff' : 'eye'} size={18} />
          </button>
        </div>

        <div className="auth-row">
          <Link to="/forgot-password" className="auth-link">
            Forgot password?
          </Link>
        </div>

        <button className="auth-submit" type="submit" disabled={submitting || !email || !password}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="auth-secure">
          <Icon name="shield" size={14} /> Secure, encrypted session
        </div>

        <div style={{ marginTop: 20, textAlign: 'center', borderTop: '1px solid #eef0f4', paddingTop: 14 }}>
          <Link
            to="/employee/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              color: '#107870',
              fontWeight: 700,
              fontSize: '0.9rem',
              textDecoration: 'none'
            }}
          >
            <span>📱</span> Switch to Employee / Field Officer App
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

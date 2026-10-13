import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
import '../styles/login.css';

const FEATURES = [
  'Customer, group & KYC management',
  'Loan lifecycle: application to closure',
  'Collections, recovery & overdue tracking',
  'Role-based access with full audit trail',
];

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
    <main className="auth">
      <section className="auth-brand" aria-hidden="false">
        <div className="auth-ring ring-a" />
        <div className="auth-ring ring-b" />
        <div className="auth-brand-inner">
          <div className="auth-logo-tile">
            <img src="/logo.png" alt="Udgam Microfinance — You happy we happy" />
          </div>
          <h2>Empowering every household, one loan at a time.</h2>
          <p>One secure workspace to run branches, lending and collections.</p>
          <ul>
            {FEATURES.map((f) => (
              <li key={f}>
                <span className="tick">
                  <Icon name="check" size={14} />
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="auth-brand-foot">© {new Date().getFullYear()} Udgam Microfinance</div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <img className="auth-logo-mobile" src="/logo.png" alt="Udgam Microfinance" />

          <form className="auth-card" onSubmit={onSubmit} noValidate>
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

            <button className="auth-submit" type="submit" disabled={submitting || !email || !password}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            <div className="auth-secure">
              <Icon name="shield" size={14} /> Secure, encrypted session
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

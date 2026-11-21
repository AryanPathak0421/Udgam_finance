import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AuthShell from '../components/AuthShell.jsx';
import Icon from '../components/Icon.jsx';

// The three mobile apps. A button downloads the APK of the app when the file is on the server (frontend/public/downloads);
// without the file it opens the app's own login page, where Install / Add to Home screen keeps it on the phone.
const APPS = [
  { name: 'Staff App', sub: 'Field staff: collections, requisitions, members', href: '/employee/login', icon: '/icon-192.png', apk: '/downloads/Udgam_Staff.apk', apkName: 'Udgam_Staff.apk' },
  { name: 'Supervisor App', sub: 'Supervisors: approvals, team and branch', href: '/supervisor/login', icon: '/icon-supervisor-192.png', apk: '/downloads/Udgam_Supervisor.apk', apkName: 'Udgam_Supervisor.apk' },
  { name: 'Member App', sub: 'Members: loans, EMI and security', href: '/member/login', icon: '/icon-member-192.png', apk: '/downloads/Udgam_Member.apk', apkName: 'Udgam_Member.apk' },
];

// Is the APK really there? (a missing file is answered with the web page, so the type is checked too)
async function apkIsThere(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const type = res.headers.get('content-type') || '';
    return res.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

function AppRow({ app }) {
  const [busy, setBusy] = useState(false);
  async function onDownload(e) {
    e.preventDefault();
    setBusy(true);
    const there = await apkIsThere(app.apk);
    setBusy(false);
    if (there) {
      const a = document.createElement('a');
      a.href = app.apk;
      a.download = app.apkName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.open(app.href, '_blank', 'noopener');
    }
  }
  return (
    <li className="app-row">
      <img src={app.icon} alt="" width={40} height={40} />
      <div className="app-text">
        <strong>{app.name}</strong>
        <span>{app.sub}</span>
      </div>
      <div className="app-actions">
        <a className="app-btn primary" href={app.apk} onClick={onDownload}>{busy ? 'Please wait…' : 'Download'}</a>
        <Link className="app-btn" to={app.href}>Open</Link>
      </div>
    </li>
  );
}

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

      </form>

      <section className="auth-apps" aria-labelledby="apps-title">
        <h2 id="apps-title">Mobile apps</h2>
        <p>Download the app for your phone, or open it in the browser and tap <strong>Install</strong> / <strong>Add to Home screen</strong>.</p>
        <ul>
          {APPS.map((app) => <AppRow key={app.href} app={app} />)}
        </ul>
      </section>
    </AuthShell>
  );
}

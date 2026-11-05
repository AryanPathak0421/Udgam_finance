import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useEmpApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeLogin() {
  const { login, t } = useEmpApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState('phone'); // 'phone', 'email', 'code'
  const [identifier, setIdentifier] = useState('');
  const [mpin, setMpin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Forgot MPIN states
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [newMpin, setNewMpin] = useState('');
  const [step, setStep] = useState(1);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMsg, setForgotMsg] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    if (!identifier.trim() || !mpin.trim()) {
      setError('Please fill in both fields');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.employeeApp.login({ identifier: identifier.trim(), mpin: mpin.trim() });
      login(r.user, r.token);
      navigate('/employee');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSendForgotOtp(e) {
    e.preventDefault();
    if (!forgotId.trim()) return;
    setForgotBusy(true);
    setForgotMsg('');
    try {
      const r = await api.employeeApp.forgotMpinSendOtp(forgotId.trim());
      setChallengeId(r.challengeId);
      setStep(2);
      setForgotMsg(`OTP sent to ${r.maskedMobile}`);
    } catch (err) {
      setForgotMsg(err.message);
    } finally {
      setForgotBusy(false);
    }
  }

  async function handleResetMpin(e) {
    e.preventDefault();
    setForgotBusy(true);
    try {
      await api.employeeApp.forgotMpinVerify({ challengeId, otp, newMpin });
      alert('mPIN reset successfully! Please login with your new mPIN.');
      setForgotOpen(false);
      setStep(1);
    } catch (err) {
      setForgotMsg(err.message);
    } finally {
      setForgotBusy(false);
    }
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <img
          src="/logo.png"
          alt="Udgam Microfinance"
          style={{ height: 44, borderRadius: 8, marginBottom: 10, display: 'inline-block' }}
        />
        <h2 style={{ margin: 0, fontSize: '1.35rem', color: 'var(--emp-text)', fontWeight: 800 }}>Udgam Finance</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--emp-text-muted)', fontSize: '0.88rem' }}>Field Officer & Employee App</p>
      </div>

      <div className="emp-card" style={{ borderTop: '4px solid var(--emp-accent, #feba10)' }}>
        {/* Tab selection */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--emp-border)', marginBottom: 16 }}>
          <button
            type="button"
            className="emp-btn secondary sm"
            style={{
              flex: 1,
              borderBottom: tab === 'phone' ? '2px solid var(--emp-primary)' : 'none',
              borderRadius: 0,
              fontWeight: tab === 'phone' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6
            }}
            onClick={() => { setTab('phone'); setIdentifier(''); setError(''); }}
          >
            <Icon name="phone" size={15} />
            <span>Mobile</span>
          </button>
          <button
            type="button"
            className="emp-btn secondary sm"
            style={{
              flex: 1,
              borderBottom: tab === 'code' ? '2px solid var(--emp-primary)' : 'none',
              borderRadius: 0,
              fontWeight: tab === 'code' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6
            }}
            onClick={() => { setTab('code'); setIdentifier(''); setError(''); }}
          >
            <Icon name="hash" size={15} />
            <span>Staff ID</span>
          </button>
          <button
            type="button"
            className="emp-btn secondary sm"
            style={{
              flex: 1,
              borderBottom: tab === 'email' ? '2px solid var(--emp-primary)' : 'none',
              borderRadius: 0,
              fontWeight: tab === 'email' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6
            }}
            onClick={() => { setTab('email'); setIdentifier(''); setError(''); }}
          >
            <Icon name="mail" size={15} />
            <span>Email</span>
          </button>
        </div>

        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--emp-danger-light)',
            color: 'var(--emp-danger)',
            borderRadius: 8,
            fontSize: '0.85rem',
            marginBottom: 12
          }}>
            <Icon name="alertcircle" size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="emp-input-group">
            <label className="emp-label">
              {tab === 'phone' ? '10-digit Mobile Number' : tab === 'code' ? 'Employee Code (e.g. EMP001)' : 'Registered Email Address'}
            </label>
            <input
              type={tab === 'phone' ? 'tel' : tab === 'email' ? 'email' : 'text'}
              className="emp-input"
              required
              autoFocus
              placeholder={tab === 'phone' ? '9876543210' : tab === 'code' ? 'EMP001' : 'staff@udgam.com'}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>

          <div className="emp-input-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="emp-label">Secret mPIN</label>
              <button
                type="button"
                onClick={() => { setForgotOpen(true); setForgotId(identifier); }}
                style={{ background: 'none', border: 'none', color: 'var(--emp-primary)', fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}
              >
                Forgot mPIN?
              </button>
            </div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              className="emp-input"
              required
              placeholder="••••"
              value={mpin}
              onChange={(e) => setMpin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>

          <button type="submit" className="emp-btn" disabled={busy} style={{ marginTop: 8 }}>
            {busy ? 'Logging in…' : 'Secure Login'}
          </button>
        </form>

        <div style={{ marginTop: 18, textAlign: 'center', borderTop: '1px solid var(--emp-border)', paddingTop: 14 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--emp-text-muted)' }}>First time using the app? </span>
          <Link to="/employee/register-mpin" style={{ fontSize: '0.85rem', color: 'var(--emp-primary)', fontWeight: 600, textDecoration: 'none' }}>
            Create mPIN
          </Link>
        </div>

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link
            to="/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.82rem',
              color: 'var(--emp-text-muted)',
              textDecoration: 'none'
            }}
          >
            <Icon name="desktop" size={14} />
            <span>Go to Admin / Head Office Portal</span>
          </Link>
        </div>
      </div>

      {/* Forgot mPIN Modal */}
      {forgotOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--emp-card-bg)', width: '100%', maxWidth: 380, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1.1rem' }}>Reset mPIN</strong>
              <button className="emp-icon-btn" onClick={() => setForgotOpen(false)} aria-label="Close">
                <Icon name="cross" size={16} />
              </button>
            </div>
            {forgotMsg && (
              <div style={{ padding: '8px 12px', background: 'var(--emp-primary-light)', color: 'var(--emp-primary)', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
                {forgotMsg}
              </div>
            )}
            {step === 1 ? (
              <form onSubmit={handleSendForgotOtp}>
                <div className="emp-input-group">
                  <label className="emp-label">Enter Employee Code or Mobile</label>
                  <input
                    className="emp-input"
                    required
                    value={forgotId}
                    onChange={(e) => setForgotId(e.target.value)}
                    placeholder="e.g. EMP001 or Mobile"
                  />
                </div>
                <button type="submit" className="emp-btn" disabled={forgotBusy}>
                  {forgotBusy ? 'Sending OTP…' : 'Send OTP to Registered Phone'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetMpin}>
                <div className="emp-input-group">
                  <label className="emp-label">6-digit OTP</label>
                  <input
                    type="tel"
                    maxLength={6}
                    className="emp-input"
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
                <div className="emp-input-group">
                  <label className="emp-label">Set New mPIN (4 to 6 digits)</label>
                  <input
                    type="password"
                    maxLength={6}
                    className="emp-input"
                    required
                    value={newMpin}
                    onChange={(e) => setNewMpin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
                <button type="submit" className="emp-btn" disabled={forgotBusy}>
                  {forgotBusy ? 'Updating…' : 'Verify & Set New mPIN'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


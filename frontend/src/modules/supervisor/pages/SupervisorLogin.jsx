import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSupApp } from '../SupervisorAppContext.jsx';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorLogin() {
  const { login } = useSupApp();
  const navigate = useNavigate();

  const [tab, setTab] = useState('phone'); // 'phone' | 'code' | 'email'
  const [identifier, setIdentifier] = useState('');
  const [mpin, setMpin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Forgot mPIN modal state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [otp, setOtp] = useState('');
  const [newMpin, setNewMpin] = useState('');
  const [step, setStep] = useState(1);
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');

    const id = identifier.trim();
    if (!id) {
      setError('Please enter your Supervisor credentials');
      return;
    }
    if (tab === 'phone' && !/^\d{10}$/.test(id)) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    if (!/^\d{4}$/.test(mpin)) {
      setError('Please enter your 4-digit secret mPIN');
      return;
    }

    setBusy(true);
    try {
      const res = await api.supervisorApp.login({ identifier: id, mpin });
      login(res.user, res.token);
      navigate('/supervisor', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed. Please check credentials.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSendForgotOtp(e) {
    e.preventDefault();
    setForgotBusy(true);
    setForgotMsg('');
    setError('');
    try {
      const r = await api.supervisorApp.forgotMpinSendOtp(forgotId.trim());
      setForgotMsg(r.message || 'OTP sent successfully');
      setStep(2);
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setForgotBusy(false);
    }
  }

  async function handleResetMpin(e) {
    e.preventDefault();
    if (!/^\d{4}$/.test(newMpin)) {
      setError('New mPIN must be exactly 4 numeric digits');
      return;
    }
    setForgotBusy(true);
    setError('');
    try {
      await api.supervisorApp.forgotMpinVerify({
        identifier: forgotId.trim(),
        otp: otp.trim(),
        newMpin: newMpin.trim(),
      });
      setForgotMsg('mPIN reset successful! Please login with your new mPIN.');
      setTimeout(() => {
        setForgotOpen(false);
        setStep(1);
        setMpin('');
      }, 1500);
    } catch (err) {
      setError(err.message || 'mPIN reset failed');
    } finally {
      setForgotBusy(false);
    }
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <img src="/logo.png" alt="Udgam" style={{ height: 44, borderRadius: 8, marginBottom: 8 }} />
        <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--sup-primary)' }}>
          Udgam Supervisor App
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--sup-text-muted)', fontSize: '0.85rem' }}>
          Branch, Staff & Operations Management Portal
        </p>
      </div>

      <div className="sup-card" style={{ borderTop: '4px solid var(--sup-accent)' }}>
        {/* Tab selection */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--sup-border)', marginBottom: 16 }}>
          <button
            type="button"
            className="sup-btn secondary sm"
            style={{
              flex: 1,
              borderBottom: tab === 'phone' ? '2px solid var(--sup-primary)' : 'none',
              borderRadius: 0,
              fontWeight: tab === 'phone' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            onClick={() => { setTab('phone'); setIdentifier(''); setError(''); }}
          >
            <Icon name="phone" size={15} />
            <span>Mobile</span>
          </button>
          <button
            type="button"
            className="sup-btn secondary sm"
            style={{
              flex: 1,
              borderBottom: tab === 'code' ? '2px solid var(--sup-primary)' : 'none',
              borderRadius: 0,
              fontWeight: tab === 'code' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            onClick={() => { setTab('code'); setIdentifier(''); setError(''); }}
          >
            <Icon name="hash" size={15} />
            <span>Supervisor ID</span>
          </button>
          <button
            type="button"
            className="sup-btn secondary sm"
            style={{
              flex: 1,
              borderBottom: tab === 'email' ? '2px solid var(--sup-primary)' : 'none',
              borderRadius: 0,
              fontWeight: tab === 'email' ? 700 : 500,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            onClick={() => { setTab('email'); setIdentifier(''); setError(''); }}
          >
            <Icon name="mail" size={15} />
            <span>Email</span>
          </button>
        </div>

        {/* Quick Demo Credentials Box */}
        <div
          style={{
            background: 'rgba(15, 118, 110, 0.08)',
            border: '1px dashed var(--sup-primary)',
            borderRadius: 10,
            padding: '10px 12px',
            marginBottom: 16,
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: 'var(--sup-primary)' }}>Demo Supervisor Account:</div>
            <div style={{ color: 'var(--sup-text-muted)', marginTop: 2 }}>
              Mobile: <strong>9876543210</strong> &bull; mPIN: <strong>1234</strong>
            </div>
          </div>
          <button
            type="button"
            className="sup-btn sm"
            style={{ padding: '4px 10px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
            onClick={() => {
              setTab('phone');
              setIdentifier('9876543210');
              setMpin('1234');
              setError('');
            }}
          >
            Auto-Fill
          </button>
        </div>

        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              background: 'var(--sup-danger-light)',
              color: 'var(--sup-danger)',
              borderRadius: 8,
              fontSize: '0.85rem',
              marginBottom: 12,
            }}
          >
            <Icon name="alertcircle" size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="sup-input-group">
            <label className="sup-label">
              {tab === 'phone' ? '10-digit Mobile Number' : tab === 'code' ? 'Supervisor Staff Code (e.g. SUP001)' : 'Registered Email Address'}
            </label>
            <input
              type={tab === 'phone' ? 'tel' : tab === 'email' ? 'email' : 'text'}
              inputMode={tab === 'phone' ? 'numeric' : undefined}
              maxLength={tab === 'phone' ? 10 : tab === 'code' ? 20 : 60}
              pattern={tab === 'phone' ? '[0-9]{10}' : undefined}
              className="sup-input"
              required
              autoFocus
              placeholder={tab === 'phone' ? '9876543210' : tab === 'code' ? 'SUP001' : 'supervisor@udgam.com'}
              value={identifier}
              onChange={(e) => {
                if (tab === 'phone') {
                  setIdentifier(e.target.value.replace(/\D/g, '').slice(0, 10));
                } else if (tab === 'code') {
                  setIdentifier(e.target.value.toUpperCase().trim());
                } else {
                  setIdentifier(e.target.value);
                }
              }}
            />
          </div>

          <div className="sup-input-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="sup-label">Secret 4-digit mPIN</label>
              <button
                type="button"
                onClick={() => { setForgotOpen(true); setForgotId(identifier); }}
                style={{ background: 'none', border: 'none', color: 'var(--sup-primary)', fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}
              >
                Forgot mPIN?
              </button>
            </div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              pattern="[0-9]{4}"
              className="sup-input"
              required
              placeholder="••••"
              value={mpin}
              onChange={(e) => setMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </div>

          <button type="submit" className="sup-btn" disabled={busy} style={{ marginTop: 8 }}>
            {busy ? 'Logging in…' : 'Secure Supervisor Login'}
          </button>
        </form>

        <div style={{ marginTop: 18, textAlign: 'center', borderTop: '1px solid var(--sup-border)', paddingTop: 14 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--sup-text-muted)' }}>First time using supervisor app? </span>
          <Link to="/supervisor/register-mpin" style={{ fontSize: '0.85rem', color: 'var(--sup-primary)', fontWeight: 600, textDecoration: 'none' }}>
            Create mPIN
          </Link>
        </div>

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link
            to="/employee/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.82rem',
              color: 'var(--sup-text-muted)',
              textDecoration: 'none',
            }}
          >
            <Icon name="user" size={14} />
            <span>Switch to Field Officer App</span>
          </Link>
        </div>
      </div>

      {/* Forgot mPIN Modal */}
      {forgotOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--sup-card-bg)', width: '100%', maxWidth: 380, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1.1rem' }}>Reset Supervisor mPIN</strong>
              <button className="sup-icon-btn" onClick={() => setForgotOpen(false)} aria-label="Close">
                <Icon name="cross" size={16} />
              </button>
            </div>
            {forgotMsg && (
              <div style={{ padding: '8px 12px', background: 'var(--sup-primary-light)', color: 'var(--sup-primary)', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
                {forgotMsg}
              </div>
            )}
            {step === 1 ? (
              <form onSubmit={handleSendForgotOtp}>
                <div className="sup-input-group">
                  <label className="sup-label">Enter 10-digit Mobile or Code</label>
                  <input
                    className="sup-input"
                    required
                    value={forgotId}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (/^\d+$/.test(val)) {
                        setForgotId(val.replace(/\D/g, '').slice(0, 10));
                      } else {
                        setForgotId(val);
                      }
                    }}
                    placeholder="e.g. 9876543210 or SUP001"
                  />
                </div>
                <button type="submit" className="sup-btn" disabled={forgotBusy}>
                  {forgotBusy ? 'Sending OTP…' : 'Send OTP to Registered Phone'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetMpin}>
                <div className="sup-input-group">
                  <label className="sup-label">6-digit OTP</label>
                  <input
                    type="tel"
                    maxLength={6}
                    className="sup-input"
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
                <div className="sup-input-group">
                  <label className="sup-label">Set New 4-digit mPIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    className="sup-input"
                    required
                    placeholder="••••"
                    value={newMpin}
                    onChange={(e) => setNewMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </div>
                <button type="submit" className="sup-btn" disabled={forgotBusy}>
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


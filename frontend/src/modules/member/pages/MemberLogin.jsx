import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMemberApp } from '../MemberAppContext.jsx';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberLogin() {
  const { login } = useMemberApp();
  const navigate = useNavigate();

  // Login Mode: 'mpin' or 'otp'
  const [loginMode, setLoginMode] = useState('mpin');
  const [identifier, setIdentifier] = useState('');
  const [mpin, setMpin] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [maskedMobile, setMaskedMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Forgot mPIN modal
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [newMpin, setNewMpin] = useState('');
  const [step, setStep] = useState(1);
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);

  // mPIN Login
  async function handleMpinLogin(e) {
    e.preventDefault();
    setError('');

    const id = identifier.trim();
    if (!id) {
      setError('Please enter your Registered Mobile or Member Code');
      return;
    }
    if (!/^\d{4}$/.test(mpin)) {
      setError('Please enter your 4-digit secret mPIN');
      return;
    }

    setBusy(true);
    try {
      const res = await api.memberApp.login({ identifier: id, mpin });
      login(res.user, res.token);
      navigate('/member', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setBusy(false);
    }
  }

  // OTP Login: Step 1 - Send OTP
  async function handleSendLoginOtp(e) {
    e.preventDefault();
    setError('');

    const id = identifier.trim();
    if (!id) {
      setError('Please enter your registered mobile number or Member Code');
      return;
    }

    setBusy(true);
    try {
      const res = await api.memberApp.sendLoginOtp(id);
      setMaskedMobile(res.maskedMobile || id);
      setOtpSent(true);
      if (res.simulatedOtp) {
        setOtp(res.simulatedOtp);
      }
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setBusy(false);
    }
  }

  // OTP Login: Step 2 - Verify OTP & Login
  async function handleVerifyLoginOtp(e) {
    e.preventDefault();
    setError('');

    if (!otp || otp.trim().length < 4) {
      setError('Please enter a valid OTP');
      return;
    }

    setBusy(true);
    try {
      const res = await api.memberApp.verifyLoginOtp({
        identifier: identifier.trim(),
        otp: otp.trim(),
      });
      login(res.user, res.token);
      navigate('/member', { replace: true });
    } catch (err) {
      setError(err.message || 'OTP verification failed');
    } finally {
      setBusy(false);
    }
  }

  // Forgot mPIN handlers
  async function handleSendForgotOtp(e) {
    e.preventDefault();
    setForgotBusy(true);
    setForgotMsg('');
    setError('');
    try {
      const r = await api.memberApp.forgotMpinSendOtp(forgotId.trim());
      setForgotMsg(r.message || 'OTP sent successfully');
      if (r.simulatedOtp) setForgotOtp(r.simulatedOtp);
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
      setError('New mPIN must be exactly 4 digits');
      return;
    }
    setForgotBusy(true);
    setError('');
    try {
      await api.memberApp.forgotMpinVerify({
        identifier: forgotId.trim(),
        otp: forgotOtp.trim(),
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
        <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--mem-primary)' }}>
          Udgam Member App
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--mem-text-muted)', fontSize: '0.85rem' }}>
          Customer &amp; Borrower Digital Passbook
        </p>
      </div>

      <div className="mem-card" style={{ borderTop: '4px solid var(--mem-accent)' }}>
        {/* Quick Demo Credentials Box */}
        <div
          style={{
            background: 'var(--mem-primary-light)',
            border: '1px dashed var(--mem-primary)',
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
            <div style={{ fontWeight: 700, color: 'var(--mem-primary)' }}>Demo Customer Account:</div>
            <div style={{ color: 'var(--mem-text-muted)', marginTop: 2 }}>
              Mobile: <strong>9876501234</strong> &bull; mPIN: <strong>1234</strong>
            </div>
          </div>
          <button
            type="button"
            className="mem-btn sm"
            style={{ padding: '4px 10px', fontSize: '0.75rem', width: 'auto', whiteSpace: 'nowrap' }}
            onClick={() => {
              setLoginMode('mpin');
              setIdentifier('9876501234');
              setMpin('1234');
              setError('');
            }}
          >
            Auto-Fill
          </button>
        </div>

        {/* Mode Switcher: mPIN vs OTP Login */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--mem-border)', marginBottom: 16 }}>
          <button
            type="button"
            className="mem-btn secondary sm"
            style={{
              flex: 1,
              borderBottom: loginMode === 'mpin' ? '2.5px solid var(--mem-primary)' : 'none',
              borderRadius: 0,
              fontWeight: loginMode === 'mpin' ? 700 : 500,
              color: loginMode === 'mpin' ? 'var(--mem-primary)' : 'var(--mem-text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            onClick={() => { setLoginMode('mpin'); setError(''); setOtpSent(false); }}
          >
            <Icon name="lock" size={15} />
            <span>Login with mPIN</span>
          </button>

          <button
            type="button"
            className="mem-btn secondary sm"
            style={{
              flex: 1,
              borderBottom: loginMode === 'otp' ? '2.5px solid var(--mem-primary)' : 'none',
              borderRadius: 0,
              fontWeight: loginMode === 'otp' ? 700 : 500,
              color: loginMode === 'otp' ? 'var(--mem-primary)' : 'var(--mem-text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            onClick={() => { setLoginMode('otp'); setError(''); setOtpSent(false); }}
          >
            <Icon name="phone" size={15} />
            <span>Login with OTP</span>
          </button>
        </div>

        {error && (
          <div className="mem-alert danger">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Mode 1: mPIN Login Form */}
        {loginMode === 'mpin' && (
          <form onSubmit={handleMpinLogin}>
            <div className="mem-input-group">
              <label className="mem-label">Registered Mobile or Member Code</label>
              <input
                type="text"
                className="mem-input"
                required
                placeholder="e.g. 9876501234 or MEM001"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>

            <div className="mem-input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label className="mem-label" style={{ margin: 0 }}>4-Digit Secret mPIN</label>
                <button
                  type="button"
                  onClick={() => { setForgotOpen(true); setForgotId(identifier); }}
                  style={{ background: 'none', border: 'none', color: 'var(--mem-primary)', fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}
                >
                  Forgot mPIN?
                </button>
              </div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                className="mem-input"
                required
                placeholder="••••"
                value={mpin}
                onChange={(e) => setMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>

            <button type="submit" className="mem-btn" disabled={busy} style={{ marginTop: 8 }}>
              <Icon name="lock" size={16} />
              <span>{busy ? 'Logging in…' : 'Secure Login'}</span>
            </button>
          </form>
        )}

        {/* Mode 2: OTP Login Form */}
        {loginMode === 'otp' && (
          <div>
            {!otpSent ? (
              <form onSubmit={handleSendLoginOtp}>
                <div className="mem-input-group">
                  <label className="mem-label">Registered Mobile or Member Code</label>
                  <input
                    type="text"
                    className="mem-input"
                    required
                    placeholder="e.g. 9876501234 or MEM001"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                  />
                </div>
                <button type="submit" className="mem-btn" disabled={busy} style={{ marginTop: 8 }}>
                  <Icon name="phone" size={16} />
                  <span>{busy ? 'Sending OTP…' : 'Send Verification OTP'}</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyLoginOtp}>
                <div style={{ background: 'var(--mem-primary-light)', padding: 10, borderRadius: 10, marginBottom: 14, fontSize: '0.82rem', color: 'var(--mem-primary)' }}>
                  OTP sent to <strong>{maskedMobile}</strong>
                </div>

                <div className="mem-input-group">
                  <label className="mem-label">Enter 6-Digit OTP</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={6}
                    className="mem-input"
                    required
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>

                <button type="submit" className="mem-btn" disabled={busy} style={{ marginTop: 8 }}>
                  <Icon name="checkcircle" size={16} />
                  <span>{busy ? 'Verifying…' : 'Verify & Enter Portal'}</span>
                </button>

                <div style={{ textAlign: 'center', marginTop: 10 }}>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--mem-text-muted)', fontSize: '0.78rem', cursor: 'pointer' }}
                    onClick={() => setOtpSent(false)}
                  >
                    Change Number / Resend
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        <div style={{ marginTop: 18, textAlign: 'center', borderTop: '1px solid var(--mem-border)', paddingTop: 14 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--mem-text-muted)' }}>First time using Member App? </span>
          <Link to="/member/register-mpin" style={{ fontSize: '0.85rem', color: 'var(--mem-primary)', fontWeight: 700, textDecoration: 'none' }}>
            Set Your mPIN
          </Link>
        </div>

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link
            to="/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.8rem',
              color: 'var(--mem-text-muted)',
              textDecoration: 'none'
            }}
          >
            <Icon name="desktop" size={14} />
            <span>Go to Staff / Branch Portal</span>
          </Link>
        </div>
      </div>

      {/* Forgot mPIN Modal */}
      {forgotOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--mem-card-bg)', width: '100%', maxWidth: 380, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1.05rem', color: 'var(--mem-text)' }}>Reset Secret mPIN</strong>
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--mem-text-muted)', cursor: 'pointer' }}
              >
                <Icon name="cross" size={16} />
              </button>
            </div>

            {forgotMsg && (
              <div className="mem-alert success">
                <span>{forgotMsg}</span>
              </div>
            )}

            {step === 1 ? (
              <form onSubmit={handleSendForgotOtp}>
                <div className="mem-input-group">
                  <label className="mem-label">Enter Registered Mobile or Member Code</label>
                  <input
                    className="mem-input"
                    required
                    value={forgotId}
                    onChange={(e) => setForgotId(e.target.value)}
                    placeholder="e.g. 9876501234 or MEM001"
                  />
                </div>
                <button type="submit" className="mem-btn" disabled={forgotBusy}>
                  {forgotBusy ? 'Sending OTP…' : 'Send Verification OTP'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetMpin}>
                <div className="mem-input-group">
                  <label className="mem-label">OTP</label>
                  <input
                    type="tel"
                    maxLength={6}
                    className="mem-input"
                    required
                    value={forgotOtp}
                    onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
                <div className="mem-input-group">
                  <label className="mem-label">Set New 4-digit mPIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    className="mem-input"
                    required
                    placeholder="••••"
                    value={newMpin}
                    onChange={(e) => setNewMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </div>
                <button type="submit" className="mem-btn" disabled={forgotBusy}>
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

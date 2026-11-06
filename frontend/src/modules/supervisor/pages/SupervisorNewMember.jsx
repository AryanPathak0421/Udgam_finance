import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorNewMember() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [otp, setOtp] = useState('');
  const [verifiedToken, setVerifiedToken] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSendOtp(e) {
    e.preventDefault();
    if (!/^\d{10}$/.test(mobile)) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.supervisorApp.sendMemberOtp(mobile);
      setOtpSent(true);
      setSuccess(res.message || 'OTP sent successfully to member mobile');
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.supervisorApp.verifyMemberOtp({ mobile, otp });
      setVerifiedToken(res.token || 'verified');
      setSuccess('Mobile verified successfully!');
    } catch (err) {
      setError(err.message || 'Invalid OTP');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Member name is required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.supervisorApp.registerMember(
        {
          name: name.trim(),
          mobile: mobile.trim(),
          aadhaar: aadhaar.trim(),
        },
        verifiedToken
      );
      setSuccess('Member onboarded successfully!');
      setTimeout(() => navigate('/supervisor/new-member-report'), 1200);
    } catch (err) {
      setError(err.message || 'Failed to register member');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>New Member Onboarding</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Supervisor Member Registration</div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-success-light)', color: 'var(--sup-success)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
        {!otpSent ? (
          <form onSubmit={handleSendOtp}>
            <div className="sup-input-group">
              <label className="sup-label">Member Mobile Number</label>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                required
                className="sup-input"
                placeholder="10-digit mobile number"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
            </div>
            <button type="submit" className="sup-btn" disabled={busy}>
              {busy ? 'Sending OTP…' : 'Send Mobile Verification OTP'}
            </button>
          </form>
        ) : !verifiedToken ? (
          <form onSubmit={handleVerifyOtp}>
            <div className="sup-input-group">
              <label className="sup-label">Enter 6-digit OTP sent to {mobile}</label>
              <input
                type="tel"
                maxLength={6}
                required
                className="sup-input"
                placeholder="6-digit OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </div>
            <button type="submit" className="sup-btn" disabled={busy}>
              {busy ? 'Verifying…' : 'Verify Mobile OTP'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="sup-input-group">
              <label className="sup-label">Full Name (As per Aadhaar)</label>
              <input
                type="text"
                required
                className="sup-input"
                placeholder="e.g. Sunita Devi"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Aadhaar Number (12 Digits)</label>
              <input
                type="tel"
                maxLength={12}
                className="sup-input"
                placeholder="•••• •••• ••••"
                value={aadhaar}
                onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))}
              />
            </div>

            <button type="submit" className="sup-btn" disabled={busy} style={{ marginTop: 8 }}>
              {busy ? 'Registering…' : 'Complete Member Registration'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}


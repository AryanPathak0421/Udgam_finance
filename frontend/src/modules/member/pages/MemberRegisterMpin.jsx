import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberRegisterMpin() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [memberInfo, setMemberInfo] = useState(null);
  const [mpin, setMpin] = useState('');
  const [confirmMpin, setConfirmMpin] = useState('');
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleLookup(e) {
    e.preventDefault();
    setError('');
    const id = identifier.trim();
    if (!id) {
      setError('Please enter your 10-digit mobile number or Member Code');
      return;
    }

    setBusy(true);
    try {
      const res = await api.memberApp.lookup(id);
      setMemberInfo(res);
      setStep(2);
    } catch (err) {
      setError(err.message || 'Member record not found in system. Please contact your branch.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetMpin(e) {
    e.preventDefault();
    setError('');

    if (!/^\d{4}$/.test(mpin)) {
      setError('Secret mPIN must be exactly 4 numeric digits');
      return;
    }
    if (mpin !== confirmMpin) {
      setError('mPIN and Confirm mPIN do not match');
      return;
    }

    setBusy(true);
    try {
      await api.memberApp.createMpin({
        identifier: memberInfo.memberCode || identifier.trim(),
        mpin,
      });
      setSuccess('Secret mPIN created successfully! Redirecting to login…');
      setTimeout(() => {
        navigate('/member/login', { replace: true });
      }, 1500);
    } catch (err) {
      setError(err.message || 'Failed to create mPIN');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <img src="/logo.png" alt="Udgam" style={{ height: 44, borderRadius: 8, marginBottom: 8 }} />
        <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--mem-primary)' }}>
          Set Member mPIN
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--mem-text-muted)', fontSize: '0.85rem' }}>
          Quick 2-step setup for online account access
        </p>
      </div>

      <div className="mem-card">
        {error && (
          <div className="mem-alert danger">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mem-alert success">
            <Icon name="checkcircle" size={16} />
            <span>{success}</span>
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleLookup}>
            <div className="mem-input-group">
              <label className="mem-label">Enter Registered Mobile or Member Code</label>
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
              {busy ? 'Verifying Member…' : 'Find My Account'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSetMpin}>
            <div style={{ background: 'var(--mem-primary-light)', padding: 12, borderRadius: 12, marginBottom: 16 }}>
              <div style={{ fontWeight: 800, color: 'var(--mem-primary)', fontSize: '0.92rem' }}>
                {memberInfo.name}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--mem-text-muted)', marginTop: 2 }}>
                Member Code: <strong>{memberInfo.memberCode}</strong> &bull; {memberInfo.branch?.name} Branch
              </div>
            </div>

            <div className="mem-input-group">
              <label className="mem-label">Create 4-Digit Secret mPIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                className="mem-input"
                required
                placeholder="••••"
                value={mpin}
                onChange={(e) => setMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>

            <div className="mem-input-group">
              <label className="mem-label">Confirm Secret mPIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                className="mem-input"
                required
                placeholder="••••"
                value={confirmMpin}
                onChange={(e) => setConfirmMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>

            <button type="submit" className="mem-btn" disabled={busy} style={{ marginTop: 8 }}>
              {busy ? 'Saving mPIN…' : 'Save & Activate mPIN'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 18, textAlign: 'center', borderTop: '1px solid var(--mem-border)', paddingTop: 14 }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--mem-text-muted)' }}>Already have an mPIN? </span>
          <Link to="/member/login" style={{ fontSize: '0.85rem', color: 'var(--mem-primary)', fontWeight: 700, textDecoration: 'none' }}>
            Login Here
          </Link>
        </div>
      </div>
    </div>
  );
}

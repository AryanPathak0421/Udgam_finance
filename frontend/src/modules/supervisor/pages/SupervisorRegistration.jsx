import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorRegistration() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('phone'); // 'phone' | 'code' | 'email'
  const [identifier, setIdentifier] = useState('');
  const [foundSup, setFoundSup] = useState(null);
  const [mpin, setMpin] = useState('');
  const [confirmMpin, setConfirmMpin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleLookup(e) {
    e.preventDefault();
    setError('');
    setFoundSup(null);

    const val = identifier.trim();
    if (!val) {
      setError('Please enter your supervisor account details');
      return;
    }

    if (tab === 'phone') {
      if (!/^\d{10}$/.test(val)) {
        setError('Please enter a valid 10-digit mobile number');
        return;
      }
    } else if (tab === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        setError('Please enter a valid email address');
        return;
      }
    } else if (tab === 'code') {
      if (val.length < 3) {
        setError('Please enter a valid Supervisor Staff Code');
        return;
      }
    }

    setBusy(true);
    try {
      const r = await api.supervisorApp.lookup(val);
      setFoundSup(r);
    } catch (err) {
      setError(err.message || 'Supervisor account not found');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateMpin(e) {
    e.preventDefault();
    if (!/^\d{4}$/.test(mpin)) {
      setError('Secret mPIN must be exactly 4 numeric digits');
      return;
    }
    if (mpin !== confirmMpin) {
      setError('mPIN and Confirm mPIN do not match');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.supervisorApp.createMpin({ employeeCode: foundSup.employeeCode, mpin });
      setSuccess('Supervisor mPIN created successfully! Redirecting to login…');
      setTimeout(() => navigate('/supervisor/login'), 1500);
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
        <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--sup-primary)' }}>
          Create Supervisor mPIN
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--sup-text-muted)', fontSize: '0.85rem' }}>
          Verify your supervisor staff account and set a secure 4-digit mPIN
        </p>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-success-light)', color: 'var(--sup-success)', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      {!foundSup ? (
        <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
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

          <form onSubmit={handleLookup}>
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
                autoFocus
                required
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
            <button type="submit" className="sup-btn" disabled={busy}>
              {busy ? 'Verifying Supervisor…' : 'Find Supervisor Account'}
            </button>
          </form>
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <Link to="/supervisor/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: 'var(--sup-primary)', textDecoration: 'none', fontWeight: 600 }}>
              <Icon name="arrowleft" size={14} />
              <span>Back to Login</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
          {/* Supervisor Card Preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 14, borderBottom: '1px solid var(--sup-border)', marginBottom: 14 }}>
            {foundSup.photo ? (
              <img src={foundSup.photo} alt={foundSup.name} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--sup-primary)' }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--sup-primary-light)', color: 'var(--sup-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="shield" size={28} />
              </div>
            )}
            <div>
              <strong style={{ fontSize: '1.05rem', display: 'block', color: 'var(--sup-text)' }}>{foundSup.name}</strong>
              <div style={{ fontSize: '0.82rem', color: 'var(--sup-text-muted)' }}>Code: {foundSup.employeeCode}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--sup-primary)', fontWeight: 600 }}>Branch: {foundSup.branch?.name || foundSup.branch?.code || 'Assigned Branch'}</div>
            </div>
          </div>

          <form onSubmit={handleCreateMpin}>
            <div className="sup-input-group">
              <label className="sup-label">Set 4-digit mPIN</label>
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

            <div className="sup-input-group">
              <label className="sup-label">Confirm 4-digit mPIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                className="sup-input"
                required
                placeholder="••••"
                value={confirmMpin}
                onChange={(e) => setConfirmMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>

            <button type="submit" className="sup-btn" disabled={busy} style={{ marginTop: 8 }}>
              {busy ? 'Setting mPIN…' : 'Save Supervisor mPIN'}
            </button>
            <button type="button" className="sup-btn secondary sm" style={{ marginTop: 8, width: '100%' }} onClick={() => setFoundSup(null)}>
              Change Account
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

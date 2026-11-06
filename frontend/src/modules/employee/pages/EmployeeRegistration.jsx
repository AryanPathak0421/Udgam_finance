import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeRegistration() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('phone'); // 'phone' | 'code' | 'email'
  const [identifier, setIdentifier] = useState('');
  const [foundEmp, setFoundEmp] = useState(null);
  const [mpin, setMpin] = useState('');
  const [confirmMpin, setConfirmMpin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleLookup(e) {
    e.preventDefault();
    setError('');
    setFoundEmp(null);

    const val = identifier.trim();
    if (!val) {
      setError('Please enter your account details');
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
        setError('Please enter a valid Employee Code');
        return;
      }
    }

    setBusy(true);
    try {
      const r = await api.employeeApp.lookup(val);
      setFoundEmp(r);
    } catch (err) {
      setError(err.message || 'Employee not found');
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
      await api.employeeApp.createMpin({ employeeCode: foundEmp.employeeCode, mpin });
      setSuccess('mPIN created successfully! Redirecting to login…');
      setTimeout(() => navigate('/employee/login'), 1500);
    } catch (err) {
      setError(err.message || 'Failed to create mPIN');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <img src="/logo.png" alt="Udgam" style={{ height: 40, borderRadius: 8, marginBottom: 8 }} />
        <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>Create Employee mPIN</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>
          Verify your staff account and set a secure 4-digit mPIN
        </p>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--emp-danger-light)', color: 'var(--emp-danger)', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--emp-success-light)', color: 'var(--emp-success)', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      {!foundEmp ? (
        <div className="emp-card" style={{ borderTop: '4px solid var(--emp-primary)' }}>
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

          <form onSubmit={handleLookup}>
            <div className="emp-input-group">
              <label className="emp-label">
                {tab === 'phone' ? '10-digit Mobile Number' : tab === 'code' ? 'Employee Code (e.g. EMP001)' : 'Registered Email Address'}
              </label>
              <input
                type={tab === 'phone' ? 'tel' : tab === 'email' ? 'email' : 'text'}
                inputMode={tab === 'phone' ? 'numeric' : undefined}
                maxLength={tab === 'phone' ? 10 : tab === 'code' ? 20 : 60}
                pattern={tab === 'phone' ? '[0-9]{10}' : undefined}
                className="emp-input"
                autoFocus
                required
                placeholder={tab === 'phone' ? '9876543210' : tab === 'code' ? 'EMP001' : 'staff@udgam.com'}
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
            <button type="submit" className="emp-btn" disabled={busy}>
              {busy ? 'Verifying…' : 'Find My Account'}
            </button>
          </form>
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <Link to="/employee/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: 'var(--emp-primary)', textDecoration: 'none', fontWeight: 600 }}>
              <Icon name="arrowleft" size={14} />
              <span>Back to Login</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="emp-card" style={{ borderTop: '4px solid var(--emp-primary)' }}>
          {/* Employee Card Preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 14, borderBottom: '1px solid var(--emp-border)', marginBottom: 14 }}>
            {foundEmp.photo ? (
              <img src={foundEmp.photo} alt={foundEmp.name} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--emp-primary)' }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--emp-primary-light)', color: 'var(--emp-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="user" size={28} />
              </div>
            )}
            <div>
              <strong style={{ fontSize: '1.05rem', display: 'block', color: 'var(--emp-text)' }}>{foundEmp.name}</strong>
              <div style={{ fontSize: '0.82rem', color: 'var(--emp-text-muted)' }}>Code: {foundEmp.employeeCode}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--emp-primary)', fontWeight: 600 }}>Branch: {foundEmp.branch?.name || foundEmp.branch?.code || 'Assigned Branch'}</div>
            </div>
          </div>

          <form onSubmit={handleCreateMpin}>
            <div className="emp-input-group">
              <label className="emp-label">Set 4-digit mPIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                className="emp-input"
                required
                placeholder="••••"
                value={mpin}
                onChange={(e) => setMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>

            <div className="emp-input-group">
              <label className="emp-label">Confirm 4-digit mPIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]{4}"
                className="emp-input"
                required
                placeholder="••••"
                value={confirmMpin}
                onChange={(e) => setConfirmMpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>

            <button type="submit" className="emp-btn" disabled={busy} style={{ marginTop: 8 }}>
              {busy ? 'Setting mPIN…' : 'Save mPIN & Continue'}
            </button>
            <button type="button" className="emp-btn secondary sm" style={{ marginTop: 8, width: '100%' }} onClick={() => setFoundEmp(null)}>
              Change Account
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

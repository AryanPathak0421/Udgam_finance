import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberApplyLoan() {
  const [loanType, setLoanType] = useState('personal');
  const [requestedAmount, setRequestedAmount] = useState('25000');
  const [purpose, setPurpose] = useState('');
  const [tenureMonths, setTenureMonths] = useState('12');
  const [gstNumber, setGstNumber] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [gstVerified, setGstVerified] = useState(false);
  const [verifyingGst, setVerifyingGst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [requisitions, setRequisitions] = useState([]);
  const [loadingReqs, setLoadingReqs] = useState(false);
  const [civilFee, setCivilFee] = useState(40);

  const PRESETS = [10000, 25000, 40000, 50000, 75000, 100000];

  useEffect(() => {
    loadPastRequisitions();
  }, []);

  async function loadPastRequisitions() {
    setLoadingReqs(true);
    try {
      const res = await api.memberApp.requisitions();
      setRequisitions(res.requisitions || []);
      if (res.civilFee != null) setCivilFee(res.civilFee);
    } catch (err) {
      // non-fatal
    } finally {
      setLoadingReqs(false);
    }
  }

  const handleVerifyGst = async () => {
    const cleanGst = (gstNumber || '').trim().toUpperCase();
    if (!cleanGst || cleanGst.length !== 15) {
      setError('Please enter a valid 15-character GSTIN');
      return;
    }
    setVerifyingGst(true);
    setError('');
    try {
      const res = await api.verify.gst(cleanGst);
      if (res.success || res.status === 'ACTIVE' || res.status === 'VERIFIED') {
        setGstVerified(true);
        if (res.data?.businessName && !businessName) {
          setBusinessName(res.data.businessName);
        }
        setSuccess(`✓ GST Verified: ${res.data?.businessName || cleanGst}`);
      } else {
        setError(res.message || 'GSTIN verification failed or inactive');
      }
    } catch (err) {
      setError(err.message || 'GST verification error');
    } finally {
      setVerifyingGst(false);
    }
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    const amt = Number(requestedAmount);
    if (!amt || amt < 1000) {
      setError('Please enter a valid amount (minimum ₹1,000)');
      return;
    }
    if (!purpose.trim()) {
      setError('Please mention the purpose of the loan');
      return;
    }

    setBusy(true);
    try {
      const res = await api.memberApp.applyLoan({
        loanType,
        requestedAmount: amt,
        purpose: purpose.trim(),
        tenureMonths: Number(tenureMonths),
        gstNumber: loanType === 'business' ? gstNumber.trim().toUpperCase() : undefined,
        businessName: loanType === 'business' ? businessName.trim() : undefined,
      });

      setSuccess(res.message || 'Loan request submitted successfully! Awaiting branch approval.');
      setPurpose('');
      setGstNumber('');
      setBusinessName('');
      setGstVerified(false);
      await loadPastRequisitions();
    } catch (err) {
      setError(err.message || 'Failed to submit loan request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link
        to="/member"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--mem-primary)',
          textDecoration: 'none',
          fontSize: '0.82rem',
          fontWeight: 700,
          marginBottom: 12,
        }}
      >
        &larr; Back to Dashboard
      </Link>

      <div className="mem-card" style={{ borderTop: '4px solid var(--mem-accent)' }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 4px', color: 'var(--mem-text)' }}>
          Loan Requisition (Loan Apply)
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--mem-text-muted)' }}>
          Submit an instant digital requisition directly to your branch manager.
        </p>

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

        {/* Civil Check Fee Card */}
        <div
          style={{
            background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
            border: '1px solid #86efac',
            borderRadius: 12,
            padding: '12px 14px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: '#059669',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Icon name="shield" size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#065f46' }}>
                Civil Check Fee: ₹{civilFee}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#047857' }}>
                Credit bureau civil check fee applied automatically with this loan request.
              </div>
            </div>
          </div>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 800,
              background: '#059669',
              color: '#ffffff',
              padding: '4px 10px',
              borderRadius: 20,
              whiteSpace: 'nowrap',
            }}
          >
            ₹{civilFee} Applied
          </span>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Loan Type */}
          <div className="mem-input-group">
            <label className="mem-label">Select Loan Type</label>
            <select
              className="mem-select"
              value={loanType}
              onChange={(e) => setLoanType(e.target.value)}
            >
              <option value="personal">Personal / Mahila Kalyan Loan</option>
              <option value="business">Business / MSME Expansion Loan</option>
              <option value="group">JLG Group Micro Loan</option>
              <option value="product">Product / Asset Purchase Loan</option>
            </select>
          </div>

          {/* Business GSTIN Verification Block */}
          {loanType === 'business' && (
            <div style={{ background: '#f8fafc', border: '1px solid var(--mem-border)', borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label className="mem-label" style={{ margin: 0, fontWeight: 700, color: 'var(--mem-text)' }}>
                  Business GSTIN (Fast-Track Approval)
                </label>
                {gstVerified && (
                  <span style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 800 }}>
                    ✓ GST Active
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input
                  type="text"
                  maxLength={15}
                  className="mem-input"
                  placeholder="15-digit GSTIN (e.g. 27ABCDE1234F1Z5)"
                  value={gstNumber}
                  onChange={(e) => {
                    setGstVerified(false);
                    setGstNumber(e.target.value.toUpperCase());
                  }}
                  style={{ flex: 1, borderColor: gstVerified ? '#10b981' : undefined }}
                />
                <button
                  type="button"
                  className="mem-btn sm"
                  style={{
                    width: 'auto',
                    padding: '6px 12px',
                    fontSize: '0.75rem',
                    whiteSpace: 'nowrap',
                    background: gstVerified ? '#dcfce7' : undefined,
                    color: gstVerified ? '#166534' : undefined,
                    border: gstVerified ? '1px solid #86efac' : undefined,
                  }}
                  disabled={verifyingGst || gstNumber.length !== 15}
                  onClick={handleVerifyGst}
                >
                  {verifyingGst ? 'Verifying…' : gstVerified ? '✓ Verified' : 'Verify GST'}
                </button>
              </div>

              {businessName && (
                <div style={{ marginTop: 8 }}>
                  <label className="mem-label" style={{ fontSize: '0.74rem' }}>Registered Trade / Business Name</label>
                  <input
                    type="text"
                    className="mem-input"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Business Name"
                  />
                </div>
              )}
            </div>
          )}

          {/* Amount input + Quick Presets */}
          <div className="mem-input-group">
            <label className="mem-label">Requested Loan Amount (₹)</label>
            <input
              type="number"
              min="1000"
              step="1000"
              className="mem-input"
              required
              value={requestedAmount}
              onChange={(e) => setRequestedAmount(e.target.value)}
              placeholder="e.g. 25000"
            />
            {/* Quick preset buttons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  style={{
                    background: Number(requestedAmount) === p ? 'var(--mem-primary)' : 'rgba(5, 150, 105, 0.08)',
                    color: Number(requestedAmount) === p ? '#ffffff' : 'var(--mem-primary)',
                    border: '1px solid var(--mem-primary)',
                    borderRadius: 8,
                    padding: '4px 8px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  onClick={() => setRequestedAmount(String(p))}
                >
                  ₹{(p / 1000)}k
                </button>
              ))}
            </div>
          </div>

          {/* Preferred Tenure */}
          <div className="mem-input-group">
            <label className="mem-label">Preferred Repayment Period</label>
            <select
              className="mem-select"
              value={tenureMonths}
              onChange={(e) => setTenureMonths(e.target.value)}
            >
              <option value="6">6 Months (26 Weeks)</option>
              <option value="12">12 Months (52 Weeks)</option>
              <option value="18">18 Months</option>
              <option value="24">24 Months</option>
            </select>
          </div>

          {/* Purpose */}
          <div className="mem-input-group">
            <label className="mem-label">Loan Purpose / Reason</label>
            <textarea
              className="mem-textarea"
              rows={3}
              required
              placeholder="e.g. Purchase of dairy cattle, expansion of grocery shop inventory, agricultural seeds..."
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </div>

          <button type="submit" className="mem-btn" disabled={busy} style={{ marginTop: 8 }}>
            <Icon name="checkcircle" size={16} />
            <span>{busy ? 'Submitting Application…' : 'Submit Loan Requisition'}</span>
          </button>
        </form>
      </div>

      {/* Loan Approval Report Notification / Status List */}
      <div className="mem-card" style={{ marginTop: 14 }}>
        <div className="mem-card-title">
          <span>Loan Approval Status Reports ({requisitions.length})</span>
        </div>

        {loadingReqs ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--mem-text-muted)' }}>
            <Icon name="loader" size={20} className="spin" />
            <p style={{ marginTop: 4, fontSize: '0.78rem' }}>Loading applications…</p>
          </div>
        ) : requisitions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--mem-text-muted)', fontSize: '0.82rem' }}>
            No past loan requisitions submitted.
          </div>
        ) : (
          <div>
            {requisitions.map((r) => {
              const st = r.status?.toLowerCase() || 'pending';
              const badgeClass = st === 'approved' ? 'completed' : st === 'rejected' ? 'rejected' : 'pending';
              return (
                <div key={r.id || r._id} className="mem-stat-row">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
                      Requisition #{r.requisitionNo || r.code || 'REQ'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>
                      ₹{((r.appliedAmountPaise || r.requestedAmountPaise || 0) / 100).toLocaleString('en-IN')} &bull; Civil Fee: ₹{r.civilFee != null ? r.civilFee : civilFee} &bull; {new Date(r.date || r.createdAt).toLocaleDateString('en-IN')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={`mem-badge ${badgeClass}`} style={{ textTransform: 'capitalize' }}>
                      {r.status || 'Pending'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

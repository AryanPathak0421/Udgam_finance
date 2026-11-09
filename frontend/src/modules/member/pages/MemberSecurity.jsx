import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberSecurity() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Withdrawal form state
  const [showForm, setShowForm] = useState(false);
  const [requestType, setRequestType] = useState('bank_refund');
  const [amountRupees, setAmountRupees] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadSecurity();
  }, []);

  async function loadSecurity() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.securitySummary();
      setData(res);
      if (res.member?.bankDetails) {
        setBankAccount(res.member.bankDetails.accountNumber || '');
        setBankIfsc(res.member.bankDetails.ifsc || '');
        setBankName(res.member.bankDetails.bankName || '');
      }
    } catch (err) {
      setError(err.message || 'Failed to load security details');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitWithdrawal(e) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const amt = parseFloat(amountRupees);
    if (!amt || amt <= 0) {
      setError('Please enter a valid withdrawal amount');
      return;
    }

    const availablePaise = data?.security?.availableBalancePaise || 0;
    if (Math.round(amt * 100) > availablePaise) {
      setError(`Withdrawal amount cannot exceed available balance of ₹${(availablePaise / 100).toLocaleString('en-IN')}`);
      return;
    }

    if (requestType === 'bank_refund' && (!bankAccount.trim() || !bankIfsc.trim())) {
      setError('Please provide Bank Account Number and IFSC for direct refund');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.memberApp.requestSecurityWithdrawal({
        amountPaise: Math.round(amt * 100),
        requestType,
        bankDetails: {
          accountNumber: bankAccount.trim(),
          ifsc: bankIfsc.trim().toUpperCase(),
          bankName: bankName.trim(),
        },
        reason: reason.trim(),
      });
      setSuccessMsg(res.message || 'Security withdrawal request submitted successfully! Pending branch approval.');
      setShowForm(false);
      setAmountRupees('');
      setReason('');
      await loadSecurity();
    } catch (err) {
      setError(err.message || 'Failed to submit withdrawal request');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--mem-text-muted)' }}>
        <Icon name="loader" size={26} className="spin" />
        <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Loading security balance & interest…</p>
      </div>
    );
  }

  const sec = data?.security || {};
  const principal = (sec.netPrincipalPaise || 0) / 100;
  const interest = (sec.totalInterestPaise || 0) / 100;
  const totalBalance = (sec.availableBalancePaise || 0) / 100;
  const deposits = sec.deposits || [];
  const withdrawals = sec.withdrawals || [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0 }}>Security & 10% Interest</h2>
        <span className="mem-badge active">Safe Custody</span>
      </div>

      {error && (
        <div className="mem-alert danger">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="mem-alert success">
          <Icon name="checkcircle" size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Security Balance Card */}
      <div
        className="mem-card"
        style={{
          background: 'linear-gradient(135deg, #059669, #065f46)',
          color: '#ffffff',
          borderRadius: 18,
          padding: '20px',
          boxShadow: '0 8px 24px rgba(5, 150, 105, 0.25)',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Total Security Balance
          </span>
          <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.25)', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
            10% Annual Return
          </span>
        </div>

        <div style={{ fontSize: '1.9rem', fontWeight: 900, marginTop: 4 }}>
          ₹{totalBalance.toLocaleString('en-IN')}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
          <div>
            <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Principal Deposit</div>
            <div style={{ fontSize: '1rem', fontWeight: 800 }}>₹{principal.toLocaleString('en-IN')}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Accrued 10% Interest</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#fef08a' }}>
              + ₹{interest.toLocaleString('en-IN')}
            </div>
          </div>
        </div>
      </div>

      {/* Request Withdrawal Action Trigger */}
      <div style={{ marginBottom: 16 }}>
        {!showForm ? (
          <button
            type="button"
            className="mem-btn"
            onClick={() => setShowForm(true)}
            disabled={totalBalance <= 0}
          >
            <Icon name="dollar" size={18} />
            <span>Request Security Withdrawal / Refund</span>
          </button>
        ) : (
          <div className="mem-card" style={{ borderTop: '4px solid var(--mem-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 800, fontSize: '0.96rem' }}>Security Withdrawal Form</span>
              <button
                type="button"
                className="mem-btn sm secondary"
                style={{ width: 'auto', padding: '2px 8px', fontSize: '0.72rem' }}
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSubmitWithdrawal}>
              <div className="mem-input-group">
                <label className="mem-label">Refund Option *</label>
                <select
                  className="mem-select"
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value)}
                >
                  <option value="bank_refund">Direct Bank Transfer Refund</option>
                  <option value="adjust_emi">Adjust against Next Loan EMI</option>
                </select>
              </div>

              <div className="mem-input-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="mem-label">Amount to Withdraw (₹) *</label>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: 'var(--mem-primary)', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
                    onClick={() => setAmountRupees(totalBalance.toString())}
                  >
                    Withdraw All (₹{totalBalance.toLocaleString('en-IN')})
                  </button>
                </div>
                <input
                  type="number"
                  className="mem-input"
                  placeholder="e.g. 500"
                  value={amountRupees}
                  onChange={(e) => setAmountRupees(e.target.value)}
                  max={totalBalance}
                  min="1"
                  required
                />
              </div>

              {requestType === 'bank_refund' && (
                <>
                  <div className="mem-input-group">
                    <label className="mem-label">Bank Account Number *</label>
                    <input
                      type="text"
                      className="mem-input"
                      placeholder="Account Number"
                      value={bankAccount}
                      onChange={(e) => setBankAccount(e.target.value)}
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    <div className="mem-input-group">
                      <label className="mem-label">IFSC Code *</label>
                      <input
                        type="text"
                        className="mem-input"
                        placeholder="e.g. SBIN0001234"
                        value={bankIfsc}
                        onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                        required
                      />
                    </div>
                    <div className="mem-input-group">
                      <label className="mem-label">Bank Name</label>
                      <input
                        type="text"
                        className="mem-input"
                        placeholder="e.g. State Bank of India"
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="mem-input-group">
                <label className="mem-label">Reason for Withdrawal (Optional)</label>
                <input
                  type="text"
                  className="mem-input"
                  placeholder="e.g. Loan closed, requesting security release"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              <button type="submit" className="mem-btn" disabled={submitting}>
                {submitting ? 'Submitting Request…' : 'Submit Withdrawal Request'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Security Deposit Breakdown */}
      <div className="mem-card">
        <div className="mem-card-title">
          <span>Security Deposits & 10% Interest</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>
            {deposits.length} Records
          </span>
        </div>

        {deposits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--mem-text-muted)', fontSize: '0.82rem' }}>
            No security deposits recorded.
          </div>
        ) : (
          <div>
            {deposits.map((d, idx) => (
              <div key={idx} className="mem-stat-row">
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
                    Loan #{d.loanId} &bull; {d.schemeName}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>
                    Deposited: {new Date(d.depositDate).toLocaleDateString('en-IN')} &bull; Held for {d.diffYears} yrs
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: 'var(--mem-primary)', fontSize: '0.88rem' }}>
                    ₹{((d.principalPaise || 0) / 100).toLocaleString('en-IN')}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#047857', fontWeight: 600 }}>
                    + ₹{((d.interestPaise || 0) / 100).toLocaleString('en-IN')} interest
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Withdrawal Request History */}
      <div className="mem-card">
        <div className="mem-card-title">
          <span>Withdrawal Requests ({withdrawals.length})</span>
        </div>

        {withdrawals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--mem-text-muted)', fontSize: '0.82rem' }}>
            No past withdrawal requests.
          </div>
        ) : (
          <div>
            {withdrawals.map((w) => (
              <div key={w.id || w._id} className="mem-stat-row">
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
                    ₹{((w.amountPaise || 0) / 100).toLocaleString('en-IN')} &bull; #{w.reqNo}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>
                    {new Date(w.createdAt).toLocaleDateString('en-IN')} &bull; {w.requestType === 'adjust_emi' ? 'EMI Adjustment' : 'Bank Refund'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span
                    className={`mem-badge ${w.status === 'approved' ? 'completed' : w.status === 'rejected' ? 'rejected' : 'pending'}`}
                    style={{ textTransform: 'capitalize' }}
                  >
                    {w.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


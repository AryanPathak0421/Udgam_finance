import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberEmiPay() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [copiedField, setCopiedField] = useState('');

  // Payment form state
  const [selectedLoanId, setSelectedLoanId] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [utrNumber, setUtrNumber] = useState('');
  const [payMode, setPayMode] = useState('upi');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    loadDetails();
  }, []);

  async function loadDetails() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.emiPayDetails();
      setData(res);
      if (res.activeLoans && res.activeLoans.length > 0) {
        setSelectedLoanId(res.activeLoans[0].loanId);
        const nextAmt = res.nextEmi ? (res.nextEmi.amountPaise / 100).toString() : (res.activeLoans[0].installmentPaise / 100).toString();
        setAmountRupees(nextAmt);
      }
    } catch (err) {
      setError(err.message || 'Failed to load EMI payment details');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(text, field) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(''), 2000);
    }
  }

  async function handleSubmitProof(e) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const amt = parseFloat(amountRupees);
    if (!amt || amt <= 0) {
      setError('Please enter a valid payment amount');
      return;
    }
    if (!utrNumber.trim()) {
      setError('Please enter the bank UTR / UPI Transaction Reference Number');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.memberApp.submitEmiProof({
        loanId: selectedLoanId,
        amountPaise: Math.round(amt * 100),
        utrNumber: utrNumber.trim(),
        payMode,
        paidOn: payDate,
        remarks: remarks.trim(),
      });
      setSuccessMsg(res.message || 'Payment proof submitted successfully! Awaiting verification.');
      setUtrNumber('');
      setRemarks('');
      await loadDetails();
    } catch (err) {
      setError(err.message || 'Failed to submit payment proof');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--mem-text-muted)' }}>
        <Icon name="loader" size={26} className="spin" />
        <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Loading payment options…</p>
      </div>
    );
  }

  const bank = data?.companyBank || {
    accountName: 'Udgam Micro Finance Ltd',
    accountNumber: '9876002100014520',
    ifsc: 'UBIN054321',
    bankName: 'Union Bank of India',
    upiId: 'udgamfinance@upi',
  };

  const nextEmi = data?.nextEmi;
  const activeLoans = data?.activeLoans || [];
  const submissions = data?.recentSubmissions || [];

  const upiDeepLink = `upi://pay?pa=${encodeURIComponent(bank.upiId)}&pn=${encodeURIComponent(bank.accountName)}&am=${amountRupees || '0'}&cu=INR&tn=${encodeURIComponent(`EMI Loan ${selectedLoanId || ''}`)}`;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0 }}>Pay Loan EMI</h2>
        <span className="mem-badge active">Instant UPI</span>
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

      {/* Due Banner */}
      {nextEmi && (
        <div
          className="mem-card"
          style={{
            background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
            borderColor: '#fde68a',
            borderLeft: '4px solid #f59e0b',
            padding: 14,
          }}
        >
          <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#92400e', textTransform: 'uppercase' }}>
            Current Upcoming Due
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
            <div>
              <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#78350f' }}>
                ₹{((nextEmi.amountPaise || 0) / 100).toLocaleString('en-IN')}
              </div>
              <div style={{ fontSize: '0.74rem', color: '#92400e' }}>
                Loan #{nextEmi.loanId} &bull; Due: {new Date(nextEmi.dueDate).toLocaleDateString('en-IN')}
              </div>
            </div>
            <button
              type="button"
              className="mem-btn sm"
              style={{ width: 'auto', background: '#f59e0b', borderColor: '#f59e0b', color: '#ffffff' }}
              onClick={() => setAmountRupees(((nextEmi.amountPaise || 0) / 100).toString())}
            >
              Autofill Due
            </button>
          </div>
        </div>
      )}

      {/* UPI QR Payment Option */}
      <div className="mem-card" style={{ textAlign: 'center', padding: '18px 14px' }}>
        <div style={{ fontSize: '0.92rem', fontWeight: 800, marginBottom: 4 }}>
          Scan & Pay with Any UPI App
        </div>
        <div style={{ fontSize: '0.76rem', color: 'var(--mem-text-muted)', marginBottom: 14 }}>
          GPay, PhonePe, Paytm, BHIM or any banking app
        </div>

        {/* QR Code Container */}
        <div
          style={{
            display: 'inline-block',
            padding: 14,
            background: '#ffffff',
            borderRadius: 16,
            border: '2px dashed var(--mem-primary)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          }}
        >
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiDeepLink)}`}
            alt="UPI QR Code"
            style={{ width: 170, height: 170, display: 'block', borderRadius: 8 }}
          />
        </div>

        {/* UPI ID Row with Copy */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 12,
            fontSize: '0.86rem',
            fontWeight: 700,
          }}
        >
          <span>UPI ID: <strong style={{ color: 'var(--mem-primary)' }}>{bank.upiId}</strong></span>
          <button
            type="button"
            className="mem-btn sm secondary"
            style={{ width: 'auto', padding: '3px 8px', fontSize: '0.7rem' }}
            onClick={() => handleCopy(bank.upiId, 'upi')}
          >
            {copiedField === 'upi' ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <a
          href={upiDeepLink}
          className="mem-btn"
          style={{
            marginTop: 12,
            background: 'linear-gradient(135deg, #059669, #047857)',
            textDecoration: 'none',
          }}
        >
          <Icon name="dollar" size={18} />
          <span>Open UPI App to Pay</span>
        </a>
      </div>

      {/* Company Bank Details */}
      <div className="mem-card">
        <div className="mem-card-title">
          <span>Company Bank Account</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>IMPS / NEFT</span>
        </div>

        <div className="mem-stat-row">
          <span className="mem-stat-label">A/C Name</span>
          <span className="mem-stat-val">{bank.accountName}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Bank</span>
          <span className="mem-stat-val">{bank.bankName}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Account No.</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="mem-stat-val" style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}>
              {bank.accountNumber}
            </span>
            <button
              type="button"
              className="mem-btn sm secondary"
              style={{ width: 'auto', padding: '2px 6px', fontSize: '0.68rem' }}
              onClick={() => handleCopy(bank.accountNumber, 'acc')}
            >
              {copiedField === 'acc' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">IFSC Code</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="mem-stat-val" style={{ fontFamily: 'monospace' }}>
              {bank.ifsc}
            </span>
            <button
              type="button"
              className="mem-btn sm secondary"
              style={{ width: 'auto', padding: '2px 6px', fontSize: '0.68rem' }}
              onClick={() => handleCopy(bank.ifsc, 'ifsc')}
            >
              {copiedField === 'ifsc' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>

      {/* Submit Payment Proof Form */}
      <div className="mem-card" style={{ borderTop: '4px solid var(--mem-primary)' }}>
        <div className="mem-card-title">
          <span>Submit Payment Confirmation</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--mem-primary)', fontWeight: 700 }}>Mandatory Step</span>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--mem-text-muted)', marginTop: -6, marginBottom: 14 }}>
          After paying via UPI or Bank Transfer, please submit the 12-digit UTR or Reference number below to update your loan passbook.
        </p>

        <form onSubmit={handleSubmitProof}>
          <div className="mem-input-group">
            <label className="mem-label">Select Loan Account *</label>
            <select
              className="mem-select"
              value={selectedLoanId}
              onChange={(e) => setSelectedLoanId(e.target.value)}
              required
            >
              {activeLoans.map((l) => (
                <option key={l.id || l.loanId} value={l.loanId}>
                  {l.schemeName} ({l.loanId}) &bull; Due ₹{((l.installmentPaise || 0) / 100).toLocaleString('en-IN')}
                </option>
              ))}
              {activeLoans.length === 0 && <option value="GENERAL">General Loan Account</option>}
            </select>
          </div>

          <div className="mem-input-group">
            <label className="mem-label">Amount Paid (₹) *</label>
            <input
              type="number"
              className="mem-input"
              placeholder="e.g. 1500"
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
              required
              min="1"
            />
          </div>

          <div className="mem-input-group">
            <label className="mem-label">Bank UTR / UPI Reference Number *</label>
            <input
              type="text"
              className="mem-input"
              placeholder="e.g. 402918274619 or UPI Ref"
              value={utrNumber}
              onChange={(e) => setUtrNumber(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <div className="mem-input-group">
              <label className="mem-label">Payment Mode</label>
              <select className="mem-select" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                <option value="upi">UPI / QR Code</option>
                <option value="gpay">Google Pay</option>
                <option value="phonepe">PhonePe</option>
                <option value="paytm">Paytm</option>
                <option value="neft">NEFT / IMPS</option>
                <option value="branch">Branch Cash Deposit</option>
              </select>
            </div>

            <div className="mem-input-group">
              <label className="mem-label">Payment Date</label>
              <input
                type="date"
                className="mem-input"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="mem-input-group">
            <label className="mem-label">Remarks / Note (Optional)</label>
            <input
              type="text"
              className="mem-input"
              placeholder="e.g. Paid via GPay from SBI account"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>

          <button type="submit" className="mem-btn" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Payment Proof'}
          </button>
        </form>
      </div>

      {/* Recent Submissions */}
      {submissions.length > 0 && (
        <div className="mem-card">
          <div className="mem-card-title">Recent Submissions</div>
          {submissions.map((s) => (
            <div key={s.id || s._id} className="mem-stat-row">
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.84rem' }}>
                  ₹{((s.amountPaise || 0) / 100).toLocaleString('en-IN')} &bull; UTR: {s.utrNumber}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>
                  Loan #{s.loanId} &bull; {new Date(s.createdAt).toLocaleDateString('en-IN')}
                </div>
              </div>
              <span
                className={`mem-badge ${s.status === 'approved' ? 'completed' : s.status === 'rejected' ? 'rejected' : 'pending'}`}
                style={{ textTransform: 'capitalize' }}
              >
                {s.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

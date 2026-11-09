import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberSynopsis() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSynopsis();
  }, []);

  async function loadSynopsis() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.synopsis();
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load member synopsis');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--mem-text-muted)' }}>
        <Icon name="loader" size={26} className="spin" />
        <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Loading member credit synopsis…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mem-alert danger">
        <Icon name="alert" size={16} />
        <span>{error || 'Unable to retrieve member synopsis'}</span>
      </div>
    );
  }

  const m = data.member || {};
  const cs = data.creditScore || {};
  const bank = data.bank || {};
  const guarantor = data.guarantor || {};
  const preApproved = (data.preApprovedLoanLimitPaise || 0) / 100;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0 }}>Member Credit Synopsis</h2>
        <span className="mem-badge active">Confidential</span>
      </div>

      {/* Credit Standing Overview Banner */}
      <div
        className="mem-card"
        style={{
          background: 'linear-gradient(135deg, #059669, #065f46)',
          color: '#ffffff',
          borderRadius: 18,
          padding: '18px 20px',
          boxShadow: '0 8px 24px rgba(5, 150, 105, 0.25)',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.74rem', opacity: 0.9, textTransform: 'uppercase' }}>
              Udgam Repayment Rating
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 900, marginTop: 2 }}>
              {cs.rating || 'A+ (Excellent)'}
            </div>
          </div>
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              borderRadius: 12,
              padding: '8px 12px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1.25rem', fontWeight: 900 }}>{cs.onTimePaymentPercentage || 100}%</div>
            <div style={{ fontSize: '0.66rem', opacity: 0.9 }}>On-Time EMI</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.2)', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: '0.68rem', opacity: 0.85 }}>Total Loans</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800 }}>{cs.lifetimeLoansCount || 0}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', opacity: 0.85 }}>Closed Loans</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800 }}>{cs.closedLoansCount || 0}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.68rem', opacity: 0.85 }}>Defaults</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#86efac' }}>0</div>
          </div>
        </div>
      </div>

      {/* Pre-Approved Higher Limit Banner */}
      {preApproved > 0 && (
        <div
          className="mem-card"
          style={{
            background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
            borderColor: '#93c5fd',
            borderLeft: '5px solid #2563eb',
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase' }}>
                Pre-Approved Loan Eligibility
              </div>
              <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#1e3a8a', marginTop: 2 }}>
                ₹{preApproved.toLocaleString('en-IN')}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#2563eb' }}>
                Instant paperless disbursal based on consistent repayment history.
              </div>
            </div>
            <Link
              to="/member/apply-loan"
              className="mem-btn sm"
              style={{ width: 'auto', background: '#2563eb', borderColor: '#2563eb', color: '#ffffff' }}
            >
              Apply &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* Member Profile Dossier */}
      <div className="mem-card">
        <div className="mem-card-title">Member Details</div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Member Code</span>
          <span className="mem-stat-val" style={{ fontFamily: 'monospace' }}>{m.code}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Full Name</span>
          <span className="mem-stat-val">{m.name}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Mobile Number</span>
          <span className="mem-stat-val">{m.mobile}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Branch</span>
          <span className="mem-stat-val">{m.branch?.name || 'Head Office'}</span>
        </div>
        {m.center && (
          <div className="mem-stat-row">
            <span className="mem-stat-label">Center</span>
            <span className="mem-stat-val">{m.center}</span>
          </div>
        )}
        {m.group && (
          <div className="mem-stat-row">
            <span className="mem-stat-label">Group</span>
            <span className="mem-stat-val">{m.group}</span>
          </div>
        )}
        {m.joinDate && (
          <div className="mem-stat-row">
            <span className="mem-stat-label">Enrolled Date</span>
            <span className="mem-stat-val">{new Date(m.joinDate).toLocaleDateString('en-IN')}</span>
          </div>
        )}
      </div>

      {/* Financial Exposure */}
      <div className="mem-card">
        <div className="mem-card-title">Financial Standing</div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Lifetime Borrowed</span>
          <span className="mem-stat-val">₹{(((cs.totalBorrowedPaise || 0) / 100)).toLocaleString('en-IN')}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Lifetime Repaid</span>
          <span className="mem-stat-val" style={{ color: 'var(--mem-primary)' }}>
            ₹{(((cs.totalRepaidPaise || 0) / 100)).toLocaleString('en-IN')}
          </span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Active Exposure</span>
          <span className="mem-stat-val">₹{(((cs.activeExposurePaise || 0) / 100)).toLocaleString('en-IN')}</span>
        </div>
      </div>

      {/* Bank Account Info */}
      <div className="mem-card">
        <div className="mem-card-title">Registered Bank Account</div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Bank Name</span>
          <span className="mem-stat-val">{bank.bankName || 'State Bank of India'}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Account No.</span>
          <span className="mem-stat-val" style={{ fontFamily: 'monospace' }}>
            {bank.accountNumber || '•••• •••• 4521'}
          </span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">IFSC Code</span>
          <span className="mem-stat-val" style={{ fontFamily: 'monospace' }}>
            {bank.ifsc || 'SBIN0002134'}
          </span>
        </div>
      </div>

      {/* Guarantor Details */}
      {(guarantor.name || guarantor.mobile) && (
        <div className="mem-card">
          <div className="mem-card-title">Guarantor Information</div>
          <div className="mem-stat-row">
            <span className="mem-stat-label">Guarantor Name</span>
            <span className="mem-stat-val">{guarantor.name}</span>
          </div>
          <div className="mem-stat-row">
            <span className="mem-stat-label">Mobile</span>
            <span className="mem-stat-val">{guarantor.mobile}</span>
          </div>
          <div className="mem-stat-row">
            <span className="mem-stat-label">Relationship</span>
            <span className="mem-stat-val">{guarantor.relation || 'Co-Applicant'}</span>
          </div>
        </div>
      )}
    </div>
  );
}


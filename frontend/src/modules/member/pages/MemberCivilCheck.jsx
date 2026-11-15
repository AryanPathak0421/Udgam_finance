import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

const BAND_COLORS = {
  excellent: { bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0' },
  good: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  fair: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  poor: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
};

export default function MemberCivilCheck() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadCivilCheck();
  }, []);

  async function loadCivilCheck() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.civilCheck();
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load civil check details');
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshScore() {
    setChecking(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.memberApp.runCivilCheck();
      setData(res);
      setSuccess(res.message || 'Civil score verified and updated successfully!');
    } catch (err) {
      setError(err.message || 'Failed to check bureau civil score');
    } finally {
      setChecking(false);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--mem-text-muted)' }}>
        <Icon name="loader" size={26} className="spin" />
        <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Fetching credit bureau score…</p>
      </div>
    );
  }

  const score = data?.score || 740;
  const band = data?.band?.label || (score >= 750 ? 'Excellent' : score >= 700 ? 'Good' : score >= 650 ? 'Fair' : 'Poor');
  const bandKey = data?.band?.key || (score >= 750 ? 'excellent' : score >= 700 ? 'good' : score >= 650 ? 'fair' : 'poor');
  const colors = BAND_COLORS[bandKey] || BAND_COLORS.good;
  const bureau = data?.bureau || 'CIBIL';
  const fee = data?.fee != null ? data.fee : (data?.currentFee || 40);

  // Score meter percentage calculation (range 300 to 900)
  const pct = Math.min(100, Math.max(0, Math.round(((score - 300) / 600) * 100)));

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

      {/* Main Score Card */}
      <div
        className="mem-card"
        style={{
          borderTop: '5px solid var(--mem-primary)',
          textAlign: 'center',
          padding: '24px 18px',
          background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
        }}
      >
        <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--mem-text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
          Official Credit Bureau Score
        </div>

        <div style={{ fontSize: '3rem', fontWeight: 900, color: '#0f172a', lineHeight: 1.1, marginTop: 8 }}>
          {score}
        </div>

        <div style={{ marginTop: 8 }}>
          <span
            style={{
              display: 'inline-block',
              background: colors.bg,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              padding: '4px 14px',
              borderRadius: 20,
              fontSize: '0.82rem',
              fontWeight: 800,
            }}
          >
            {band} &bull; {bureau}
          </span>
        </div>

        {/* Progress Bar Meter */}
        <div style={{ margin: '20px auto 10px', maxWidth: 280 }}>
          <div style={{ height: 10, background: '#e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: score >= 700 ? '#059669' : score >= 650 ? '#f59e0b' : '#dc2626',
                borderRadius: 10,
                transition: 'width 0.6s ease',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--mem-text-muted)', marginTop: 4 }}>
            <span>300 (Poor)</span>
            <span>650 (Fair)</span>
            <span>750 (Good)</span>
            <span>900 (High)</span>
          </div>
        </div>

        <div style={{ fontSize: '0.75rem', color: 'var(--mem-text-muted)', marginTop: 12 }}>
          {data?.reportDate ? (
            <span>Report verified on: <strong>{new Date(data.reportDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></span>
          ) : (
            <span>Base bureau score &bull; Ready for official bureau check</span>
          )}
          {data?.reportNumber && <span> &bull; Ref: {data.reportNumber}</span>}
        </div>
      </div>

      {error && (
        <div className="mem-alert danger" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mem-alert success" style={{ marginBottom: 14 }}>
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      {/* Admin Configured Fee Notification */}
      <div
        className="mem-card"
        style={{
          background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
          borderLeft: '5px solid #059669',
          borderColor: '#86efac',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: '#059669',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon name="dollar" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#065f46' }}>
                Civil Check Fee: ₹{fee}
              </div>
              <span
                style={{
                  fontSize: '0.72rem',
                  background: '#059669',
                  color: '#fff',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 12,
                }}
              >
                Official Rate
              </span>
            </div>
            <div style={{ fontSize: '0.76rem', color: '#047857', marginTop: 4, lineHeight: 1.4 }}>
              As configured by Admin, every credit bureau check incurs a fee of <strong>₹{fee}</strong> and is recorded in the official Cashbook.
            </div>
          </div>
        </div>

        <button
          type="button"
          className="mem-btn"
          disabled={checking}
          onClick={handleRefreshScore}
          style={{
            marginTop: 14,
            background: '#059669',
            borderColor: '#059669',
            color: '#ffffff',
            fontWeight: 800,
          }}
        >
          <Icon name="shield" size={16} />
          <span>{checking ? 'Checking Credit Bureau…' : `Verify Bureau Civil Score (₹${fee})`}</span>
        </button>
      </div>

      {/* Loan Eligibility Impact */}
      <div className="mem-card" style={{ marginBottom: 14 }}>
        <div className="mem-card-title">Loan Eligibility Impact</div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">CIBIL Requirement</span>
          <span className="mem-stat-val" style={{ color: '#059669' }}>Min 650+ for Micro Loans</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Your Standing</span>
          <span className="mem-stat-val" style={{ fontWeight: 800 }}>
            {score >= 650 ? '✓ Eligible for New Loans' : '⚠️ Below Minimum Required'}
          </span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Fast Track Approval</span>
          <span className="mem-stat-val">Score &ge; 720 (Preferred)</span>
        </div>
      </div>

      {/* Credit Tips Card */}
      <div className="mem-card">
        <div className="mem-card-title">How to Maintain a 750+ Civil Score</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', color: 'var(--mem-text-muted)', lineHeight: 1.6 }}>
          <li>Always pay weekly or monthly EMIs on or before the due date.</li>
          <li>Never default on group or individual loan installments.</li>
          <li>Maintain consistent repayment records to get pre-approved loan increases.</li>
        </ul>
      </div>
    </div>
  );
}


import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMemberApp } from '../MemberAppContext.jsx';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberHome() {
  const { memUser, logout } = useMemberApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.dashboard();
      setData(res);
    } catch (err) {
      if (err.status === 401 || err.message?.includes('session') || err.message?.includes('signed in')) {
        logout();
        return;
      }
      setError(err.message || 'Failed to load member dashboard');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--mem-text-muted)' }}>
        <Icon name="loader" size={28} className="spin" />
        <p style={{ marginTop: 12, fontSize: '0.9rem' }}>Loading your account details…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mem-alert danger" style={{ margin: 16 }}>
        <Icon name="alert" size={18} />
        <div>
          <div style={{ fontWeight: 700 }}>Error Loading Dashboard</div>
          <div style={{ fontSize: '0.8rem' }}>{error}</div>
          <button className="mem-btn sm" onClick={loadDashboard} style={{ marginTop: 8, width: 'auto' }}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const summary = data?.summary || {};
  const nextEmi = data?.nextEmi;
  const holidays = data?.holidays || [];
  const requisitions = data?.requisitions || [];
  const graph = data?.graph || {};
  const recentTxns = data?.recentTransactions || [];

  const totalBorrowed = (graph.totalBorrowedPaise || 0) / 100;
  const totalPaid = (graph.totalPaidPaise || 0) / 100;
  const remaining = (graph.remainingPrincipalPaise || 0) / 100;
  const securityBalance = (summary.totalSecurityBalancePaise || 0) / 100;
  const securityInterest = (summary.securityInterestPaise || 0) / 100;

  const repaidPct = totalBorrowed > 0 ? Math.min(100, Math.round((totalPaid / totalBorrowed) * 100)) : 0;
  const remainingPct = 100 - repaidPct;

  // KYC status indicator
  const kycStatus = summary.kycStatus || 'pending';

  return (
    <div>
      {/* Welcome Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #059669, #065f46)',
          color: '#ffffff',
          borderRadius: 18,
          padding: '18px 20px',
          marginBottom: 14,
          boxShadow: '0 8px 24px rgba(5, 150, 105, 0.25)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ fontSize: '0.78rem', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Welcome Back,
        </div>
        <div style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: 2 }}>
          {memUser?.name || 'Valued Member'}
        </div>
        <div style={{ fontSize: '0.8rem', opacity: 0.9, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>Member ID: <strong>{memUser?.code}</strong></span>
          <span>&bull;</span>
          <span>{memUser?.branch?.name || 'Head Office'}</span>
        </div>
      </div>

      {/* Loan Approval Report Notification (Recent Loan Requisitions) */}
      {requisitions.length > 0 && (
        <div
          className="mem-card"
          style={{
            padding: 12,
            background: '#f8fafc',
            borderLeft: '4px solid var(--mem-primary)',
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--mem-text-muted)', textTransform: 'uppercase' }}>
              Loan Approval Report Notification
            </span>
            <Link to="/member/apply-loan" style={{ fontSize: '0.74rem', color: 'var(--mem-primary)', fontWeight: 700, textDecoration: 'none' }}>
              View All &rarr;
            </Link>
          </div>
          {requisitions.slice(0, 1).map((r) => {
            const st = r.status?.toLowerCase() || 'pending';
            const badgeClass = st === 'approved' ? 'completed' : st === 'rejected' ? 'rejected' : 'pending';
            return (
              <div key={r.id || r._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
                    Requisition #{r.requisitionNo || r.code || 'REQ'}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--mem-text-muted)' }}>
                    ₹{((r.requestedAmountPaise || 0) / 100).toLocaleString('en-IN')} &bull; Applied: {new Date(r.createdAt).toLocaleDateString('en-IN')}
                  </div>
                </div>
                <span className={`mem-badge ${badgeClass}`} style={{ textTransform: 'capitalize' }}>
                  {r.status || 'Pending'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Holiday Notification Banner */}
      {holidays.length > 0 && (
        <div
          className="mem-card"
          style={{
            padding: '10px 14px',
            background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
            borderColor: '#bfdbfe',
            borderLeft: '4px solid #2563eb',
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="calendar" size={18} style={{ color: '#2563eb' }} />
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#1e3a8a' }}>
                  Upcoming Holiday: {holidays[0].name}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#1d4ed8' }}>
                  {new Date(holidays[0].date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })} &bull; Branch Closed
                </div>
              </div>
            </div>
            <Link to="/member/holidays" style={{ fontSize: '0.72rem', color: '#2563eb', fontWeight: 700, textDecoration: 'none' }}>
              Full List &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* Next Upcoming EMI Banner */}
      {nextEmi ? (
        <div
          className="mem-card"
          style={{
            background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
            borderColor: '#fde68a',
            borderLeft: '5px solid #f59e0b',
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#92400e', textTransform: 'uppercase' }}>
              Next EMI Due
            </span>
            <span style={{ fontSize: '0.74rem', background: '#f59e0b', color: '#ffffff', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
              Inst #{nextEmi.installmentNo}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#78350f' }}>
                ₹{((nextEmi.amountPaise || 0) / 100).toLocaleString('en-IN')}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#92400e', marginTop: 2 }}>
                Due on: <strong>{new Date(nextEmi.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
              </div>
            </div>
            <Link
              to="/member/emi-pay"
              className="mem-btn sm"
              style={{
                width: 'auto',
                background: '#f59e0b',
                borderColor: '#f59e0b',
                color: '#ffffff',
                fontWeight: 800,
                padding: '8px 14px',
              }}
            >
              Pay EMI Now &rarr;
            </Link>
          </div>
        </div>
      ) : (
        <div className="mem-card" style={{ background: '#ecfdf5', borderColor: '#a7f3d0', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#065f46' }}>
              <Icon name="checkcircle" size={20} />
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>All EMIs Up to Date!</div>
                <div style={{ fontSize: '0.76rem', color: '#047857' }}>No pending overdue installments.</div>
              </div>
            </div>
            <Link to="/member/emi-pay" className="mem-btn sm secondary" style={{ width: 'auto', fontSize: '0.75rem' }}>
              Advance Pay
            </Link>
          </div>
        </div>
      )}

      {/* Financial Health Graph Card */}
      <div className="mem-card" style={{ marginBottom: 14 }}>
        <div className="mem-card-title">
          <span>Financial Distribution</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--mem-text-muted)' }}>
            {repaidPct}% Repaid
          </span>
        </div>

        {/* Stacked Progress Bar */}
        <div className="mem-stacked-bar">
          <div
            className="mem-bar-segment"
            style={{ width: `${repaidPct}%`, backgroundColor: 'var(--mem-primary)' }}
            title={`Repaid: ₹${totalPaid.toLocaleString('en-IN')}`}
          />
          <div
            className="mem-bar-segment"
            style={{ width: `${remainingPct}%`, backgroundColor: '#cbd5e1' }}
            title={`Remaining: ₹${remaining.toLocaleString('en-IN')}`}
          />
        </div>

        {/* Legend */}
        <div className="mem-legend-row">
          <div className="mem-legend-item">
            <span className="mem-legend-dot" style={{ backgroundColor: 'var(--mem-primary)' }} />
            <span>Repaid: <strong>₹{totalPaid.toLocaleString('en-IN')}</strong></span>
          </div>
          <div className="mem-legend-item">
            <span className="mem-legend-dot" style={{ backgroundColor: '#94a3b8' }} />
            <span>Remaining: <strong>₹{remaining.toLocaleString('en-IN')}</strong></span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--mem-border)' }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>Total Loans Borrowed</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800 }}>₹{totalBorrowed.toLocaleString('en-IN')}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>Active Loans</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--mem-primary)' }}>
              {summary.activeLoansCount || 0} Accounts
            </div>
          </div>
        </div>
      </div>

      {/* Security Amount & 10% Interest Show */}
      <div
        className="mem-card"
        style={{
          background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
          borderColor: '#bbf7d0',
          borderLeft: '5px solid #10b981',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="shield" size={18} style={{ color: '#059669' }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#065f46', textTransform: 'uppercase' }}>
              Security Amount & Interest
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', background: '#059669', color: '#ffffff', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
            10% p.a.
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#047857' }}>Total Balance (Principal + Interest)</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#064e3b' }}>
              ₹{securityBalance.toLocaleString('en-IN')}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#047857', marginTop: 2 }}>
              Includes ₹{securityInterest.toLocaleString('en-IN')} accrued interest
            </div>
          </div>

          <Link
            to="/member/security"
            className="mem-btn sm"
            style={{
              width: 'auto',
              background: '#059669',
              borderColor: '#059669',
              color: '#ffffff',
              fontWeight: 700,
            }}
          >
            Withdraw / Details &rarr;
          </Link>
        </div>
      </div>

      {/* KYC Report & Member Synopsis Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
        {/* KYC Status Card */}
        <Link
          to="/member/kyc"
          className="mem-card"
          style={{
            margin: 0,
            padding: 12,
            textDecoration: 'none',
            color: 'inherit',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--mem-text-muted)', textTransform: 'uppercase' }}>
                KYC Report
              </span>
              <Icon name="chevronright" size={14} style={{ color: 'var(--mem-text-muted)' }} />
            </div>
            <div style={{ fontSize: '0.88rem', fontWeight: 800 }}>
              {kycStatus === 'approved' ? 'Verified' : kycStatus === 'rejected' ? 'Action Required' : 'Under Review'}
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span
              className={`mem-badge ${kycStatus === 'approved' ? 'completed' : kycStatus === 'rejected' ? 'rejected' : 'pending'}`}
              style={{ fontSize: '0.68rem', padding: '2px 6px' }}
            >
              {kycStatus.toUpperCase()}
            </span>
          </div>
        </Link>

        {/* Member Synopsis Card */}
        <Link
          to="/member/synopsis"
          className="mem-card"
          style={{
            margin: 0,
            padding: 12,
            textDecoration: 'none',
            color: 'inherit',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--mem-text-muted)', textTransform: 'uppercase' }}>
                Member Synopsis
              </span>
              <Icon name="chevronright" size={14} style={{ color: 'var(--mem-text-muted)' }} />
            </div>
            <div style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--mem-primary)' }}>
              Credit Rating
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span className="mem-badge active" style={{ fontSize: '0.68rem', padding: '2px 6px' }}>
              Grade A &bull; Verified
            </span>
          </div>
        </Link>
      </div>

      {/* Quick Services Grid */}
      <div className="mem-card-title" style={{ marginTop: 6, marginBottom: 10 }}>All Member Services</div>
      <div className="mem-quick-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <Link to="/member/loans" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#ecfdf5', color: '#059669' }}>
            <Icon name="creditcard" size={20} />
          </div>
          <span>Track Loans</span>
        </Link>

        <Link to="/member/emi-pay" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
            <Icon name="dollar" size={20} />
          </div>
          <span>Pay EMI</span>
        </Link>

        <Link to="/member/apply-loan" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <Icon name="plus" size={20} />
          </div>
          <span>Loan Apply</span>
        </Link>

        <Link to="/member/security" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
            <Icon name="shield" size={20} />
          </div>
          <span>Security</span>
        </Link>

        <Link to="/member/noc" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
            <Icon name="file" size={20} />
          </div>
          <span>NOC Cert</span>
        </Link>

        <Link to="/member/complaints" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#fee2e2', color: '#dc2626' }}>
            <Icon name="alert" size={20} />
          </div>
          <span>Complaint</span>
        </Link>

        <Link to="/member/holidays" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#e0f2fe', color: '#0284c7' }}>
            <Icon name="calendar" size={20} />
          </div>
          <span>Holidays</span>
        </Link>

        <Link to="/member/passbook" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#fae8ff', color: '#a21caf' }}>
            <Icon name="bookopen" size={20} />
          </div>
          <span>Passbook</span>
        </Link>
      </div>

      {/* Recent Payments Section */}
      <div className="mem-card" style={{ marginTop: 12 }}>
        <div className="mem-card-title">
          <span>Recent EMI Receipts</span>
          <Link to="/member/loans" style={{ fontSize: '0.78rem', color: 'var(--mem-primary)', textDecoration: 'none' }}>
            View All
          </Link>
        </div>

        {recentTxns.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--mem-text-muted)', fontSize: '0.82rem' }}>
            No recent payment receipts found.
          </div>
        ) : (
          <div>
            {recentTxns.map((t) => (
              <div key={t.id || t._id} className="mem-stat-row">
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
                    Receipt: {t.receiptNo}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>
                    {new Date(t.paidOn).toLocaleDateString('en-IN')} &bull; Via {t.payMode?.toUpperCase()}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: 'var(--mem-success)', fontSize: '0.92rem' }}>
                    ₹{((t.amountPaise || 0) / 100).toLocaleString('en-IN')}
                  </div>
                  <span className="mem-badge completed" style={{ fontSize: '0.62rem', padding: '1px 6px' }}>
                    Paid
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

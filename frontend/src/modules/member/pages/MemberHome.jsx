import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMemberApp } from '../MemberAppContext.jsx';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberHome() {
  const { memUser } = useMemberApp();
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
  const recentTxns = data?.recentTransactions || [];

  return (
    <div>
      {/* Welcome Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #059669, #065f46)',
          color: '#ffffff',
          borderRadius: 18,
          padding: '18px 20px',
          marginBottom: 16,
          boxShadow: '0 8px 24px rgba(5, 150, 105, 0.25)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ fontSize: '0.8rem', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Welcome Back,
        </div>
        <div style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: 2 }}>
          {memUser?.name || 'Valued Member'}
        </div>
        <div style={{ fontSize: '0.8rem', opacity: 0.9, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Member ID: <strong>{memUser?.code}</strong></span>
          <span>&bull;</span>
          <span>{memUser?.branch?.name || 'Head Office'}</span>
        </div>
      </div>

      {/* Next Upcoming EMI Banner (if any) */}
      {nextEmi ? (
        <div
          className="mem-card"
          style={{
            background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
            borderColor: '#fde68a',
            borderLeft: '5px solid #f59e0b',
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
              <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#78350f' }}>
                ₹{((nextEmi.amountPaise || 0) / 100).toLocaleString('en-IN')}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#92400e', marginTop: 2 }}>
                Due on: <strong>{new Date(nextEmi.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
              </div>
            </div>
            <Link
              to="/member/loans"
              className="mem-btn sm"
              style={{
                width: 'auto',
                background: '#f59e0b',
                borderColor: '#f59e0b',
                color: '#ffffff',
                fontWeight: 700,
              }}
            >
              Loan Details &rarr;
            </Link>
          </div>
        </div>
      ) : (
        <div className="mem-card" style={{ background: '#ecfdf5', borderColor: '#a7f3d0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#065f46' }}>
            <Icon name="checkcircle" size={20} />
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>No Immediate Due!</div>
              <div style={{ fontSize: '0.78rem', color: '#047857' }}>All loan installments are up-to-date.</div>
            </div>
          </div>
        </div>
      )}

      {/* Financial Overview Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="mem-card" style={{ margin: 0, padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--mem-text-muted)', fontWeight: 600 }}>Active Loans</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--mem-primary)', marginTop: 4 }}>
            {summary.activeLoansCount || 0}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)', marginTop: 2 }}>
            Total Borrowed: ₹{((summary.totalBorrowedPaise || 0) / 100).toLocaleString('en-IN')}
          </div>
        </div>

        <div className="mem-card" style={{ margin: 0, padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--mem-text-muted)', fontWeight: 600 }}>Security Deposit</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--mem-accent)', marginTop: 4 }}>
            ₹{((summary.securityBalancePaise || 0) / 100).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)', marginTop: 2 }}>
            In Safe Custody
          </div>
        </div>
      </div>

      {/* Quick Action Grid */}
      <div className="mem-card-title" style={{ marginTop: 8 }}>Quick Services</div>
      <div className="mem-quick-grid">
        <Link to="/member/loans" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#ecfdf5', color: '#059669' }}>
            <Icon name="creditcard" size={20} />
          </div>
          <span>My Loans</span>
        </Link>

        <Link to="/member/passbook" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
            <Icon name="bookopen" size={20} />
          </div>
          <span>Passbook</span>
        </Link>

        <Link to="/member/apply-loan" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <Icon name="plus" size={20} />
          </div>
          <span>Apply Loan</span>
        </Link>

        <Link to="/member/profile" className="mem-quick-item">
          <div className="mem-quick-icon" style={{ background: '#f3e8ff', color: '#7c3aed' }}>
            <Icon name="user" size={20} />
          </div>
          <span>Profile</span>
        </Link>
      </div>

      {/* Recent Payments Section */}
      <div className="mem-card">
        <div className="mem-card-title">
          <span>Recent EMI Payments</span>
          <Link to="/member/loans" style={{ fontSize: '0.78rem', color: 'var(--mem-primary)', textDecoration: 'none' }}>
            View All
          </Link>
        </div>

        {recentTxns.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--mem-text-muted)', fontSize: '0.85rem' }}>
            No recent payment receipts found.
          </div>
        ) : (
          <div>
            {recentTxns.map((t) => (
              <div key={t.id} className="mem-stat-row">
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>
                    Receipt: {t.receiptNo}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--mem-text-muted)' }}>
                    {new Date(t.paidOn).toLocaleDateString('en-IN')} &bull; Via {t.payMode?.toUpperCase()}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: 'var(--mem-success)', fontSize: '0.92rem' }}>
                    ₹{((t.amountPaise || 0) / 100).toLocaleString('en-IN')}
                  </div>
                  <span className="mem-badge completed" style={{ fontSize: '0.65rem', padding: '1px 6px' }}>
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

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberLoans() {
  const [loans, setLoans] = useState([]);
  const [tab, setTab] = useState('all'); // 'all' | 'active' | 'completed'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadLoans();
  }, []);

  async function loadLoans() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.loans();
      setLoans(res.loans || []);
    } catch (err) {
      setError(err.message || 'Failed to load loans');
    } finally {
      setLoading(false);
    }
  }

  const filteredLoans = loans.filter((l) => {
    if (tab === 'active') return l.status === 'active';
    if (tab === 'completed') return l.status === 'completed';
    return true;
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--mem-text)' }}>
          My Loan Accounts
        </h2>
        <Link
          to="/member/apply-loan"
          className="mem-btn sm"
          style={{ width: 'auto', background: 'var(--mem-primary)', gap: 4 }}
        >
          <Icon name="plus" size={14} />
          <span>Apply New</span>
        </Link>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[
          { key: 'all', label: `All (${loans.length})` },
          { key: 'active', label: `Active (${loans.filter((l) => l.status === 'active').length})` },
          { key: 'completed', label: `Closed (${loans.filter((l) => l.status === 'completed').length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            className="mem-btn sm secondary"
            style={{
              flex: 1,
              background: tab === t.key ? 'var(--mem-primary)' : 'transparent',
              color: tab === t.key ? '#ffffff' : 'var(--mem-text-muted)',
              borderColor: tab === t.key ? 'var(--mem-primary)' : 'var(--mem-border)',
              fontWeight: 700,
            }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--mem-text-muted)' }}>
          <Icon name="loader" size={24} className="spin" />
          <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Loading loans…</p>
        </div>
      ) : error ? (
        <div className="mem-alert danger">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : filteredLoans.length === 0 ? (
        <div className="mem-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--mem-text-muted)' }}>
          <Icon name="creditcard" size={36} style={{ opacity: 0.4, marginBottom: 10 }} />
          <div style={{ fontWeight: 700 }}>No {tab !== 'all' ? tab : ''} loans found</div>
          <p style={{ fontSize: '0.8rem', margin: '4px 0 14px' }}>
            Looking for financial assistance? Apply for an instant micro loan.
          </p>
          <Link to="/member/apply-loan" className="mem-btn sm" style={{ width: 'auto', display: 'inline-flex' }}>
            Apply for Loan
          </Link>
        </div>
      ) : (
        <div>
          {filteredLoans.map((l) => {
            const pct = l.totalInstallments > 0 ? Math.round((l.paidInstallments / l.totalInstallments) * 100) : 0;
            return (
              <div key={l.id} className="mem-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)', textTransform: 'uppercase' }}>
                      Loan ID: {l.loanId}
                    </span>
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--mem-text)', marginTop: 2 }}>
                      {l.schemeName}
                    </div>
                  </div>
                  <span className={`mem-badge ${l.status === 'active' ? 'active' : 'completed'}`}>
                    {l.status}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, padding: '10px 0', borderTop: '1px solid var(--mem-border)', borderBottom: '1px solid var(--mem-border)', fontSize: '0.82rem' }}>
                  <div>
                    <span style={{ color: 'var(--mem-text-muted)' }}>Disbursed:</span>{' '}
                    <strong>₹{((l.borrowedAmountPaise || 0) / 100).toLocaleString('en-IN')}</strong>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: 'var(--mem-text-muted)' }}>EMI Amount:</span>{' '}
                    <strong style={{ color: 'var(--mem-primary)' }}>₹{((l.installmentPaise || 0) / 100).toLocaleString('en-IN')}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--mem-text-muted)' }}>Mode:</span>{' '}
                    <span>{l.modeLabel}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: 'var(--mem-text-muted)' }}>Disbursed On:</span>{' '}
                    <span>{l.disbursedOn ? new Date(l.disbursedOn).toLocaleDateString('en-IN') : '—'}</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 4 }}>
                    <span style={{ color: 'var(--mem-text-muted)' }}>Installments Paid:</span>
                    <strong>{l.paidInstallments} of {l.totalInstallments} ({pct}%)</strong>
                  </div>
                  <div style={{ width: '100%', height: 6, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: l.status === 'completed' ? 'var(--mem-success)' : 'var(--mem-primary)', borderRadius: 4 }} />
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <Link
                    to={`/member/loans/${l.id}`}
                    className="mem-btn sm secondary"
                    style={{ fontWeight: 700 }}
                  >
                    View Schedule & Receipts &rarr;
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


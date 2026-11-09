import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberLoanDetail() {
  const { id } = useParams();
  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDetail();
  }, [id]);

  async function loadDetail() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.loanDetail(id);
      setLoan(res.loan);
    } catch (err) {
      setError(err.message || 'Failed to load loan details');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--mem-text-muted)' }}>
        <Icon name="loader" size={26} className="spin" />
        <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Loading loan schedule…</p>
      </div>
    );
  }

  if (error || !loan) {
    return (
      <div>
        <Link to="/member/loans" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--mem-primary)', textDecoration: 'none', marginBottom: 12 }}>
          &larr; Back to Loans
        </Link>
        <div className="mem-alert danger">
          <Icon name="alert" size={16} />
          <span>{error || 'Loan not found'}</span>
        </div>
      </div>
    );
  }

  const schedule = loan.schedule || [];
  const pct = loan.totalInstallments > 0 ? Math.round((loan.paidCount / loan.totalInstallments) * 100) : 0;

  return (
    <div>
      <Link
        to="/member/loans"
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
        &larr; Back to All Loans
      </Link>

      {/* Main Loan Info Card */}
      <div className="mem-card" style={{ borderTop: '4px solid var(--mem-primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)', textTransform: 'uppercase' }}>
              Loan ID: {loan.loanId}
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--mem-text)' }}>
              {loan.schemeName}
            </div>
          </div>
          <span className="mem-badge active">{loan.loanType}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: '0.84rem', margin: '12px 0', padding: '10px 0', borderTop: '1px solid var(--mem-border)', borderBottom: '1px solid var(--mem-border)' }}>
          <div>
            <span style={{ color: 'var(--mem-text-muted)' }}>Sanctioned:</span>{' '}
            <strong>₹{((loan.borrowedAmountPaise || 0) / 100).toLocaleString('en-IN')}</strong>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ color: 'var(--mem-text-muted)' }}>Installment:</span>{' '}
            <strong style={{ color: 'var(--mem-primary)' }}>₹{((loan.installmentPaise || 0) / 100).toLocaleString('en-IN')}</strong>
          </div>
          <div>
            <span style={{ color: 'var(--mem-text-muted)' }}>Disbursed Date:</span>{' '}
            <span>{loan.paidOn ? new Date(loan.paidOn).toLocaleDateString('en-IN') : '—'}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ color: 'var(--mem-text-muted)' }}>Branch:</span>{' '}
            <span>{loan.branch?.name || '—'}</span>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', marginBottom: 4 }}>
            <span>Installments Paid: <strong>{loan.paidCount} of {loan.totalInstallments}</strong></span>
            <span><strong>{pct}%</strong></span>
          </div>
          <div style={{ width: '100%', height: 6, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--mem-primary)', borderRadius: 4 }} />
          </div>
        </div>
      </div>

      {/* Repayment Schedule */}
      <div className="mem-card">
        <div className="mem-card-title">
          <span>Repayment Installment Schedule</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)', fontWeight: 500 }}>
            {schedule.length} Installments
          </span>
        </div>

        {schedule.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--mem-text-muted)', fontSize: '0.85rem' }}>
            Schedule not generated for this loan.
          </div>
        ) : (
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {schedule.map((s) => (
              <div
                key={s.no}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--mem-border)',
                  fontSize: '0.84rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      background: s.isPaid ? 'var(--mem-success-light)' : '#f1f5f9',
                      color: s.isPaid ? 'var(--mem-success)' : 'var(--mem-text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                    }}
                  >
                    {s.isPaid ? '✓' : s.no}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--mem-text)' }}>
                      Installment #{s.no}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--mem-text-muted)' }}>
                      Due: {s.dueDate ? new Date(s.dueDate).toLocaleDateString('en-IN') : '—'}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: s.isPaid ? 'var(--mem-success)' : 'var(--mem-text)' }}>
                    ₹{((s.installmentPaise || 0) / 100).toLocaleString('en-IN')}
                  </div>
                  {s.isPaid ? (
                    <div style={{ fontSize: '0.68rem', color: 'var(--mem-success)', fontWeight: 600 }}>
                      Paid {s.paymentInfo?.paidOn ? `(${new Date(s.paymentInfo.paidOn).toLocaleDateString('en-IN')})` : ''}
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.68rem', color: '#d97706', fontWeight: 600 }}>
                      Pending
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Receipts list */}
      {loan.emis && loan.emis.length > 0 && (
        <div className="mem-card">
          <div className="mem-card-title">Payment Receipts ({loan.emis.length})</div>
          {loan.emis.map((e, idx) => (
            <div key={idx} className="mem-stat-row">
              <div>
                <div style={{ fontWeight: 700 }}>Receipt #{e.receiptNo}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--mem-text-muted)' }}>
                  {new Date(e.paidOn).toLocaleDateString('en-IN')} &bull; Mode: {e.payMode?.toUpperCase()}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, color: 'var(--mem-success)' }}>
                  ₹{((e.amountPaise || 0) / 100).toLocaleString('en-IN')}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--mem-text-muted)' }}>
                  Inst: {(e.installments || []).join(', ')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

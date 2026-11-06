import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorNpaRecovery() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState('branch'); // 'branch' | 'center'
  const [expandedId, setExpandedId] = useState(null);

  // Recovery modal
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [recoveryAmount, setRecoveryAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadNpaData();
  }, []);

  async function loadNpaData() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.npaOverview();
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load NPA data');
    } finally {
      setLoading(false);
    }
  }

  async function handleSettleRecovery(e) {
    e.preventDefault();
    if (!recoveryAmount || Number(recoveryAmount) <= 0) {
      setError('Please enter a valid recovery amount');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.supervisorApp.recoverNpa({
        loanId: selectedLoan.loanId,
        amount: Number(recoveryAmount),
        paymentMode,
      });
      setSuccess(`Recovery of ₹${Number(recoveryAmount).toLocaleString('en-IN')} received successfully!`);
      setSelectedLoan(null);
      setRecoveryAmount('');
      loadNpaData();
    } catch (err) {
      setError(err.message || 'Failed to process NPA recovery');
    } finally {
      setBusy(false);
    }
  }

  const branchWise = data?.branchWise || [];
  const centerWise = data?.centerWise || [];
  const totalAmount = data?.totalNpaAmount || 0;
  const totalLoans = data?.totalNpaLoans || 0;

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>NPA Recovery Management</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Branch-wise & Center-wise Overdue Portfolio</div>
      </div>

      {/* Mode Switcher */}
      <div style={{ display: 'flex', background: 'var(--sup-border)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.85rem',
            background: mode === 'branch' ? 'var(--sup-card-bg)' : 'transparent',
            color: mode === 'branch' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            boxShadow: mode === 'branch' ? 'var(--sup-shadow)' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setMode('branch')}
        >
          Branch-wise
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.85rem',
            background: mode === 'center' ? 'var(--sup-card-bg)' : 'transparent',
            color: mode === 'center' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            boxShadow: mode === 'center' ? 'var(--sup-shadow)' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setMode('center')}
        >
          Center-wise
        </button>
      </div>

      {/* Overview Card */}
      <div className="sup-card" style={{ borderLeft: '4px solid var(--sup-warning)', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--sup-text-muted)', fontWeight: 600 }}>
              TOTAL NPA RECOVERY PORTFOLIO
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--sup-warning)', marginTop: 2 }}>
              ₹{totalAmount.toLocaleString('en-IN')}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ background: 'var(--sup-warning-light)', color: 'var(--sup-warning)', padding: '4px 10px', borderRadius: 12, fontWeight: 700, fontSize: '0.8rem' }}>
              {totalLoans} Overdue Accounts
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-success-light)', color: 'var(--sup-success)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading NPA portfolio…
        </div>
      ) : (
        <div>
          {mode === 'branch' ? (
            branchWise.length === 0 ? (
              <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
                No NPA overdue loans across branches
              </div>
            ) : (
              branchWise.map((b) => {
                const isExpanded = expandedId === b.branchId;
                return (
                  <div key={b.branchId} className="sup-card" style={{ padding: 14 }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                      onClick={() => setExpandedId(isExpanded ? null : b.branchId)}
                    >
                      <div>
                        <strong style={{ fontSize: '0.95rem' }}>{b.branchName}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>{b.loanCount} NPA loans</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--sup-warning)' }}>
                          ₹{b.totalNpaAmount.toLocaleString('en-IN')}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <span>{isExpanded ? 'Hide' : 'View'} Loans</span>
                          <Icon name={isExpanded ? 'chevronup' : 'chevrondown'} size={12} />
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--sup-border)', paddingTop: 10 }}>
                        {(b.loans || []).map((loan, idx) => (
                          <div
                            key={loan.loanId || idx}
                            style={{
                              padding: '10px 0',
                              borderBottom: idx !== b.loans.length - 1 ? '1px dashed var(--sup-border)' : 'none',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: '0.88rem' }}>{loan.memberName}</strong>
                              <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                                Center: {loan.centerName} • Loan #{loan.loanNo}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--sup-danger)', fontWeight: 600 }}>
                                Overdue: {loan.overdueDays} days
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 800, color: 'var(--sup-warning)' }}>
                                ₹{loan.balanceAmount?.toLocaleString('en-IN')}
                              </div>
                              <button
                                type="button"
                                className="sup-btn sm"
                                style={{ marginTop: 4, padding: '3px 8px', fontSize: '0.75rem' }}
                                onClick={() => {
                                  setSelectedLoan(loan);
                                  setRecoveryAmount(loan.balanceAmount);
                                }}
                              >
                                Recover
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            centerWise.length === 0 ? (
              <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
                No NPA overdue loans across centers
              </div>
            ) : (
              centerWise.map((c, idx) => {
                const isExpanded = expandedId === c.centerName;
                return (
                  <div key={c.centerName || idx} className="sup-card" style={{ padding: 14 }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                      onClick={() => setExpandedId(isExpanded ? null : c.centerName)}
                    >
                      <div>
                        <strong style={{ fontSize: '0.95rem' }}>{c.centerName}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>{c.branchName} • {c.loanCount} Loans</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--sup-warning)' }}>
                          ₹{c.totalNpaAmount.toLocaleString('en-IN')}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <span>{isExpanded ? 'Hide' : 'View'} Loans</span>
                          <Icon name={isExpanded ? 'chevronup' : 'chevrondown'} size={12} />
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--sup-border)', paddingTop: 10 }}>
                        {(c.loans || []).map((loan, lIdx) => (
                          <div
                            key={loan.loanId || lIdx}
                            style={{
                              padding: '10px 0',
                              borderBottom: lIdx !== c.loans.length - 1 ? '1px dashed var(--sup-border)' : 'none',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: '0.88rem' }}>{loan.memberName}</strong>
                              <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                                Mobile: {loan.memberMobile || '—'} • Loan #{loan.loanNo}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontWeight: 800, color: 'var(--sup-warning)' }}>
                                ₹{loan.balanceAmount?.toLocaleString('en-IN')}
                              </div>
                              <button
                                type="button"
                                className="sup-btn sm"
                                style={{ marginTop: 4, padding: '3px 8px', fontSize: '0.75rem' }}
                                onClick={() => {
                                  setSelectedLoan(loan);
                                  setRecoveryAmount(loan.balanceAmount);
                                }}
                              >
                                Recover
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )
          )}
        </div>
      )}

      {/* Settle Recovery Modal */}
      {selectedLoan && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--sup-card-bg)', width: '100%', maxWidth: 380, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1.05rem' }}>Receive NPA Recovery</strong>
              <button className="sup-icon-btn" onClick={() => setSelectedLoan(null)}>
                <Icon name="cross" size={16} />
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', marginBottom: 12 }}>
              <div>Borrower: <strong>{selectedLoan.memberName}</strong></div>
              <div style={{ color: 'var(--sup-text-muted)' }}>Loan #{selectedLoan.loanNo} • Center: {selectedLoan.centerName}</div>
            </div>

            <form onSubmit={handleSettleRecovery}>
              <div className="sup-input-group">
                <label className="sup-label">Recovery Amount (₹)</label>
                <input
                  type="number"
                  required
                  className="sup-input"
                  value={recoveryAmount}
                  onChange={(e) => setRecoveryAmount(e.target.value)}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Payment Mode</label>
                <select
                  className="sup-select"
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                >
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI / QR Code</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
              </div>

              <button type="submit" className="sup-btn" disabled={busy}>
                {busy ? 'Processing Settlement…' : 'Confirm & Generate Receipt'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


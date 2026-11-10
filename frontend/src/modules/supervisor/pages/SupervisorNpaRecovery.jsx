import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorNpaRecovery() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState('branch'); // 'branch' | 'center' | 'all'
  const [expandedId, setExpandedId] = useState(null);

  // Dropdown filters (Point 4: Branch-wise, Center-wise, Staff-wise dropdowns)
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [selectedCenter, setSelectedCenter] = useState('all');
  const [selectedStaff, setSelectedStaff] = useState('all');

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
      // Point 4: Send both loanPaymentId and loanId so backend always resolves correctly
      await api.supervisorApp.recoverNpa({
        loanPaymentId: selectedLoan.loanPaymentId || selectedLoan.loanId,
        loanId: selectedLoan.loanId || selectedLoan.loanNo,
        memberCode: selectedLoan.memberCode,
        amount: Number(recoveryAmount),
        payMode: paymentMode,
      });
      setSuccess(`✓ Recovery of ₹${Number(recoveryAmount).toLocaleString('en-IN')} recorded & submitted to System EMI Approval!`);
      setSelectedLoan(null);
      setRecoveryAmount('');
      loadNpaData();
    } catch (err) {
      setError(err.message || 'Failed to process NPA recovery');
    } finally {
      setBusy(false);
    }
  }

  const allItems = data?.items || [];
  const rawBranchWise = data?.branchWise || [];
  const rawCenterWise = data?.centerWise || [];
  const staffWise = data?.staffWise || [];

  // Extract unique filter lists
  const branchOptions = useMemo(() => {
    const list = rawBranchWise.map((b) => ({ id: b.branchId, name: b.branchName }));
    return [{ id: 'all', name: 'All Branches' }, ...list];
  }, [rawBranchWise]);

  const centerOptions = useMemo(() => {
    const set = new Set(allItems.map((i) => i.centerName).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [allItems]);

  const staffOptions = useMemo(() => {
    const set = new Set(allItems.map((i) => i.staffCode).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [allItems]);

  // Apply dropdown filters
  const filteredItems = useMemo(() => {
    return allItems.filter((it) => {
      if (selectedBranch !== 'all' && String(it.branchId) !== String(selectedBranch)) return false;
      if (selectedCenter !== 'all' && it.centerName !== selectedCenter) return false;
      if (selectedStaff !== 'all' && it.staffCode !== selectedStaff) return false;
      return true;
    });
  }, [allItems, selectedBranch, selectedCenter, selectedStaff]);

  const totalFilteredAmount = filteredItems.reduce((sum, it) => sum + (it.balanceAmount || 0), 0);

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>NPA Recovery Management</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Branch, Center & Staff Overdue Recovery • System Approval Integrated
        </div>
      </div>

      {/* Point 4: Dropdown Filters for Branch, Center, Staff */}
      <div
        className="sup-card"
        style={{
          padding: 12,
          marginBottom: 14,
          background: 'var(--sup-bg)',
          border: '1px solid var(--sup-border)',
        }}
      >
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--sup-text-muted)', marginBottom: 8 }}>
          FILTER BY BRANCH, CENTER & STAFF:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--sup-text-muted)' }}>Branch</label>
            <select
              className="sup-select"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '6px 8px' }}
            >
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--sup-text-muted)' }}>Center</label>
            <select
              className="sup-select"
              value={selectedCenter}
              onChange={(e) => setSelectedCenter(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '6px 8px' }}
            >
              <option value="all">All Centers</option>
              {centerOptions
                .filter((c) => c !== 'all')
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--sup-text-muted)' }}>Staff Code</label>
            <select
              className="sup-select"
              value={selectedStaff}
              onChange={(e) => setSelectedStaff(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '6px 8px' }}
            >
              <option value="all">All Staff</option>
              {staffOptions
                .filter((s) => s !== 'all')
                .map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
            </select>
          </div>
        </div>
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
            fontSize: '0.82rem',
            background: mode === 'all' ? 'var(--sup-card-bg)' : 'transparent',
            color: mode === 'all' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            boxShadow: mode === 'all' ? 'var(--sup-shadow)' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setMode('all')}
        >
          All Accounts ({filteredItems.length})
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.82rem',
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
            fontSize: '0.82rem',
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
            <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)', fontWeight: 600 }}>
              FILTERED NPA RECOVERY PORTFOLIO
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--sup-warning)', marginTop: 2 }}>
              ₹{Math.round(totalFilteredAmount).toLocaleString('en-IN')}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span
              style={{
                background: 'var(--sup-warning-light)',
                color: 'var(--sup-warning)',
                padding: '4px 10px',
                borderRadius: 12,
                fontWeight: 700,
                fontSize: '0.8rem',
              }}
            >
              {filteredItems.length} Overdue Accounts
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--sup-danger-light)',
            color: 'var(--sup-danger)',
            borderRadius: 10,
            fontSize: '0.85rem',
            marginBottom: 14,
          }}
        >
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--sup-success-light)',
            color: 'var(--sup-success)',
            borderRadius: 10,
            fontSize: '0.85rem',
            marginBottom: 14,
          }}
        >
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading NPA portfolio…
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No NPA overdue or settlement loans found matching filters
        </div>
      ) : mode === 'all' ? (
        <div>
          {filteredItems.map((loan, idx) => (
            <div key={loan.loanId || idx} className="sup-card" style={{ padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong style={{ fontSize: '0.95rem' }}>{loan.memberName}</strong>
                    {loan.isSettlement && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          padding: '1px 6px',
                          background: '#fef3c7',
                          color: '#b45309',
                          borderRadius: 4,
                          fontWeight: 700,
                        }}
                      >
                        Settlement Loan
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
                    Code: {loan.memberCode || '—'} • Center: {loan.centerName}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                    Branch: {loan.branchName} • Staff: {loan.staffCode || '—'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--sup-danger)', fontWeight: 600, marginTop: 2 }}>
                    Overdue: {loan.overdueDays} days {loan.settlementReceiptNo ? `• Rcpt: ${loan.settlementReceiptNo}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--sup-warning)' }}>
                    ₹{Math.round(loan.balanceAmount || 0).toLocaleString('en-IN')}
                  </div>
                  <button
                    type="button"
                    className="sup-btn sm primary"
                    style={{ marginTop: 6, padding: '4px 12px', fontSize: '0.78rem', width: 'auto' }}
                    onClick={() => {
                      setSelectedLoan(loan);
                      setRecoveryAmount(loan.balanceAmount);
                    }}
                  >
                    Collect / Settle →
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : mode === 'branch' ? (
        <div>
          {rawBranchWise.map((b) => {
            const bLoans = filteredItems.filter((i) => String(i.branchId) === String(b.branchId));
            if (!bLoans.length && selectedBranch !== 'all') return null;
            const bTotal = bLoans.reduce((s, x) => s + (x.balanceAmount || 0), 0);
            const isExpanded = expandedId === b.branchId;

            return (
              <div key={b.branchId} className="sup-card" style={{ padding: 14, marginBottom: 10 }}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : b.branchId)}
                >
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{b.branchName}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                      {bLoans.length} NPA / Settlement accounts
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--sup-warning)' }}>
                      ₹{Math.round(bTotal).toLocaleString('en-IN')}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <span>{isExpanded ? 'Hide' : 'View'} Accounts</span>
                      <Icon name={isExpanded ? 'chevronup' : 'chevrondown'} size={12} />
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--sup-border)', paddingTop: 10 }}>
                    {bLoans.map((loan, idx) => (
                      <div
                        key={loan.loanId || idx}
                        style={{
                          padding: '10px 0',
                          borderBottom: idx !== bLoans.length - 1 ? '1px dashed var(--sup-border)' : 'none',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <strong style={{ fontSize: '0.88rem' }}>{loan.memberName}</strong>
                            {loan.isSettlement && (
                              <span style={{ fontSize: '0.65rem', padding: '1px 4px', background: '#fef3c7', color: '#b45309', borderRadius: 3 }}>
                                Settlement
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                            Center: {loan.centerName} • Staff: {loan.staffCode}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--sup-danger)', fontWeight: 600 }}>
                            Overdue: {loan.overdueDays} days
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 800, color: 'var(--sup-warning)' }}>
                            ₹{Math.round(loan.balanceAmount || 0).toLocaleString('en-IN')}
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
          })}
        </div>
      ) : (
        <div>
          {rawCenterWise.map((c, idx) => {
            const cLoans = filteredItems.filter((i) => i.centerName === c.centerName);
            if (!cLoans.length && selectedCenter !== 'all') return null;
            const cTotal = cLoans.reduce((s, x) => s + (x.balanceAmount || 0), 0);
            const isExpanded = expandedId === c.centerName;

            return (
              <div key={c.centerName || idx} className="sup-card" style={{ padding: 14, marginBottom: 10 }}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : c.centerName)}
                >
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{c.centerName}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                      {c.branchName} • {cLoans.length} Loans
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--sup-warning)' }}>
                      ₹{Math.round(cTotal).toLocaleString('en-IN')}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <span>{isExpanded ? 'Hide' : 'View'} Accounts</span>
                      <Icon name={isExpanded ? 'chevronup' : 'chevrondown'} size={12} />
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--sup-border)', paddingTop: 10 }}>
                    {cLoans.map((loan, lIdx) => (
                      <div
                        key={loan.loanId || lIdx}
                        style={{
                          padding: '10px 0',
                          borderBottom: lIdx !== cLoans.length - 1 ? '1px dashed var(--sup-border)' : 'none',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <strong style={{ fontSize: '0.88rem' }}>{loan.memberName}</strong>
                            {loan.isSettlement && (
                              <span style={{ fontSize: '0.65rem', padding: '1px 4px', background: '#fef3c7', color: '#b45309', borderRadius: 3 }}>
                                Settlement
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                            Staff: {loan.staffCode} • Loan #{loan.loanNo}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 800, color: 'var(--sup-warning)' }}>
                            ₹{Math.round(loan.balanceAmount || 0).toLocaleString('en-IN')}
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
          })}
        </div>
      )}

      {/* Settle Recovery Modal */}
      {selectedLoan && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              background: 'var(--sup-card-bg)',
              width: '100%',
              maxWidth: 380,
              borderRadius: 16,
              padding: 20,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1.05rem' }}>Receive NPA Recovery</strong>
              <button className="sup-icon-btn" onClick={() => setSelectedLoan(null)}>
                <Icon name="cross" size={16} />
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', marginBottom: 12 }}>
              <div>
                Borrower: <strong>{selectedLoan.memberName}</strong>
              </div>
              <div style={{ color: 'var(--sup-text-muted)', fontSize: '0.78rem' }}>
                Loan #{selectedLoan.loanNo} • Center: {selectedLoan.centerName}
              </div>
              {selectedLoan.isSettlement && (
                <div style={{ color: '#b45309', fontSize: '0.75rem', fontWeight: 600, marginTop: 2 }}>
                  ★ Active Settlement Case
                </div>
              )}
            </div>

            <form onSubmit={handleSettleRecovery}>
              <div className="sup-input-group">
                <label className="sup-label">Recovery Amount (₹)</label>
                <input
                  type="number"
                  required
                  min="1"
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

              <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)', marginBottom: 10 }}>
                ℹ This collection creates a pending record for <strong>System EMI Approval</strong>.
              </div>

              <button type="submit" className="sup-btn" disabled={busy}>
                {busy ? 'Processing Settlement…' : 'Confirm & Submit to System Approval'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

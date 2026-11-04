import { useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';

export default function EmployeeTrackLoan() {
  const { t } = useEmployeeApp();
  const [loanQuery, setLoanQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loanData, setLoanData] = useState(null);
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState('schedule'); // 'schedule' | 'receipts'

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!loanQuery.trim()) return;
    setLoading(true);
    setError('');
    setLoanData(null);
    try {
      const res = await api.employeeApp.trackLoan(loanQuery.trim());
      setLoanData(res);
    } catch (err) {
      setError(err.message || 'Loan ID not found');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Search Bar Card */}
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--emp-text)' }}>
          🔍 Track Loan History (Loan ID Wise)
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
          Enter any Loan ID or account number to view complete loan lifecycle, repayment schedule, and EMI receipts.
        </p>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            className="emp-input"
            placeholder="Enter Loan ID (e.g. LN00123)..."
            value={loanQuery}
            onChange={(e) => setLoanQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" className="emp-btn-primary" style={{ padding: '0 16px' }} disabled={loading}>
            {loading ? 'Searching...' : 'Track'}
          </button>
        </form>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {loanData && (
        <>
          {/* Loan Master Overview */}
          <div className="emp-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span className="emp-badge emp-badge-info" style={{ textTransform: 'capitalize' }}>
                  {loanData.loan?.loanType} Loan • {loanData.loan?.mode}
                </span>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '6px 0 2px 0', color: 'var(--emp-text)' }}>
                  Loan #{loanData.loan?.loanId}
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)' }}>
                  Borrower: <strong>{loanData.loan?.borrowers?.[0]?.name}</strong> ({loanData.loan?.borrowers?.[0]?.code})
                </div>
                {loanData.loan?.group?.name && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Group: {loanData.loan?.group?.name} ({loanData.loan?.group?.code})
                  </div>
                )}
              </div>

              <div style={{ textAlign: 'right' }}>
                <span className={`emp-badge ${loanData.loan?.status === 'closed' ? 'emp-badge-warning' : 'emp-badge-success'}`}>
                  {loanData.loan?.status === 'closed' ? 'Loan Closed' : 'Active Loan'}
                </span>
                <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>
                  Disbursed: {loanData.loan?.paidOn ? new Date(loanData.loan?.paidOn).toLocaleDateString() : 'N/A'}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--emp-border)', fontSize: '0.8rem' }}>
              <div>
                <span style={{ color: 'var(--emp-text-muted)' }}>Sanction Amount</span>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--emp-primary)' }}>
                  ₹{Number(loanData.loan?.totalAmount || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--emp-text-muted)' }}>Total Collected</span>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#059669' }}>
                  ₹{Number(loanData.loan?.totalCollected || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--emp-text-muted)' }}>Remaining Balance</span>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#dc2626' }}>
                  ₹{Number(loanData.loan?.balance || 0).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>

          {/* Sub Tab Switcher */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              className={activeTab === 'schedule' ? 'emp-btn-primary' : 'emp-btn-secondary'}
              style={{ flex: 1, padding: '8px' }}
              onClick={() => setActiveTab('schedule')}
            >
              📅 Repayment Schedule ({loanData.schedule?.length || 0})
            </button>
            <button
              type="button"
              className={activeTab === 'receipts' ? 'emp-btn-primary' : 'emp-btn-secondary'}
              style={{ flex: 1, padding: '8px' }}
              onClick={() => setActiveTab('receipts')}
            >
              🧾 Receipts History ({loanData.payments?.length || 0})
            </button>
          </div>

          {/* Tab 1: Repayment Schedule */}
          {activeTab === 'schedule' && (
            <div className="emp-card" style={{ padding: '12px' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'var(--emp-card-bg)', borderBottom: '1px solid var(--emp-border)', color: 'var(--emp-text-muted)' }}>
                      <th style={{ padding: '8px 4px' }}>#</th>
                      <th style={{ padding: '8px 4px' }}>Due Date</th>
                      <th style={{ padding: '8px 4px' }}>EMI</th>
                      <th style={{ padding: '8px 4px' }}>Prin.</th>
                      <th style={{ padding: '8px 4px' }}>Int.</th>
                      <th style={{ padding: '8px 4px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loanData.schedule?.map((row) => (
                      <tr key={row.no} style={{ borderBottom: '1px solid var(--emp-border)' }}>
                        <td style={{ padding: '8px 4px', fontWeight: 700 }}>{row.no}</td>
                        <td style={{ padding: '8px 4px' }}>{row.dueDate}</td>
                        <td style={{ padding: '8px 4px', fontWeight: 700 }}>₹{row.installmentAmount}</td>
                        <td style={{ padding: '8px 4px' }}>₹{row.principal}</td>
                        <td style={{ padding: '8px 4px' }}>₹{row.interest}</td>
                        <td style={{ padding: '8px 4px' }}>
                          {row.status === 'paid' && <span className="emp-badge emp-badge-success" style={{ fontSize: '0.68rem' }}>✓ Paid</span>}
                          {row.status === 'overdue' && <span className="emp-badge emp-badge-danger" style={{ fontSize: '0.68rem' }}>⚠️ Overdue</span>}
                          {row.status === 'upcoming' && <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.68rem' }}>⏳ Due</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 2: Receipts History */}
          {activeTab === 'receipts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!loanData.payments?.length ? (
                <div className="emp-card" style={{ textAlign: 'center', padding: '24px', color: 'var(--emp-text-muted)' }}>
                  No payment receipts recorded yet for this loan.
                </div>
              ) : (
                loanData.payments.map((p) => (
                  <div key={p.receiptNo} className="emp-card" style={{ margin: 0, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>Receipt: {p.receiptNo}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                          Date: {p.paidOn} • Mode: <strong style={{ textTransform: 'capitalize' }}>{p.payMode}</strong>
                        </div>
                        {p.npa && <span className="emp-badge emp-badge-danger" style={{ marginTop: 4 }}>NPA Recovery</span>}
                        {p.type === 'advance' && <span className="emp-badge emp-badge-warning" style={{ marginTop: 4 }}>Advance Deposit</span>}
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#059669' }}>
                          +₹{Number(p.amount).toLocaleString('en-IN')}
                        </div>
                        <span className="emp-badge emp-badge-success" style={{ fontSize: '0.68rem', marginTop: 4 }}>
                          Confirmed
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

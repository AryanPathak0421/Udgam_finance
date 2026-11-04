import { useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';

export default function EmployeeBorrowerSavings() {
  const { t } = useEmployeeApp();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Withdrawal request form
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [kind, setKind] = useState('withdraw');
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    setSuccess('');
    setData(null);
    try {
      const res = await api.employeeApp.borrowerSavings(query.trim());
      setData(res);
    } catch (err) {
      setError(err.message || 'Member savings record not found');
    } finally {
      setSearching(false);
    }
  };

  const handleRequestWithdrawal = async (e) => {
    e.preventDefault();
    if (!data) return;
    const amount = Number(withdrawAmount);
    if (!amount || amount < 100) {
      setError('Minimum withdrawal request is ₹100');
      return;
    }
    if (amount > data.availableBalance) {
      setError(`Cannot request more than available balance (₹${data.availableBalance})`);
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.employeeApp.requestSavingsWithdrawal({
        memberId: data.member?.id,
        amount,
        kind,
        remark,
      });

      setSuccess(`✓ ${res.message} (Receipt: ${res.receiptNo})`);
      setWithdrawAmount('');
      setRemark('');
      // Refresh
      handleSearch();
    } catch (err) {
      setError(err.message || 'Failed to submit withdrawal request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Search Header */}
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--emp-text)' }}>
          💰 Borrower Saving / Security Amount
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
          Search member ID to view deposit &amp; withdrawal history, and submit a withdrawal request.
        </p>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            className="emp-input"
            placeholder="Enter Member Code, Phone, or ID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" className="emp-btn-primary" style={{ padding: '0 16px' }} disabled={searching}>
            {searching ? '...' : 'Lookup'}
          </button>
        </form>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
          {success}
        </div>
      )}

      {data && (
        <>
          {/* Member & Balance Summary */}
          <div className="emp-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)' }}>
                  {data.member?.name}
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                  Code: <strong>{data.member?.code}</strong> • Mobile: {data.member?.mobile}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="emp-badge emp-badge-success">Savings Active</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--emp-border)', fontSize: '0.8rem' }}>
              <div>
                <span style={{ color: 'var(--emp-text-muted)' }}>Total Deposit</span>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#059669' }}>
                  ₹{Number(data.totalDeposited).toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--emp-text-muted)' }}>Withdrawn</span>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#dc2626' }}>
                  ₹{Number(data.totalWithdrawn).toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--emp-text-muted)' }}>Available Balance</span>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--emp-primary)' }}>
                  ₹{Number(data.availableBalance).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>

          {/* Request Withdrawal Form */}
          <div className="emp-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
              Submit Savings Withdrawal Request
            </h3>

            <form onSubmit={handleRequestWithdrawal} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Withdrawal Amount (₹) *
                  </label>
                  <input
                    type="number"
                    className="emp-input"
                    placeholder="Min ₹100"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    max={data.availableBalance}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Type
                  </label>
                  <select className="emp-input" value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="withdraw">Cash Return (Withdraw)</option>
                    <option value="adjust">Adjust against Loan EMI</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Reason / Remark
                </label>
                <input
                  type="text"
                  className="emp-input"
                  placeholder="e.g. Loan closed, emergency withdrawal"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="emp-btn-primary"
                style={{ padding: '12px', fontSize: '0.95rem', fontWeight: 700, marginTop: 4 }}
                disabled={submitting || !withdrawAmount || data.availableBalance <= 0}
              >
                {submitting ? 'Submitting Request...' : `Submit Withdrawal Request (₹${withdrawAmount || 0})`}
              </button>
            </form>
          </div>

          {/* History Lists */}
          <div className="emp-card">
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--emp-text)' }}>
              Deposit &amp; Withdrawal History
            </h4>

            {data.withdrawals?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text-muted)', marginBottom: 6 }}>
                  Withdrawal Requests ({data.withdrawals.length}):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.withdrawals.map((w) => (
                    <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', border: '1px solid var(--emp-border)', borderRadius: 6, fontSize: '0.8rem' }}>
                      <div>
                        <strong>{w.receiptNo}</strong> • {w.kind} • {w.remark || 'No remark'}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: '#dc2626' }}>-₹{w.amount}</span>{' '}
                        <span className={`emp-badge ${w.status === 'approved' ? 'emp-badge-success' : w.status === 'rejected' ? 'emp-badge-danger' : 'emp-badge-warning'}`}>
                          {w.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text-muted)', marginBottom: 6 }}>
                Security Deposits from Loans ({data.deposits?.length || 0}):
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.deposits?.map((d, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', border: '1px solid var(--emp-border)', borderRadius: 6, fontSize: '0.8rem' }}>
                    <div>Loan: <strong>{d.loanId}</strong> • {d.date ? new Date(d.date).toLocaleDateString() : 'N/A'}</div>
                    <div style={{ fontWeight: 700, color: '#059669' }}>+₹{d.amount}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

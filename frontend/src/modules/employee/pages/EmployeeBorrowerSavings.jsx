import { useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

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
    if (data.availableBalance <= 0) {
      setError('Security of running loans is locked. Only security from closed loans is withdrawable.');
      return;
    }
    if (amount > data.availableBalance) {
      setError(`Cannot request more than withdrawable closed-loan balance (₹${data.availableBalance})`);
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
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="bank" size={20} style={{ color: 'var(--emp-primary)' }} />
          <span>Borrower Savings &amp; Security Deposits</span>
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
          Search member code to view deposits, 10% annual interest earned, running security lock status, and submit withdrawal requests for closed loans.
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
                <span className="emp-badge emp-badge-success">Savings Account</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--emp-border)', fontSize: '0.8rem' }}>
              <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8 }}>
                <span style={{ color: 'var(--emp-text-muted)', fontSize: '0.75rem' }}>Total Security Deposited</span>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#059669', marginTop: 2 }}>
                  ₹{Number(data.totalDeposited || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div style={{ background: '#eff6ff', padding: 10, borderRadius: 8 }}>
                <span style={{ color: '#1d4ed8', fontSize: '0.75rem', fontWeight: 600 }}>Interest Earned (10% p.a.)</span>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1d4ed8', marginTop: 2 }}>
                  +₹{Number(data.interestEarned || 0).toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10, fontSize: '0.8rem' }}>
              <div style={{ background: '#fef2f2', padding: 10, borderRadius: 8, border: '1px dashed #fca5a5' }}>
                <span style={{ color: '#b91c1c', fontSize: '0.75rem', fontWeight: 600 }}>Running Loan Security (Locked)</span>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#b91c1c', marginTop: 2 }}>
                  ₹{Number(data.runningSecurity || 0).toLocaleString('en-IN')}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#7f1d1d', marginTop: 2 }}>Non-withdrawable until loan closure</div>
              </div>
              <div style={{ background: '#f0fdf4', padding: 10, borderRadius: 8, border: '1px solid #86efac' }}>
                <span style={{ color: '#15803d', fontSize: '0.75rem', fontWeight: 600 }}>Closed Loan Security (Withdrawable)</span>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#15803d', marginTop: 2 }}>
                  ₹{Number(data.availableBalance || 0).toLocaleString('en-IN')}
                </div>
                <div style={{ fontSize: '0.68rem', color: '#166534', marginTop: 2 }}>Eligible for cash withdrawal</div>
              </div>
            </div>
          </div>

          {/* Request Withdrawal Form */}
          <div className="emp-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
              Submit Security Withdrawal Request
            </h3>

            {data.availableBalance <= 0 ? (
              <div style={{ background: '#fef3c7', color: '#92400e', padding: '12px', borderRadius: 8, fontSize: '0.82rem' }}>
                ⚠️ <strong>No withdrawable balance available.</strong> Security deposit from active running loans cannot be withdrawn until the loan account is fully closed.
              </div>
            ) : (
              <form onSubmit={handleRequestWithdrawal} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Withdrawal Amount (₹) *
                    </label>
                    <input
                      type="number"
                      className="emp-input"
                      placeholder={`Max ₹${data.availableBalance}`}
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      max={data.availableBalance}
                      min="100"
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
                    placeholder="e.g. Loan closed, settlement refund"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="emp-btn-primary"
                  style={{ width: '100%', padding: '12px 0', fontSize: '0.95rem' }}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting Request...' : 'Submit Withdrawal Request'}
                </button>
              </form>
            )}
          </div>

          {/* Deposit Breakdown */}
          {data.deposits && data.deposits.length > 0 && (
            <div className="emp-card">
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--emp-text)' }}>
                Security Deposits per Loan ({data.deposits.length})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.deposits.map((d, idx) => (
                  <div key={idx} style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, fontSize: '0.82rem', border: '1px solid var(--emp-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700 }}>Loan {d.loanId}</span>
                      <span className={`emp-badge ${d.isClosed ? 'emp-badge-success' : 'emp-badge-warning'}`}>
                        {d.status}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, color: 'var(--emp-text-muted)' }}>
                      <span>Security: <strong>₹{d.amount}</strong></span>
                      <span>Years: <strong>{d.years} yrs</strong></span>
                      <span>Interest: <strong style={{ color: '#1d4ed8' }}>+₹{d.interest}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

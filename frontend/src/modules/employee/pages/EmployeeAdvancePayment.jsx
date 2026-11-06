import { useState, useRef } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeAdvancePayment() {
  const { t } = useEmployeeApp();
  const [loanQuery, setLoanQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loanData, setLoanData] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Advance form
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [payMode, setPayMode] = useState('cash'); // 'cash' | 'upi'
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  // Dynamic QR Code modal
  const [qrModal, setQrModal] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);

  const handleSearchLoan = async (e) => {
    e?.preventDefault();
    if (!loanQuery.trim()) return;
    setSearching(true);
    setError('');
    setSuccess('');
    setLoanData(null);
    try {
      const res = await api.employeeApp.trackLoan(loanQuery.trim());
      setLoanData(res);
      // Pre-fill suggested advance with 1 EMI (up to remaining balance)
      if (res.loan?.scheduleCount > 0 && res.schedule?.[0]?.installmentAmount) {
        const emi = Number(res.schedule[0].installmentAmount);
        const bal = Number(res.loan?.balance || 0);
        setAdvanceAmount(String(bal > 0 ? Math.min(emi, bal) : 0));
      }
    } catch (err) {
      setError(err.message || 'Loan record not found');
    } finally {
      setSearching(false);
    }
  };

  const handleOpenQr = async () => {
    if (!advanceAmount || Number(advanceAmount) <= 0) {
      setError('Please enter a valid advance amount first');
      return;
    }
    setQrLoading(true);
    setError('');
    try {
      const borrower = loanData.loan?.borrowers?.[0];
      const res = await api.employeeApp.companyQr({
        amount: Number(advanceAmount),
        loanId: loanData.loan?.loanId,
        memberName: borrower?.name || '',
      });
      setQrModal(res);
      setPayMode('upi');
    } catch (err) {
      setError(err.message || 'Failed to generate company QR code');
    } finally {
      setQrLoading(false);
    }
  };

  const handleSubmitAdvance = async (e) => {
    e?.preventDefault();
    // Immediate synchronous lock to prevent multiple rapid taps
    if (!loanData || isSubmittingRef.current || submitting) return;

    const remainingBal = Number(loanData.loan?.balance || 0);
    if (remainingBal <= 0) {
      setError('This loan is already fully paid and closed. Balance is ₹0.');
      return;
    }

    const amount = Number(advanceAmount);
    if (!amount || amount < 1) {
      setError('Please enter an amount of ₹1 or more');
      return;
    }

    if (amount > remainingBal) {
      setError(`Advance amount (₹${amount.toLocaleString('en-IN')}) cannot exceed remaining balance of ₹${remainingBal.toLocaleString('en-IN')}`);
      return;
    }

    isSubmittingRef.current = true;
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const borrower = loanData.loan?.borrowers?.[0];
      const res = await api.employeeApp.advancePayment({
        loanId: loanData.loan?.loanId,
        memberCode: borrower?.code,
        amount,
        payMode,
        reference,
      });

      setSuccess(`✓ Advance payment of ₹${amount.toLocaleString('en-IN')} recorded successfully! Receipt: ${res.receiptNo}`);
      setQrModal(null);
      setAdvanceAmount('');
      setReference('');
      // Refresh loan details
      handleSearchLoan();
    } catch (err) {
      setError(err.message || 'Advance payment failed');
    } finally {
      setSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <div className="emp-page-container">
      {/* Header Search Card */}
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="creditcard" size={20} style={{ color: 'var(--emp-primary)' }} />
          <span>Advance Payment (Loan ID Wise)</span>
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
          Deposit any amount in advance. Member can also scan company QR code to pay directly to the company bank account.
        </p>

        <form onSubmit={handleSearchLoan} style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            className="emp-input"
            placeholder="Enter Loan ID or Account No..."
            value={loanQuery}
            onChange={(e) => setLoanQuery(e.target.value)}
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

      {loanData && (
        <>
          {/* Loan Info Overview Card */}
          <div className="emp-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span className="emp-badge emp-badge-info" style={{ textTransform: 'uppercase' }}>
                  {loanData.loan?.loanType} Loan
                </span>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '6px 0 2px 0', color: 'var(--emp-text)' }}>
                  Loan A/c: {loanData.loan?.loanId}
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)' }}>
                  Borrower: <strong>{loanData.loan?.borrowers?.[0]?.name}</strong> ({loanData.loan?.borrowers?.[0]?.code})
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span className={`emp-badge ${loanData.loan?.status === 'closed' ? 'emp-badge-warning' : 'emp-badge-success'}`}>
                  {loanData.loan?.status}
                </span>
                <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>
                  Branch: {loanData.loan?.branchName || 'Main'}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--emp-border)', fontSize: '0.8rem' }}>
              <div>
                <span style={{ color: 'var(--emp-text-muted)' }}>Loan Amount</span>
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>₹{Number(loanData.loan?.totalAmount || 0).toLocaleString('en-IN')}</div>
              </div>
              <div>
                <span style={{ color: 'var(--emp-text-muted)' }}>Total Collected</span>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#059669' }}>₹{Number(loanData.loan?.totalCollected || 0).toLocaleString('en-IN')}</div>
              </div>
              <div>
                <span style={{ color: 'var(--emp-text-muted)' }}>Balance</span>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#dc2626' }}>₹{Number(loanData.loan?.balance || 0).toLocaleString('en-IN')}</div>
              </div>
            </div>
          </div>

          {/* Advance Deposit Form */}
          <div className="emp-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 14px 0', color: 'var(--emp-text)' }}>
              Enter Advance Amount to Deposit
            </h3>

            <form onSubmit={handleSubmitAdvance} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 6 }}>
                  Advance Deposit Amount (₹) *
                </label>
                <input
                  type="number"
                  className="emp-input"
                  placeholder="e.g. 1500"
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                  style={{ fontSize: '1.2rem', fontWeight: 800 }}
                  required
                />
              </div>

              {/* Payment Mode Selector */}
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 6 }}>
                  Payment Mode
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setPayMode('cash')}
                    style={{
                      padding: '12px',
                      borderRadius: 8,
                      border: payMode === 'cash' ? '2px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                      background: payMode === 'cash' ? 'var(--emp-primary-light)' : 'var(--emp-card-bg)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6
                    }}
                  >
                    <Icon name="cash" size={16} />
                    <span>Cash Deposit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPayMode('upi');
                      handleOpenQr();
                    }}
                    style={{
                      padding: '12px',
                      borderRadius: 8,
                      border: payMode === 'upi' ? '2px solid #059669' : '1px solid var(--emp-border)',
                      background: payMode === 'upi' ? '#ecfdf5' : 'var(--emp-card-bg)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6
                    }}
                  >
                    <Icon name="qrcode" size={16} />
                    <span>Online Company QR</span>
                  </button>
                </div>
              </div>

              {/* QR Code Action Notice */}
              {payMode === 'upi' && (
                <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#065f46', fontSize: '0.9rem' }}>Company UPI QR Ready</div>
                      <div style={{ fontSize: '0.75rem', color: '#047857', marginTop: 2 }}>
                        Directly to Udgam Finance bank account
                      </div>
                    </div>
                    <button
                      type="button"
                      className="emp-btn-primary"
                      style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#059669' }}
                      onClick={handleOpenQr}
                    >
                      View QR / Bar Code
                    </button>
                  </div>
                </div>
              )}

              {/* UTR / Transaction Reference */}
              {payMode === 'upi' && (
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    UPI / UTR Transaction ID (Reference)
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    placeholder="e.g. UPI 12-digit ref or Bank UTR"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
              )}

              {loanData.loan?.balance <= 0 ? (
                <div style={{ background: '#fef3c7', color: '#92400e', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', fontWeight: 700 }}>
                  ✓ This loan is fully paid and settled. No further advance payment can be credited.
                </div>
              ) : (
                <button
                  type="submit"
                  className="emp-btn-primary"
                  style={{ padding: '14px', fontSize: '1rem', fontWeight: 800, marginTop: 4 }}
                  disabled={submitting || !advanceAmount || Number(advanceAmount) <= 0 || Number(advanceAmount) > Number(loanData.loan?.balance || 0)}
                >
                  {submitting ? 'Crediting Advance... Please wait' : `Confirm & Credit Advance (₹${Number(advanceAmount || 0).toLocaleString('en-IN')})`}
                </button>
              )}
            </form>
          </div>
        </>
      )}

      {/* Dynamic Company UPI QR Code Modal */}
      {qrModal && (
        <div className="emp-modal-overlay" onClick={() => setQrModal(null)}>
          <div className="emp-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Icon name="qrcode" size={20} style={{ color: 'var(--emp-primary)' }} />
              <span>Scan & Pay to Company</span>
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
              Borrower pays directly to <strong>{qrModal.companyName}</strong>. Staff does NOT take cash into personal account.
            </p>

            <div style={{ display: 'inline-block', padding: 12, background: '#fff', borderRadius: 12, border: '2px solid var(--emp-border)', margin: '0 auto 12px auto' }}>
              <img src={qrModal.qrImageUrl} alt="Company UPI QR" style={{ width: 220, height: 220, display: 'block' }} />
            </div>

            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--emp-primary)', marginBottom: 4 }}>
              ₹{Number(qrModal.amount).toLocaleString('en-IN')}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginBottom: 16 }}>
              UPI ID: <strong>{qrModal.upiId}</strong>
            </div>

            <div style={{ background: '#fef3c7', padding: '10px 14px', borderRadius: 8, fontSize: '0.78rem', color: '#92400e', marginBottom: 16, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="shieldcheck" size={16} />
              <span><strong>Accepted Apps:</strong> Google Pay, PhonePe, Paytm, BHIM, or any UPI banking app.</span>
            </div>

            <button
              type="button"
              className="emp-btn-primary"
              style={{ width: '100%', padding: '12px', fontSize: '0.95rem' }}
              onClick={() => setQrModal(null)}
            >
              Done Scanning / Enter UTR
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


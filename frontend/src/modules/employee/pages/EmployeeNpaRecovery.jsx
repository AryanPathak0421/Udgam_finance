import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';

export default function EmployeeNpaRecovery() {
  const { t } = useEmployeeApp();
  const [npaLoans, setNpaLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState({ text: '', type: '' });

  // Pay Now Modal State
  const [activeNpa, setActiveNpa] = useState(null);
  const [recoveryAmount, setRecoveryAmount] = useState('');
  const [payMode, setPayMode] = useState('cash'); // 'cash' | 'upi'
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Dynamic QR Code modal
  const [qrModal, setQrModal] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);

  const fetchNpa = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.employeeApp.npaLoans();
      setNpaLoans(res.items || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch NPA loans list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNpa();
  }, []);

  const handleOpenPay = (item) => {
    setActiveNpa(item);
    setRecoveryAmount(String(item.totalOverdue || item.totalBalance || ''));
    setPayMode('cash');
    setReference('');
    setMessage({ text: '', type: '' });
  };

  const handleOpenQr = async () => {
    if (!recoveryAmount || Number(recoveryAmount) <= 0) {
      alert('Please enter a valid recovery amount first');
      return;
    }
    setQrLoading(true);
    try {
      const res = await api.employeeApp.companyQr({
        amount: Number(recoveryAmount),
        loanId: activeNpa.loanId,
        memberName: activeNpa.memberName,
      });
      setQrModal(res);
      setPayMode('upi');
    } catch (err) {
      alert(err.message || 'Failed to generate company QR code');
    } finally {
      setQrLoading(false);
    }
  };

  const handleConfirmRecovery = async (e) => {
    e.preventDefault();
    if (!activeNpa) return;
    const amount = Number(recoveryAmount);
    if (!amount || amount < 1) {
      alert('Enter a valid recovery amount of ₹1 or more');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.employeeApp.recoverNpa({
        loanPaymentId: activeNpa.loanPaymentId,
        memberCode: activeNpa.memberCode,
        amount,
        payMode,
        reference,
      });

      setMessage({
        text: `✓ NPA Recovery of ₹${amount.toLocaleString('en-IN')} recorded successfully! Receipt: ${res.receiptNo}`,
        type: 'success',
      });
      setActiveNpa(null);
      setQrModal(null);
      fetchNpa();
    } catch (err) {
      alert(err.message || 'NPA recovery submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Header Card */}
      <div className="emp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)' }}>
              🚨 NPA Recovery Management
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '4px 0 0 0' }}>
              Overdue defaulted loans (DPD &gt; 90). Collect recovery via Cash or Online Company QR.
            </p>
          </div>
          <span className="emp-badge emp-badge-danger" style={{ fontWeight: 800 }}>
            {npaLoans.length} NPA
          </span>
        </div>
      </div>

      {message.text && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            fontSize: '0.85rem',
            marginBottom: 12,
            background: message.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: message.type === 'success' ? '#166534' : '#991b1b',
          }}
        >
          {message.text}
        </div>
      )}

      {/* NPA List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>
          Loading NPA loans...
        </div>
      ) : error ? (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px', borderRadius: 8, fontSize: '0.85rem' }}>
          {error}
        </div>
      ) : npaLoans.length === 0 ? (
        <div className="emp-card" style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--emp-text-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🎉</div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#059669' }}>Zero NPA in your portfolio!</div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>All loan dues and repayments are currently on track.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {npaLoans.map((item) => (
            <div key={`${item.loanId}-${item.memberCode}`} className="emp-card" style={{ margin: 0, border: '1px solid #fca5a5' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: '0.98rem', color: '#991b1b' }}>
                      {item.memberName}
                    </span>
                    <span className="emp-badge emp-badge-danger" style={{ fontSize: '0.7rem' }}>
                      {item.npaCategory}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Code: <strong>{item.memberCode}</strong> • Loan A/c: <strong>{item.loanId}</strong>
                  </div>

                  {item.phone && (
                    <div style={{ fontSize: '0.75rem', marginTop: 3 }}>
                      📞 <a href={`tel:${item.phone}`} style={{ color: 'var(--emp-primary)', fontWeight: 600 }}>{item.phone}</a>
                    </div>
                  )}
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#dc2626' }}>
                    ₹{Number(item.totalOverdue).toLocaleString('en-IN')}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>
                    {item.dpd} Days Overdue (DPD)
                  </div>
                </div>
              </div>

              {/* Overdue breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--emp-border)', fontSize: '0.75rem' }}>
                <div>
                  <span style={{ color: 'var(--emp-text-muted)' }}>Overdue Prin.</span>
                  <div style={{ fontWeight: 600 }}>₹{Number(item.overduePrincipal).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--emp-text-muted)' }}>Overdue Int.</span>
                  <div style={{ fontWeight: 600 }}>₹{Number(item.overdueInterest).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--emp-text-muted)' }}>Total Balance</span>
                  <div style={{ fontWeight: 700, color: '#dc2626' }}>₹{Number(item.totalBalance).toLocaleString('en-IN')}</div>
                </div>
              </div>

              {/* Pay Now Button */}
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="emp-btn-primary"
                  style={{ width: '100%', padding: '8px', fontSize: '0.85rem', fontWeight: 700, background: '#dc2626' }}
                  onClick={() => handleOpenPay(item)}
                >
                  ⚡ Pay Now / Recover NPA
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pay Now / Recovery Modal */}
      {activeNpa && (
        <div className="emp-modal-overlay" onClick={() => setActiveNpa(null)}>
          <div className="emp-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 4px 0', color: 'var(--emp-text)' }}>
              💵 NPA Recovery: {activeNpa.memberName}
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
              Loan A/c: <strong>{activeNpa.loanId}</strong> • Total Overdue: <strong>₹{activeNpa.totalOverdue}</strong>
            </p>

            <form onSubmit={handleConfirmRecovery} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Recovery Amount (₹) *
                </label>
                <input
                  type="number"
                  className="emp-input"
                  value={recoveryAmount}
                  onChange={(e) => setRecoveryAmount(e.target.value)}
                  style={{ fontSize: '1.2rem', fontWeight: 800 }}
                  required
                />
              </div>

              {/* Mode Selection: Cash / Online */}
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 6 }}>
                  Recovery Payment Mode
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setPayMode('cash')}
                    style={{
                      padding: '10px',
                      borderRadius: 8,
                      border: payMode === 'cash' ? '2px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                      background: payMode === 'cash' ? 'rgba(37, 99, 235, 0.08)' : 'var(--emp-card-bg)',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    💵 Cash Recovery
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPayMode('upi');
                      handleOpenQr();
                    }}
                    style={{
                      padding: '10px',
                      borderRadius: 8,
                      border: payMode === 'upi' ? '2px solid #059669' : '1px solid var(--emp-border)',
                      background: payMode === 'upi' ? '#ecfdf5' : 'var(--emp-card-bg)',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    📲 Online Company QR
                  </button>
                </div>
              </div>

              {payMode === 'upi' && (
                <div>
                  <button
                    type="button"
                    className="emp-btn-primary"
                    style={{ width: '100%', padding: '8px', fontSize: '0.82rem', background: '#059669' }}
                    onClick={handleOpenQr}
                  >
                    View / Scan Company QR Code
                  </button>

                  <div style={{ marginTop: 8 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      UPI / UTR Transaction ID
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="Enter 12-digit UPI UTR"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="emp-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setActiveNpa(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="emp-btn-primary"
                  style={{ flex: 1, background: '#dc2626' }}
                  disabled={submitting}
                >
                  {submitting ? 'Processing...' : 'Confirm Recovery'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dynamic Company UPI QR Code Modal */}
      {qrModal && (
        <div className="emp-modal-overlay" onClick={() => setQrModal(null)}>
          <div className="emp-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)' }}>
              📲 Scan & Pay to Company
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
              Borrower pays directly to <strong>{qrModal.companyName}</strong> bank account.
            </p>

            <div style={{ display: 'inline-block', padding: 12, background: '#fff', borderRadius: 12, border: '2px solid var(--emp-border)', margin: '0 auto 12px auto' }}>
              <img src={qrModal.qrImageUrl} alt="Company UPI QR" style={{ width: 220, height: 220, display: 'block' }} />
            </div>

            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#059669', marginBottom: 4 }}>
              ₹{Number(qrModal.amount).toLocaleString('en-IN')}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginBottom: 16 }}>
              UPI ID: <strong>{qrModal.upiId}</strong>
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


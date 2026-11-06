import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeNpaRecovery() {
  const { t } = useEmployeeApp();
  const [npaLoans, setNpaLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

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

  // Filter NPA loans by search and category
  const filteredNpa = npaLoans.filter((item) => {
    if (categoryFilter !== 'all' && (item.npaCategory || '').toLowerCase() !== categoryFilter.toLowerCase()) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (item.memberName || '').toLowerCase().includes(q) ||
      (item.memberCode || '').toLowerCase().includes(q) ||
      (item.loanId || '').toLowerCase().includes(q) ||
      (item.groupName || '').toLowerCase().includes(q) ||
      String(item.phone || '').includes(q)
    );
  });

  return (
    <div className="emp-page-container">
      {/* Header Card */}
      <div className="emp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="alert" size={20} style={{ color: 'var(--emp-danger)' }} />
              <span>NPA Recovery Management</span>
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '4px 0 0 0' }}>
              Overdue defaulted loans (DPD &gt; 90). Fast lookup & recovery collection.
            </p>
          </div>
          <span className="emp-badge emp-badge-danger" style={{ fontWeight: 800 }}>
            {npaLoans.length} Total NPA
          </span>
        </div>

        {/* Search Option Bar */}
        <div style={{ marginTop: 14 }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: 12, color: 'var(--emp-text-muted)' }}>
              <Icon name="search" size={16} />
            </span>
            <input
              type="text"
              className="emp-input"
              placeholder="Search by borrower name, code, loan A/c, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 38, width: '100%', fontSize: '0.88rem' }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: 12,
                  background: 'none',
                  border: 'none',
                  color: 'var(--emp-text-muted)',
                  cursor: 'pointer',
                  fontWeight: 800,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Category Filter Chips */}
        <div style={{ display: 'flex', gap: 6, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
          {[
            { id: 'all', label: `All (${npaLoans.length})` },
            { id: 'sub-standard', label: `Sub-Standard (${npaLoans.filter((x) => (x.npaCategory || '').toLowerCase() === 'sub-standard').length})` },
            { id: 'doubtful', label: `Doubtful (${npaLoans.filter((x) => (x.npaCategory || '').toLowerCase() === 'doubtful').length})` },
            { id: 'loss', label: `Loss (${npaLoans.filter((x) => (x.npaCategory || '').toLowerCase() === 'loss').length})` },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id)}
              style={{
                padding: '4px 10px',
                borderRadius: 20,
                fontSize: '0.74rem',
                fontWeight: 700,
                border: categoryFilter === cat.id ? '2px solid #b91c1c' : '1px solid var(--emp-border)',
                background: categoryFilter === cat.id ? '#fee2e2' : 'var(--emp-card-bg)',
                color: categoryFilter === cat.id ? '#991b1b' : 'var(--emp-text)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {cat.label}
            </button>
          ))}
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
      ) : filteredNpa.length === 0 ? (
        <div className="emp-card" style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--emp-text-muted)' }}>
          <div style={{ color: 'var(--emp-success)', marginBottom: 8 }}><Icon name="shieldcheck" size={40} /></div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#059669' }}>
            {npaLoans.length === 0 ? 'Zero NPA in your portfolio!' : 'No NPA loans match your search'}
          </div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
            {searchQuery ? 'Try clearing the search query or category filter.' : 'All loan dues and repayments are currently on track.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredNpa.map((item) => (
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
                    <div style={{ fontSize: '0.75rem', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Icon name="phone" size={13} />
                      <a href={`tel:${item.phone}`} style={{ color: 'var(--emp-primary)', fontWeight: 600, textDecoration: 'none' }}>{item.phone}</a>
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
                  style={{ width: '100%', padding: '10px', fontSize: '0.85rem', fontWeight: 700, background: '#b91c1c' }}
                  onClick={() => handleOpenPay(item)}
                >
                  Pay Now / Recover NPA
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
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 4px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="cash" size={18} style={{ color: 'var(--emp-danger)' }} />
              <span>NPA Recovery: {activeNpa.memberName}</span>
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
                    <span>Cash Recovery</span>
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


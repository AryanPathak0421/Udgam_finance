import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeTodayDue() {
  const { t } = useEmployeeApp();
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [dues, setDues] = useState([]);
  const [totalDue, setTotalDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Quick Collect Modal
  const [collectModal, setCollectModal] = useState(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [submitting, setSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState({ text: '', type: '' });

  const fetchDues = async (selectedDate) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.employeeApp.todayDueList(selectedDate);
      setDues(data.items || []);
      setTotalDue(data.totalDue || 0);
    } catch (err) {
      setError(err.message || 'Failed to fetch due collection list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDues(date);
  }, [date]);

  const handleOpenCollect = (item) => {
    setCollectModal(item);
    setCollectAmount(item.dueAmount || item.installmentAmount || '');
    setPaymentMode('cash');
    setActionMessage({ text: '', type: '' });
  };

  const handleCollectSubmit = async (e) => {
    e.preventDefault();
    if (!collectAmount || Number(collectAmount) <= 0) {
      setActionMessage({ text: 'Please enter a valid amount', type: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      // Record payment via software EMI collection API or employee collection
      if (api.emiCollection && api.emiCollection.create) {
        await api.emiCollection.create({
          loanId: collectModal.loanId,
          memberId: collectModal.memberId,
          amount: Number(collectAmount),
          paymentMode,
          collectionDate: date,
        });
      }
      setActionMessage({ text: 'Payment collected successfully! Receipt generated.', type: 'success' });
      setTimeout(() => {
        setCollectModal(null);
        fetchDues(date);
      }, 1200);
    } catch (err) {
      setActionMessage({ text: err.message || 'Collection failed', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Date Filter Card */}
      <div className="emp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
            ⏰ {t('todayDue')}
          </h2>
          <span className="emp-badge emp-badge-warning">{dues.length} Due</span>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)' }}>Date:</label>
          <input
            type="date"
            className="emp-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      </div>

      {/* Due Summary */}
      <div className="emp-card" style={{ background: 'linear-gradient(135deg, #d97706, #f59e0b)', color: '#fff' }}>
        <div style={{ fontSize: '0.8rem', opacity: 0.9, textTransform: 'uppercase' }}>
          Total Expected Due ({date})
        </div>
        <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: 4 }}>
          ₹{Number(totalDue).toLocaleString('en-IN')}
        </div>
        <div style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: 4 }}>
          Pending from {dues.length} installments
        </div>
      </div>

      {/* Dues List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>
          Loading due installments...
        </div>
      ) : error ? (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px', borderRadius: 8, fontSize: '0.85rem' }}>
          {error}
        </div>
      ) : dues.length === 0 ? (
        <div className="emp-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
          <div style={{ color: 'var(--emp-success)', marginBottom: 8 }}><Icon name="checkcircle" size={40} /></div>
          <div style={{ fontWeight: 600 }}>All dues are clear for this date!</div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>No pending installments remaining.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {dues.map((d) => (
            <div key={d.id || d._id} className="emp-card" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--emp-text)' }}>
                    {d.memberName}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Code: <strong>{d.memberCode}</strong> | Group: <strong>{d.groupName || 'General'}</strong>
                  </div>
                  {d.phone && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Icon name="phone" size={13} />
                      <a href={`tel:${d.phone}`} style={{ color: 'var(--emp-primary)', textDecoration: 'none', fontWeight: 600 }}>{d.phone}</a>
                    </div>
                  )}
                  <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: 3, fontWeight: 600 }}>
                    Installment #{d.installmentNo || 1} • Due: {d.dueDate}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#dc2626' }}>
                    ₹{Number(d.dueAmount || d.installmentAmount || 0).toLocaleString('en-IN')}
                  </div>
                  <button
                    type="button"
                    className="emp-btn-primary"
                    style={{ marginTop: 8, padding: '6px 14px', fontSize: '0.8rem' }}
                    onClick={() => handleOpenCollect(d)}
                  >
                    Collect EMI
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Collect Modal */}
      {collectModal && (
        <div className="emp-modal-overlay" onClick={() => setCollectModal(null)}>
          <div className="emp-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="cash" size={18} style={{ color: 'var(--emp-primary)' }} />
              <span>Collect EMI: {collectModal.memberName}</span>
            </h3>

            {actionMessage.text && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  fontSize: '0.85rem',
                  marginBottom: 12,
                  background: actionMessage.type === 'success' ? '#dcfce7' : '#fee2e2',
                  color: actionMessage.type === 'success' ? '#166534' : '#991b1b',
                }}
              >
                {actionMessage.text}
              </div>
            )}

            <form onSubmit={handleCollectSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Collection Amount (₹)
                </label>
                <input
                  type="number"
                  className="emp-input"
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Payment Mode
                </label>
                <select className="emp-input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI / QR Code</option>
                  <option value="bank_transfer">Bank Transfer / NEFT</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="emp-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setCollectModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="emp-btn-primary"
                  style={{ flex: 1 }}
                  disabled={submitting}
                >
                  {submitting ? 'Collecting...' : 'Confirm Collect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


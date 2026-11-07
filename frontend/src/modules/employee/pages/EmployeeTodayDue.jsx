import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

const DUE_CATEGORIES = [
  { id: 'all', label: 'All Dues' },
  { id: 'group', label: 'Group Loans' },
  { id: 'personal', label: 'Personal Loans' },
  { id: 'msme', label: 'MSME Loans' },
  { id: 'product', label: 'Product Loans' },
];

export default function EmployeeTodayDue() {
  const { t } = useEmployeeApp();
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dues, setDues] = useState([]);
  const [summary, setSummary] = useState({
    all: { count: 0, amount: 0 },
    group: { count: 0, amount: 0 },
    personal: { count: 0, amount: 0 },
    msme: { count: 0, amount: 0 },
    product: { count: 0, amount: 0 },
  });
  const [totalDue, setTotalDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Quick Collect Modal
  const [collectModal, setCollectModal] = useState(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [submitting, setSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState({ text: '', type: '' });

  // Barcode / QR Modal
  const [barcodeModal, setBarcodeModal] = useState(null);

  // Sunday and Holiday lock (Point 23)
  const isSunday = new Date().getDay() === 0;

  const fetchDues = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.employeeApp.todayDueList({
        date,
        category: selectedCategory,
      });
      setDues(data.items || []);
      setTotalDue(data.totalDue || 0);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch due collection list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDues();
  }, [date, selectedCategory]);

  const filteredItems = dues.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (item.memberName || '').toLowerCase().includes(q) ||
      (item.memberCode || '').toLowerCase().includes(q) ||
      (item.loanId || '').toLowerCase().includes(q) ||
      (item.groupName || '').toLowerCase().includes(q)
    );
  });

  const handleOpenCollect = (item) => {
    setCollectModal(item);
    setCollectAmount(item.dueAmount || item.installmentAmount || '');
    setPaymentMode('cash');
    setActionMessage({ text: '', type: '' });
  };

  const handleCollectSubmit = async (e) => {
    e.preventDefault();
    if (isSunday) {
      setActionMessage({ text: 'Collections are blocked on Sundays (Weekly Off).', type: 'error' });
      return;
    }
    if (!collectAmount || Number(collectAmount) <= 0) {
      setActionMessage({ text: 'Please enter a valid amount', type: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      if (api.employeeApp.collectTodayDue) {
        await api.employeeApp.collectTodayDue({
          loanPaymentId: collectModal.loanPaymentId,
          loanId: collectModal.loanId,
          memberCode: collectModal.memberCode,
          memberName: collectModal.memberName,
          amount: Number(collectAmount),
          payMode: paymentMode,
        });
      } else if (api.employeeApp.advancePayment) {
        await api.employeeApp.advancePayment({
          loanId: collectModal.loanId,
          memberCode: collectModal.memberCode,
          amount: Number(collectAmount),
          payMode: paymentMode,
        });
      }
      setActionMessage({ text: 'Payment submitted for System/Admin EMI Approval!', type: 'success' });
      setTimeout(() => {
        setCollectModal(null);
        fetchDues();
      }, 1200);
    } catch (err) {
      setActionMessage({ text: err.message || 'Collection failed', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Sunday Block Banner (Point 23) */}
      {isSunday && (
        <div style={{ background: '#fee2e2', border: '1.5px solid #ef4444', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="alert" size={18} />
          <div>
            <div>Sunday Weekly Off — Collections Blocked</div>
            <div style={{ fontSize: '0.74rem', fontWeight: 500, marginTop: 2 }}>Posting EMI collections and Loan Requisitions is strictly blocked on Sundays & Company Holidays.</div>
          </div>
        </div>
      )}

      {/* Date Filter Card */}
      <div className="emp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
            ⏰ {t('todayDue')}
          </h2>
          <span className="emp-badge emp-badge-warning">{filteredItems.length} Due</span>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)' }}>Date:</label>
          <input
            type="date"
            className="emp-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>

        {/* Search Bar */}
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            className="emp-input"
            placeholder="Search by Member, Code, Loan ID, or Group..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 34 }}
          />
          <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--emp-text-muted)' }}>
            <Icon name="search" size={16} />
          </div>
        </div>

        {/* Category Tabs */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginTop: 12 }}>
          {DUE_CATEGORIES.map((cat) => {
            const count = summary[cat.id]?.count ?? 0;
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 20,
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  border: isSelected ? '1px solid #d97706' : '1px solid var(--emp-border)',
                  background: isSelected ? '#d97706' : '#f8fafc',
                  color: isSelected ? '#fff' : 'var(--emp-text)',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{cat.label}</span>
                <span
                  style={{
                    background: isSelected ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                    color: isSelected ? '#fff' : '#475569',
                    padding: '1px 6px',
                    borderRadius: 10,
                    fontSize: '0.7rem',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Due Summary */}
      <div className="emp-card" style={{ background: 'linear-gradient(135deg, #d97706, #f59e0b)', color: '#fff' }}>
        <div style={{ fontSize: '0.8rem', opacity: 0.9, textTransform: 'uppercase' }}>
          {selectedCategory === 'all' ? 'Total Demand Due' : `${DUE_CATEGORIES.find((c) => c.id === selectedCategory)?.label} Demand`} ({date})
        </div>
        <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: 4 }}>
          ₹{(summary[selectedCategory]?.amount ?? totalDue).toLocaleString('en-IN')}
        </div>
        <div style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: 4 }}>
          {summary[selectedCategory]?.count ?? filteredItems.length} installments due
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>
          Loading due installments...
        </div>
      ) : error ? (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px', borderRadius: 8, fontSize: '0.85rem' }}>
          {error}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="emp-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🎉</div>
          <div style={{ fontWeight: 600 }}>No dues pending for this category/date</div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>All scheduled installments are collected.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredItems.map((d, idx) => (
            <div key={d.loanId + '-' + d.memberCode + '-' + idx} className="emp-card" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--emp-text)' }}>
                      {d.memberName}
                    </div>
                    {d.category && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: d.category === 'group' ? '#e0f2fe' : d.category === 'personal' ? '#fef3c7' : d.category === 'msme' ? '#dcfce7' : '#f3e8ff',
                          color: d.category === 'group' ? '#0369a1' : d.category === 'personal' ? '#b45309' : d.category === 'msme' ? '#15803d' : '#7e22ce',
                        }}
                      >
                        {d.category}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Code: <strong>{d.memberCode}</strong> | Group: <strong>{d.groupName}</strong>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Inst #{d.installmentNo} • Due: {d.dueDate} • Mode: {d.mode}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#d97706' }}>
                    ₹{Number(d.dueAmount).toLocaleString('en-IN')}
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
                    <button
                      type="button"
                      className="emp-btn-secondary"
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.72rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      onClick={() => setBarcodeModal(d)}
                      title="View Barcode / QR"
                    >
                      <span style={{ letterSpacing: '-1px', fontWeight: 800 }}>▌│█║</span> Barcode
                    </button>
                    <button
                      className="emp-btn-primary"
                      style={{
                        padding: '4px 12px',
                        fontSize: '0.75rem',
                        background: '#059669',
                        border: 'none',
                      }}
                      onClick={() => handleOpenCollect(d)}
                    >
                      Collect
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Collect Modal */}
      {collectModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div className="emp-card" style={{ maxWidth: 400, width: '100%', margin: 0, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Collect EMI</h3>
              <button
                onClick={() => setCollectModal(null)}
                style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, marginBottom: 14, fontSize: '0.82rem' }}>
              <div><strong>Borrower:</strong> {collectModal.memberName} ({collectModal.memberCode})</div>
              <div><strong>Loan ID:</strong> {collectModal.loanId}</div>
              <div><strong>Standard Due:</strong> ₹{collectModal.dueAmount}</div>
            </div>

            {actionMessage.text && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: '0.82rem',
                  marginBottom: 12,
                  background: actionMessage.type === 'success' ? '#dcfce7' : '#fee2e2',
                  color: actionMessage.type === 'success' ? '#15803d' : '#991b1b',
                }}
              >
                {actionMessage.text}
              </div>
            )}

            <form onSubmit={handleCollectSubmit}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Amount to Collect (₹):
                </label>
                <input
                  type="number"
                  className="emp-input"
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  required
                  min="1"
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Payment Mode:
                </label>
                <select
                  className="emp-input"
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI / Online</option>
                  <option value="bank">Bank Transfer</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="emp-btn-secondary"
                  onClick={() => setCollectModal(null)}
                  style={{ flex: 1 }}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="emp-btn-primary"
                  style={{ flex: 1 }}
                  disabled={submitting || isSunday}
                >
                  {submitting ? 'Collecting...' : isSunday ? 'Blocked on Sundays' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Barcode & QR Code Modal */}
      {barcodeModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => setBarcodeModal(null)}
        >
          <div
            className="emp-card"
            style={{ maxWidth: 380, width: '100%', margin: 0, padding: 20, textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Loan Barcode & Details</h3>
              <button
                type="button"
                onClick={() => setBarcodeModal(null)}
                style={{ background: 'transparent', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Barcode representation */}
            <div style={{ background: '#fff', padding: '16px 10px', borderRadius: 8, border: '1px solid var(--emp-border)', marginBottom: 14 }}>
              <div style={{ fontSize: '2.4rem', letterSpacing: '4px', fontWeight: 900, fontFamily: 'monospace', color: '#111827', userSelect: 'all' }}>
                ▌│█║▌║▌│█║▌
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, letterSpacing: '2px', color: '#111827', marginTop: 4 }}>
                {barcodeModal.loanId || barcodeModal.memberCode}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>
                Member: {barcodeModal.memberCode}
              </div>
            </div>

            <div style={{ textAlign: 'left', fontSize: '0.82rem', background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 16, lineHeight: 1.6 }}>
              <div>Borrower: <strong>{barcodeModal.memberName}</strong></div>
              <div>Group: <strong>{barcodeModal.groupName}</strong></div>
              <div>Installment #{barcodeModal.installmentNo} • Due Date: {barcodeModal.dueDate}</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--emp-primary)', marginTop: 4 }}>
                Amount Due: ₹{Number(barcodeModal.dueAmount).toLocaleString('en-IN')}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="emp-btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setBarcodeModal(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="emp-btn-primary"
                style={{ flex: 1, background: '#059669' }}
                onClick={() => {
                  const it = barcodeModal;
                  setBarcodeModal(null);
                  handleOpenCollect(it);
                }}
              >
                Collect ₹{Number(barcodeModal.dueAmount).toLocaleString('en-IN')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

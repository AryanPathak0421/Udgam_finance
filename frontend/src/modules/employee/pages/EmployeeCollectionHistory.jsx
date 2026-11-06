import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

const CATEGORIES = [
  { id: 'all', label: 'All Collections' },
  { id: 'group', label: 'Group Collection' },
  { id: 'personal', label: 'Personal Loan' },
  { id: 'msme', label: 'MSME Loan' },
  { id: 'product', label: 'Product Collection' },
];

export default function EmployeeCollectionHistory() {
  const { t } = useEmployeeApp();
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collections, setCollections] = useState([]);
  const [summary, setSummary] = useState({
    all: { count: 0, amount: 0 },
    group: { count: 0, amount: 0 },
    personal: { count: 0, amount: 0 },
    msme: { count: 0, amount: 0 },
    product: { count: 0, amount: 0 },
  });
  const [totalAmount, setTotalAmount] = useState(0);

  const fetchHistory = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.employeeApp.collectionHistory({
        date,
        category: selectedCategory,
      });
      setCollections(data.items || []);
      setTotalAmount(data.totalAmount || 0);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch collection history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [date, selectedCategory]);

  const filteredItems = collections.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (item.memberName || '').toLowerCase().includes(q) ||
      (item.memberCode || '').toLowerCase().includes(q) ||
      (item.receiptNo || '').toLowerCase().includes(q) ||
      (item.loanId || '').toLowerCase().includes(q) ||
      (item.group || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="emp-page-container">
      {/* Header filter card */}
      <div className="emp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="cash" size={20} style={{ color: 'var(--emp-primary)' }} />
            <span>{t('collectionHistory')}</span>
          </h2>
          <span className="emp-badge emp-badge-info">{filteredItems.length} Receipts</span>
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
            placeholder="Search by Member, Code, Loan ID, or Receipt..."
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
          {CATEGORIES.map((cat) => {
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
                  border: isSelected ? '1px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                  background: isSelected ? 'var(--emp-primary)' : '#f8fafc',
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

      {/* Summary card */}
      <div className="emp-card" style={{ background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff' }}>
        <div style={{ fontSize: '0.8rem', opacity: 0.9, textTransform: 'uppercase' }}>
          {selectedCategory === 'all' ? 'Total Collected' : `${CATEGORIES.find((c) => c.id === selectedCategory)?.label} Total`} ({date})
        </div>
        <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: 4 }}>
          ₹{(summary[selectedCategory]?.amount ?? totalAmount).toLocaleString('en-IN')}
        </div>
        <div style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: 4 }}>
          {summary[selectedCategory]?.count ?? filteredItems.length} transactions recorded
        </div>
      </div>

      {/* List of collections */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>
          Loading collection history...
        </div>
      ) : error ? (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px', borderRadius: 8, fontSize: '0.85rem' }}>
          {error}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="emp-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
          <div style={{ color: 'var(--emp-text-muted)', marginBottom: 8 }}><Icon name="folder" size={40} /></div>
          <div style={{ fontWeight: 600 }}>No collections found</div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Try changing the date, search query, or category tab.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredItems.map((c) => (
            <div key={c.id || c._id} className="emp-card" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--emp-text)' }}>
                      {c.memberName || 'Member'}
                    </div>
                    {c.category && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: c.category === 'group' ? '#e0f2fe' : c.category === 'personal' ? '#fef3c7' : c.category === 'msme' ? '#dcfce7' : '#f3e8ff',
                          color: c.category === 'group' ? '#0369a1' : c.category === 'personal' ? '#b45309' : c.category === 'msme' ? '#15803d' : '#7e22ce',
                        }}
                      >
                        {c.category}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Code: <strong>{c.memberCode || 'N/A'}</strong> | Group: <strong>{c.group || 'Individual'}</strong>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Rcpt: {c.receiptNo || 'N/A'} • Loan: {c.loanId || 'N/A'} • {c.time}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#059669' }}>
                    ₹{Number(c.amount).toLocaleString('en-IN')}
                  </div>
                  <span className="emp-badge emp-badge-success" style={{ marginTop: 4, textTransform: 'uppercase', fontSize: '0.68rem' }}>
                    {c.payMode || 'cash'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

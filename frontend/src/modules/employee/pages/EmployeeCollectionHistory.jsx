import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeCollectionHistory() {
  const { t } = useEmployeeApp();
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collections, setCollections] = useState([]);
  const [totalAmount, setTotalAmount] = useState(0);

  const fetchHistory = async (selectedDate) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.employeeApp.collectionHistory(selectedDate);
      setCollections(data.items || []);
      setTotalAmount(data.totalAmount || 0);
    } catch (err) {
      setError(err.message || 'Failed to fetch collection history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory(date);
  }, [date]);

  return (
    <div className="emp-page-container">
      {/* Header filter card */}
      <div className="emp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="cash" size={20} style={{ color: 'var(--emp-primary)' }} />
            <span>{t('collectionHistory')}</span>
          </h2>
          <span className="emp-badge emp-badge-info">{collections.length} Receipts</span>
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

      {/* Summary card */}
      <div className="emp-card" style={{ background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff' }}>
        <div style={{ fontSize: '0.8rem', opacity: 0.9, textTransform: 'uppercase' }}>
          Total Collected ({date})
        </div>
        <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: 4 }}>
          ₹{Number(totalAmount).toLocaleString('en-IN')}
        </div>
        <div style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: 4 }}>
          Across {collections.length} members
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
      ) : collections.length === 0 ? (
        <div className="emp-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
          <div style={{ color: 'var(--emp-text-muted)', marginBottom: 8 }}><Icon name="folder" size={40} /></div>
          <div style={{ fontWeight: 600 }}>No collections found for this date</div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Change date or record a new collection.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {collections.map((c) => (
            <div key={c.id || c._id} className="emp-card" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--emp-text)' }}>
                    {c.memberName || 'Member'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Code: <strong>{c.memberCode || 'N/A'}</strong> | Group: <strong>{c.groupName || 'General'}</strong>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Rcpt: {c.receiptNo || 'N/A'} • {c.time || (c.createdAt ? new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#059669' }}>
                    +₹{Number(c.amount || 0).toLocaleString('en-IN')}
                  </div>
                  <span className="emp-badge emp-badge-success" style={{ marginTop: 4, textTransform: 'capitalize' }}>
                    {c.paymentMode || 'Cash'}
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


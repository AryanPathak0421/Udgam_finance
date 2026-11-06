import { useState, useEffect } from 'react';
import { api } from '../../../api/client.js';
import { useEmpApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeNotifications() {
  const { fetchNotifications } = useEmpApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'broadcasts' | 'direct'

  const loadNotifs = async () => {
    setLoading(true);
    try {
      const res = await api.employeeApp.notifications();
      setItems(res.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifs();
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await api.employeeApp.markNotificationRead();
      loadNotifs();
      fetchNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkSingle = async (id) => {
    try {
      await api.employeeApp.markNotificationRead(id);
      loadNotifs();
      fetchNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const filtered = items.filter((n) => {
    if (filter === 'broadcasts') return n.isBroadcast;
    if (filter === 'direct') return !n.isBroadcast;
    return true;
  });

  return (
    <div className="emp-page-container">
      {/* Header */}
      <div className="emp-card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 4px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="bell" size={22} style={{ color: 'var(--emp-primary)' }} />
              <span>Notifications & Broadcasts</span>
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: 0 }}>
              Company circulars, management broadcasts, and your personal task alerts.
            </p>
          </div>
          <button
            type="button"
            className="emp-btn-secondary"
            style={{ padding: '6px 12px', fontSize: '0.78rem', fontWeight: 700 }}
            onClick={handleMarkAllRead}
          >
            Mark all read
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={filter === 'all' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '8px', fontSize: '0.82rem', fontWeight: 700 }}
          onClick={() => setFilter('all')}
        >
          All ({items.length})
        </button>
        <button
          type="button"
          className={filter === 'broadcasts' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '8px', fontSize: '0.82rem', fontWeight: 700 }}
          onClick={() => setFilter('broadcasts')}
        >
          Broadcasts ({items.filter((i) => i.isBroadcast).length})
        </button>
        <button
          type="button"
          className={filter === 'direct' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '8px', fontSize: '0.82rem', fontWeight: 700 }}
          onClick={() => setFilter('direct')}
        >
          Direct ({items.filter((i) => !i.isBroadcast).length})
        </button>
      </div>

      {/* List */}
      <div className="emp-card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>
            Loading notifications...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>
            <Icon name="bell" size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div>No notifications in this category.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((n) => (
              <div
                key={n._id || n.id}
                onClick={() => {
                  if (!n.read) handleMarkSingle(n._id || n.id);
                }}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: `1px solid ${n.read ? 'var(--emp-border)' : '#86efac'}`,
                  background: n.read ? 'var(--emp-card-bg)' : '#f0fdf4',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--emp-text)' }}>{n.title}</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {n.isBroadcast && (
                      <span style={{ background: '#e0e7ff', color: '#3730a3', fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: 10 }}>
                        📢 BROADCAST
                      </span>
                    )}
                    {!n.read && (
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                    )}
                  </div>
                </div>

                {n.message && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--emp-text)', marginTop: 6, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                    {n.message}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>
                  <div>{n.createdAt ? new Date(n.createdAt).toLocaleString() : 'Recently'}</div>
                  {n.isBroadcast && n.audience && (
                    <div style={{ textTransform: 'capitalize' }}>Audience: {n.audience.replace(/_/g, ' ')}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

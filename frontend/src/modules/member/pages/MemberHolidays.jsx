import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberHolidays() {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadHolidays();
  }, []);

  async function loadHolidays() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.holidays();
      setHolidays(res.holidays || []);
    } catch (err) {
      setError(err.message || 'Failed to load holiday calendar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0 }}>Holiday Notification</h2>
        <span className="mem-badge active">Calendar</span>
      </div>

      {/* Info notice about EMI collections on holidays */}
      <div
        className="mem-card"
        style={{
          background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
          borderColor: '#bfdbfe',
          borderLeft: '5px solid #2563eb',
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <Icon name="calendar" size={20} style={{ color: '#2563eb', marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#1e3a8a' }}>
              EMI Holiday Policy
            </div>
            <div style={{ fontSize: '0.76rem', color: '#1d4ed8', marginTop: 2, lineHeight: 1.4 }}>
              Branch operations and field EMI collections remain closed on the listed holidays.
              Any EMI falling due on a holiday is collected on the next business day with zero late fee.
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--mem-text-muted)' }}>
          <Icon name="loader" size={26} className="spin" />
          <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Loading holidays…</p>
        </div>
      ) : error ? (
        <div className="mem-alert danger">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      ) : holidays.length === 0 ? (
        <div className="mem-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--mem-text-muted)' }}>
          <Icon name="calendar" size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div style={{ fontWeight: 700 }}>No Upcoming Holidays</div>
          <p style={{ fontSize: '0.78rem', marginTop: 4 }}>All branches are working normally.</p>
        </div>
      ) : (
        <div className="mem-card" style={{ padding: 14 }}>
          <div className="mem-card-title">
            <span>Upcoming Holidays ({holidays.length})</span>
          </div>

          <div>
            {holidays.map((h, idx) => {
              const d = new Date(h.date);
              const dayNum = d.getDate();
              const monthStr = d.toLocaleDateString('en-IN', { month: 'short' });
              const weekdayStr = d.toLocaleDateString('en-IN', { weekday: 'long' });

              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 0',
                    borderBottom: idx !== holidays.length - 1 ? '1px solid var(--mem-border)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div
                      style={{
                        width: 44,
                        height: 48,
                        borderRadius: 10,
                        background: '#eff6ff',
                        border: '1.5px solid #bfdbfe',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#1d4ed8',
                      }}
                    >
                      <span style={{ fontSize: '0.64rem', fontWeight: 800, textTransform: 'uppercase' }}>{monthStr}</span>
                      <span style={{ fontSize: '1.1rem', fontWeight: 900, lineHeight: 1 }}>{dayNum}</span>
                    </div>

                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--mem-text)' }}>
                        {h.name}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--mem-text-muted)' }}>
                        {weekdayStr} &bull; {h.branch ? 'Branch Holiday' : 'Public / National Holiday'}
                      </div>
                    </div>
                  </div>

                  <span className="mem-badge active" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                    Closed
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorAttendance() {
  const [mode, setMode] = useState('personal'); // 'personal' | 'team'
  const [personalList, setPersonalList] = useState([]);
  const [teamList, setTeamList] = useState([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode === 'personal') {
      loadPersonalAttendance();
    } else {
      loadTeamAttendance();
    }
  }, [mode, date]);

  async function loadPersonalAttendance() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.personalAttendance();
      setPersonalList(res.attendance || []);
    } catch (err) {
      setError(err.message || 'Failed to load personal attendance');
    } finally {
      setLoading(false);
    }
  }

  async function loadTeamAttendance() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.teamAttendance({ date });
      setTeamList(res.records || []);
    } catch (err) {
      setError(err.message || 'Failed to load team attendance');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Attendance Records</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Personal & Team-wise Attendance</div>
      </div>

      {/* Mode Switcher */}
      <div style={{ display: 'flex', background: 'var(--sup-border)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.85rem',
            background: mode === 'personal' ? 'var(--sup-card-bg)' : 'transparent',
            color: mode === 'personal' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            boxShadow: mode === 'personal' ? 'var(--sup-shadow)' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setMode('personal')}
        >
          My Attendance
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.85rem',
            background: mode === 'team' ? 'var(--sup-card-bg)' : 'transparent',
            color: mode === 'team' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            boxShadow: mode === 'team' ? 'var(--sup-shadow)' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setMode('team')}
        >
          Team-wise Attendance
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {mode === 'team' && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>Date:</label>
          <input
            type="date"
            className="sup-input"
            style={{ width: 'auto', padding: '6px 10px', fontSize: '0.85rem' }}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading attendance records…
        </div>
      ) : mode === 'personal' ? (
        personalList.length === 0 ? (
          <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
            No personal attendance recorded yet
          </div>
        ) : (
          personalList.map((item, idx) => (
            <div key={item.id || idx} className="sup-card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '0.92rem' }}>{item.date}</strong>
                {item.checkInTime && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>Check-in: {item.checkInTime}</div>
                )}
              </div>
              <span
                style={{
                  background: item.status === 'present' ? 'var(--sup-success-light)' : 'var(--sup-danger-light)',
                  color: item.status === 'present' ? 'var(--sup-success)' : 'var(--sup-danger)',
                  padding: '3px 9px',
                  borderRadius: 10,
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  textTransform: 'capitalize',
                }}
              >
                {item.status}
              </span>
            </div>
          ))
        )
      ) : (
        teamList.length === 0 ? (
          <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
            No staff attendance recorded for selected date
          </div>
        ) : (
          teamList.map((staff) => (
            <div key={staff.id} className="sup-card" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '0.92rem' }}>{staff.name}</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                  {staff.code} • {staff.designation} • {staff.branchName}
                </div>
                {staff.checkIn && staff.checkIn !== '—' && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)' }}>In: {staff.checkIn}</div>
                )}
              </div>
              <span
                style={{
                  background: staff.status === 'present' || staff.status === 'Present' ? 'var(--sup-success-light)' : 'var(--sup-warning-light)',
                  color: staff.status === 'present' || staff.status === 'Present' ? 'var(--sup-success)' : 'var(--sup-warning)',
                  padding: '3px 9px',
                  borderRadius: 10,
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}
              >
                {staff.status}
              </span>
            </div>
          ))
        )
      )}
    </div>
  );
}

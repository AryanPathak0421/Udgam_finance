import React, { useEffect, useState, useRef } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

// Compress image helper
async function compressImageFile(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const elem = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        elem.width = width;
        elem.height = height;
        const ctx = elem.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(elem.toDataURL('image/jpeg', quality));
      };
      img.onerror = (e) => reject(e);
    };
    reader.onerror = (e) => reject(e);
  });
}

export default function SupervisorAttendance() {
  const [mode, setMode] = useState('personal'); // 'personal' | 'team'
  const [personalList, setPersonalList] = useState([]);
  const [teamList, setTeamList] = useState([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // First meeting punch state
  const [photo, setPhoto] = useState('');
  const [punching, setPunching] = useState(false);
  const fileInputRef = useRef(null);

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

  const handlePhotoCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 800, 0.7);
      setPhoto(compressed);
    } catch (err) {
      setError('Could not process photo: ' + err.message);
    }
  };

  const handlePunchAttendance = async () => {
    if (!photo) {
      setError('Live photo is required to mark First Meeting attendance');
      return;
    }
    setPunching(true);
    setError('');
    setSuccess('');

    // Fetch GPS coordinates
    let location = null;
    if (navigator.geolocation) {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
        });
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch {
        // Fallback if permission blocked
      }
    }

    try {
      const res = await api.supervisorApp.markFirstMeetingAttendance({
        photo,
        location,
      });
      setSuccess(res.message || 'First meeting attendance marked successfully!');
      setPhoto('');
      loadPersonalAttendance();
    } catch (err) {
      setError(err.message || 'Failed to punch attendance');
    } finally {
      setPunching(false);
    }
  };

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Attendance Records</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Personal &amp; Team-wise Attendance Tracking</div>
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

      {success && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-success-light)', color: 'var(--sup-success)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="check" size={16} />
          <span>{success}</span>
        </div>
      )}

      {/* First Meeting Attendance Punch Card (Item 18 on sheet) */}
      {mode === 'personal' && (
        <div className="sup-card" style={{ marginBottom: 14, border: '1px solid var(--sup-primary-light)', background: '#f0fdf4' }}>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 800, color: 'var(--sup-primary)' }}>
            📷 First Meeting Attendance (Branch Present)
          </h3>
          <p style={{ margin: '0 0 10px 0', fontSize: '0.78rem', color: 'var(--sup-text-muted)' }}>
            Take a live photo at branch / morning meeting to record your official presence for today.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="user"
            style={{ display: 'none' }}
            onChange={handlePhotoCapture}
          />

          {photo ? (
            <div style={{ textAlign: 'center', marginBottom: 10 }}>
              <img src={photo} alt="Meeting Live" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--sup-primary)' }} />
              <div style={{ marginTop: 6, display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button
                  type="button"
                  className="sup-btn"
                  style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Retake
                </button>
                <button
                  type="button"
                  className="sup-btn sup-btn-primary"
                  style={{ fontSize: '0.78rem', padding: '6px 14px' }}
                  onClick={handlePunchAttendance}
                  disabled={punching}
                >
                  {punching ? 'Recording...' : '✓ Confirm & Punch'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="sup-btn sup-btn-primary"
              style={{ width: '100%', fontSize: '0.85rem', padding: '10px 0' }}
              onClick={() => fileInputRef.current?.click()}
            >
              📷 Capture Live Meeting Photo
            </button>
          )}
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
              </div>
              <span
                style={{
                  background: staff.status === 'present' ? 'var(--sup-success-light)' : staff.status === 'leave' ? '#fef3c7' : 'var(--sup-danger-light)',
                  color: staff.status === 'present' ? 'var(--sup-success)' : staff.status === 'leave' ? '#b45309' : 'var(--sup-danger)',
                  padding: '3px 9px',
                  borderRadius: 10,
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  textTransform: 'capitalize',
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

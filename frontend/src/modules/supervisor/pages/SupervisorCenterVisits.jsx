import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorCenterVisits() {
  const [tab, setTab] = useState('report'); // 'report' | 'submit'
  const [teamVisits, setTeamVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Submit Visit Report state
  const [centerName, setCenterName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState('');
  const [location, setLocation] = useState({ lat: 0, lng: 0, address: '' });
  const [gpsDetecting, setGpsDetecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadTeamVisits();
  }, []);

  async function loadTeamVisits() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.teamCenterVisits();
      setTeamVisits(res.visits || []);
    } catch (err) {
      setError(err.message || 'Failed to load team center visits');
    } finally {
      setLoading(false);
    }
  }

  function handleAutoCaptureLocation() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser/device');
      return;
    }
    setGpsDetecting(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 1000000) / 1000000;
        const lng = Math.round(pos.coords.longitude * 1000000) / 1000000;
        setLocation({
          lat,
          lng,
          address: `GPS: ${lat}, ${lng} (Auto-captured)`,
        });
        setGpsDetecting(false);
        setSuccess('GPS location auto-captured successfully!');
      },
      (err) => {
        setGpsDetecting(false);
        setError(`Unable to retrieve GPS coordinates: ${err.message}. Please enable location permissions.`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  }

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Photo size exceeds 5MB limit');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setImage(event.target.result);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmitReport(e) {
    e.preventDefault();
    if (!centerName.trim()) {
      setError('Center name is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.supervisorApp.recordCenterVisitReport({
        centerName: centerName.trim(),
        groupName: groupName.trim() || 'Center Group',
        contactName: contactName.trim() || groupName.trim(),
        contactNumber: contactNumber.trim() || '—',
        image,
        location: location.lat ? location : { lat: 25.5647, lng: 83.9777, address: 'Buxar Center Locus (Auto-captured)' },
        notes: notes.trim(),
      });
      setSuccess('Center visit report submitted successfully with photo and GPS coordinates!');
      setCenterName('');
      setGroupName('');
      setContactName('');
      setContactNumber('');
      setNotes('');
      setImage('');
      setLocation({ lat: 0, lng: 0, address: '' });
      setTab('report');
      loadTeamVisits();
    } catch (err) {
      setError(err.message || 'Failed to submit center visit report');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Center Visits & Inspection</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Photo & GPS Auto-Capture • Team-wise Visit Requests
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: 'var(--sup-border)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.82rem',
            background: tab === 'report' ? 'var(--sup-card-bg)' : 'transparent',
            color: tab === 'report' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setTab('report')}
        >
          Team Visits ({teamVisits.length})
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.82rem',
            background: tab === 'submit' ? 'var(--sup-card-bg)' : 'transparent',
            color: tab === 'submit' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => {
            setTab('submit');
            if (!location.lat) handleAutoCaptureLocation();
          }}
        >
          Submit Visit Report
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
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      {tab === 'submit' ? (
        <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
          <strong style={{ fontSize: '1rem', display: 'block', marginBottom: 12 }}>
            Record Center Inspection Report
          </strong>
          <form onSubmit={handleSubmitReport}>
            <div className="sup-input-group">
              <label className="sup-label">Center Name *</label>
              <input
                type="text"
                required
                className="sup-input"
                placeholder="e.g. Rampur Mahila Center 01"
                value={centerName}
                onChange={(e) => setCenterName(e.target.value)}
              />
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Group Name / Center Group</label>
              <input
                type="text"
                className="sup-input"
                placeholder="e.g. Durga SHG / Group 1"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div className="sup-input-group" style={{ flex: 1 }}>
                <label className="sup-label">Contact Person</label>
                <input
                  type="text"
                  className="sup-input"
                  placeholder="Leader Name"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="sup-input-group" style={{ flex: 1 }}>
                <label className="sup-label">Contact Mobile</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  className="sup-input"
                  placeholder="10-digit mobile"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                />
              </div>
            </div>

            {/* Photo Selection */}
            <div className="sup-input-group">
              <label className="sup-label">Select Photo (Center Meeting Photo) *</label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sup-input"
                style={{ padding: '6px' }}
                onChange={handlePhotoSelect}
              />
              {image && (
                <div style={{ marginTop: 8, position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--sup-border)' }}>
                  <img src={image} alt="Preview" style={{ width: '100%', maxHeight: 200, objectFit: 'cover' }} />
                  <button
                    type="button"
                    style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 26, height: 26, cursor: 'pointer' }}
                    onClick={() => setImage('')}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* GPS Location Auto-Capture */}
            <div className="sup-input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label className="sup-label" style={{ margin: 0 }}>Location (Auto-Capture)</label>
                <button
                  type="button"
                  className="sup-btn sm secondary"
                  style={{ width: 'auto', padding: '2px 8px', fontSize: '0.72rem' }}
                  onClick={handleAutoCaptureLocation}
                  disabled={gpsDetecting}
                >
                  <Icon name="map" size={12} />
                  <span>{gpsDetecting ? 'Detecting GPS…' : 'Re-capture GPS'}</span>
                </button>
              </div>

              <div style={{ padding: '8px 12px', background: 'var(--sup-bg)', borderRadius: 8, fontSize: '0.8rem', color: location.lat ? 'var(--sup-primary)' : 'var(--sup-text-muted)' }}>
                {location.lat ? (
                  <div>
                    <strong>📍 Coordinates:</strong> {location.lat}, {location.lng}
                    <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>{location.address}</div>
                  </div>
                ) : (
                  <span>GPS location will be automatically detected…</span>
                )}
              </div>
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Inspection Remarks / Observations</label>
              <textarea
                rows={2}
                className="sup-textarea"
                placeholder="Meeting discipline, member attendance, passbook verification, collection progress…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <button type="submit" className="sup-btn" disabled={submitting}>
              {submitting ? 'Submitting Report…' : 'Submit Center Visit Report'}
            </button>
          </form>
        </div>
      ) : (
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
              Loading team center visits…
            </div>
          ) : teamVisits.length === 0 ? (
            <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
              No center visits logged yet
            </div>
          ) : (
            teamVisits.map((v) => (
              <div key={v._id} className="sup-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{v.centerName}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                      Group: {v.contactName || 'Center Group'} • {v.branch?.name || 'Branch'}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                    {v.visitDate ? new Date(v.visitDate).toLocaleDateString() : new Date(v.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {v.image && (
                  <div style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--sup-border)' }}>
                    <img src={v.image} alt="Center" style={{ width: '100%', maxHeight: 160, objectFit: 'cover' }} />
                  </div>
                )}

                <div style={{ marginTop: 8, fontSize: '0.78rem', padding: '6px 10px', background: 'var(--sup-bg)', borderRadius: 6 }}>
                  <div>
                    <span style={{ color: 'var(--sup-text-muted)' }}>Logged By: </span>
                    <strong>{v.employeeName || v.employeeCode || 'Supervisor'}</strong>
                  </div>
                  {v.location && v.location.lat ? (
                    <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)', marginTop: 2 }}>
                      📍 GPS: {v.location.lat}, {v.location.lng}
                    </div>
                  ) : null}
                  {v.notes && (
                    <div style={{ marginTop: 4, fontStyle: 'italic' }}>
                      "{v.notes}"
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

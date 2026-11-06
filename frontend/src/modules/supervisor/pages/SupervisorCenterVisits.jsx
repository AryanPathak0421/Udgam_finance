import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorCenterVisits() {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // New visit modal / form
  const [showForm, setShowForm] = useState(false);
  const [centerName, setCenterName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [mobile, setMobile] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadVisits();
  }, []);

  async function loadVisits() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.centerVisits();
      setVisits(res.visits || []);
    } catch (err) {
      setError(err.message || 'Failed to load center visits');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddVisit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.supervisorApp.recordCenterVisit({
        centerName: centerName.trim(),
        contactPerson: contactPerson.trim(),
        mobile: mobile.trim(),
        remarks: remarks.trim(),
      });
      setSuccess('Center inspection visit recorded successfully!');
      setShowForm(false);
      setCenterName('');
      setContactPerson('');
      setMobile('');
      setRemarks('');
      loadVisits();
    } catch (err) {
      setError(err.message || 'Failed to record center visit');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Center Visits & Inspection</h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Center Meeting Monitoring Logs</div>
        </div>
        <button
          type="button"
          className="sup-btn sm"
          style={{ width: 'auto' }}
          onClick={() => setShowForm(!showForm)}
        >
          <Icon name={showForm ? 'cross' : 'plus'} size={14} />
          <span>{showForm ? 'Cancel' : 'Add Visit'}</span>
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

      {showForm && (
        <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)', marginBottom: 14 }}>
          <strong style={{ fontSize: '1rem', display: 'block', marginBottom: 12 }}>Record Inspection Visit</strong>
          <form onSubmit={handleAddVisit}>
            <div className="sup-input-group">
              <label className="sup-label">Center Name</label>
              <input
                type="text"
                required
                className="sup-input"
                placeholder="e.g. Rampur Mahila Center"
                value={centerName}
                onChange={(e) => setCenterName(e.target.value)}
              />
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Center Leader / Contact Person</label>
              <input
                type="text"
                required
                className="sup-input"
                placeholder="e.g. Kamla Devi"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
              />
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Leader Mobile Number</label>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                required
                className="sup-input"
                placeholder="10-digit mobile"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Meeting Inspection Remarks</label>
              <textarea
                rows={2}
                className="sup-textarea"
                placeholder="Observations on attendance, passbook maintenance, disciplinary conduct…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>

            <button type="submit" className="sup-btn" disabled={busy}>
              {busy ? 'Saving Visit…' : 'Submit Inspection Log'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading inspection logs…
        </div>
      ) : visits.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No center visit records found
        </div>
      ) : (
        visits.map((v) => (
          <div key={v._id} className="sup-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong style={{ fontSize: '0.95rem' }}>{v.centerName}</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                  Leader: {v.contactPerson} • {v.mobile}
                </div>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                {v.date ? new Date(v.date).toLocaleDateString() : ''}
              </span>
            </div>
            {v.remarks && (
              <div style={{ fontSize: '0.8rem', marginTop: 8, padding: '6px 8px', background: 'var(--sup-bg)', borderRadius: 6 }}>
                {v.remarks}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}


import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorResignation() {
  const [tab, setTab] = useState('report'); // 'report' | 'submit'
  const [resignations, setResignations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Submit form state
  const [lastWorkingDate, setLastWorkingDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadResignations();
  }, []);

  async function loadResignations() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.resignationsReport();
      setResignations(res.resignations || []);
    } catch (err) {
      setError(err.message || 'Failed to load resignations report');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Please provide reason for resignation');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.supervisorApp.submitResignation({
        lastWorkingDate,
        reason: reason.trim(),
      });
      setSuccess('Resignation request submitted to Admin & HR successfully.');
      setReason('');
      setTab('report');
      loadResignations();
    } catch (err) {
      setError(err.message || 'Failed to submit resignation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Resignations Portal</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Resignation Submission & Staff Report
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
          Staff Resignations ({resignations.length})
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
          onClick={() => setTab('submit')}
        >
          Submit Resignation
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
        <div className="sup-card" style={{ borderTop: '4px solid var(--sup-danger)' }}>
          <strong style={{ fontSize: '1rem', display: 'block', marginBottom: 12 }}>
            Submit Supervisor Resignation
          </strong>
          <form onSubmit={handleSubmit}>
            <div className="sup-input-group">
              <label className="sup-label">Proposed Last Working Date *</label>
              <input
                type="date"
                required
                className="sup-input"
                value={lastWorkingDate}
                onChange={(e) => setLastWorkingDate(e.target.value)}
              />
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Reason for Resignation *</label>
              <textarea
                rows={4}
                required
                className="sup-textarea"
                placeholder="State your clear reason for resignation (career transition, personal, relocated, etc.)…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="sup-btn"
              style={{ background: 'var(--sup-danger)' }}
              disabled={submitting}
            >
              {submitting ? 'Submitting…' : 'Submit Resignation to HR'}
            </button>
          </form>
        </div>
      ) : (
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
              Loading resignations report…
            </div>
          ) : resignations.length === 0 ? (
            <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
              No resignation applications found
            </div>
          ) : (
            resignations.map((r) => {
              const emp = r.employee || {};
              return (
                <div key={r._id} className="sup-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: '0.95rem' }}>{emp.name || r.employeeName}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                        {emp.employeeCode || r.employeeCode} • {r.branch?.name || 'Branch'}
                      </div>
                    </div>
                    <span
                      style={{
                        background: r.status === 'accepted' || r.status === 'approved' ? 'var(--sup-success-light)' : 'var(--sup-warning-light)',
                        color: r.status === 'accepted' || r.status === 'approved' ? 'var(--sup-success)' : 'var(--sup-warning)',
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {r.status || 'Pending'}
                    </span>
                  </div>

                  <div style={{ marginTop: 8, fontSize: '0.82rem', padding: '8px 10px', background: 'var(--sup-bg)', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: 'var(--sup-text-muted)' }}>Applied Date:</span>
                      <strong>{r.appliedOn ? new Date(r.appliedOn).toLocaleDateString() : '—'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: 'var(--sup-text-muted)' }}>Last Working Date:</span>
                      <strong>{r.lastWorkingDate ? new Date(r.lastWorkingDate).toLocaleDateString() : '—'}</strong>
                    </div>
                    {r.reason && (
                      <div style={{ marginTop: 4 }}>
                        <span style={{ color: 'var(--sup-text-muted)' }}>Reason: </span>
                        <span>{r.reason}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}


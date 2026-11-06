import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorLeaveApproval() {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('pending'); // 'pending' | 'approved' | 'rejected'

  // Modal for rejection
  const [selectedLeave, setSelectedLeave] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectDate, setRejectDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadLeaves();
  }, []);

  async function loadLeaves() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.leaves();
      setLeaves(res.leaves || []);
    } catch (err) {
      setError(err.message || 'Failed to load staff leave applications');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(leave) {
    if (!window.confirm(`Approve leave for ${leave.employee?.name || leave.employeeName}?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.supervisorApp.decideLeave(leave._id, { action: 'approved', remark: 'Approved by Supervisor' });
      setSuccess('Leave application approved successfully!');
      loadLeaves();
    } catch (err) {
      setError(err.message || 'Failed to approve leave');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmReject(e) {
    e.preventDefault();
    if (!rejectReason.trim()) {
      setError('Please provide a reason for rejecting the leave');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.supervisorApp.decideLeave(selectedLeave._id, {
        action: 'rejected',
        rejectReason: rejectReason.trim(),
        rejectDate,
      });
      setSuccess('Leave application rejected with rejection date and reason recorded.');
      setSelectedLeave(null);
      setRejectReason('');
      loadLeaves();
    } catch (err) {
      setError(err.message || 'Failed to reject leave');
    } finally {
      setBusy(false);
    }
  }

  const filteredLeaves = leaves.filter((l) => {
    if (filter === 'pending') return l.status === 'pending';
    if (filter === 'approved') return l.status === 'approved';
    return l.status === 'rejected';
  });

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Staff Leave Approvals</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Permission & Leave Decision Portal</div>
      </div>

      {/* Filter Tabs */}
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
            background: filter === 'pending' ? 'var(--sup-card-bg)' : 'transparent',
            color: filter === 'pending' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setFilter('pending')}
        >
          Pending ({leaves.filter((l) => l.status === 'pending').length})
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
            background: filter === 'approved' ? 'var(--sup-card-bg)' : 'transparent',
            color: filter === 'approved' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setFilter('approved')}
        >
          Approved
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
            background: filter === 'rejected' ? 'var(--sup-card-bg)' : 'transparent',
            color: filter === 'rejected' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setFilter('rejected')}
        >
          Rejected
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading leave applications…
        </div>
      ) : filteredLeaves.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No {filter} leave requests found
        </div>
      ) : (
        filteredLeaves.map((leave) => {
          const emp = leave.employee || {};
          return (
            <div key={leave._id} className="sup-card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong style={{ fontSize: '0.95rem' }}>{emp.name || leave.employeeName}</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                    {emp.employeeCode || leave.employeeCode} • {leave.branch?.name || 'Branch'}
                  </div>
                </div>
                <span
                  style={{
                    background: leave.type === 'sick' ? '#fef3c7' : '#e0e7ff',
                    color: leave.type === 'sick' ? '#b45309' : '#3730a3',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {leave.type} Leave
                </span>
              </div>

              <div style={{ marginTop: 10, fontSize: '0.82rem', padding: '8px 10px', background: 'var(--sup-bg)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--sup-text-muted)' }}>Period:</span>
                  <strong>
                    {leave.from ? new Date(leave.from).toLocaleDateString() : ''} to{' '}
                    {leave.to ? new Date(leave.to).toLocaleDateString() : ''} ({leave.days || 1} Days)
                  </strong>
                </div>
                {leave.reason && (
                  <div>
                    <span style={{ color: 'var(--sup-text-muted)' }}>Reason: </span>
                    <span>{leave.reason}</span>
                  </div>
                )}
              </div>

              {leave.status === 'rejected' && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--sup-danger-light)', borderRadius: 8, fontSize: '0.8rem', color: 'var(--sup-danger)' }}>
                  <div><strong>Rejected Date:</strong> {leave.decidedAt ? new Date(leave.decidedAt).toLocaleDateString() : 'Recorded'}</div>
                  <div><strong>Reason:</strong> {leave.rejectReason || 'No remark provided'}</div>
                </div>
              )}

              {leave.status === 'pending' && (
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <button
                    type="button"
                    className="sup-btn sm"
                    style={{ background: 'var(--sup-success)', borderColor: 'var(--sup-success)' }}
                    disabled={busy}
                    onClick={() => handleApprove(leave)}
                  >
                    <Icon name="check" size={14} />
                    <span>Approve</span>
                  </button>
                  <button
                    type="button"
                    className="sup-btn sm secondary"
                    style={{ color: 'var(--sup-danger)', borderColor: 'var(--sup-danger)' }}
                    disabled={busy}
                    onClick={() => {
                      setSelectedLeave(leave);
                      setRejectReason('');
                    }}
                  >
                    <Icon name="cross" size={14} />
                    <span>Reject</span>
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Rejection Modal */}
      {selectedLeave && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--sup-card-bg)', width: '100%', maxWidth: 380, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1.05rem', color: 'var(--sup-danger)' }}>Reject Leave Application</strong>
              <button className="sup-icon-btn" onClick={() => setSelectedLeave(null)}>
                <Icon name="cross" size={16} />
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', marginBottom: 12 }}>
              Staff: <strong>{selectedLeave.employee?.name || selectedLeave.employeeName}</strong>
            </div>

            <form onSubmit={handleConfirmReject}>
              <div className="sup-input-group">
                <label className="sup-label">Rejection Date</label>
                <input
                  type="date"
                  required
                  className="sup-input"
                  value={rejectDate}
                  onChange={(e) => setRejectDate(e.target.value)}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Rejection Reason / Remarks</label>
                <textarea
                  rows={3}
                  required
                  className="sup-textarea"
                  placeholder="Explain why this leave is rejected (e.g. Field audits scheduled, insufficient leave balance)…"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>

              <button type="submit" className="sup-btn" style={{ background: 'var(--sup-danger)' }} disabled={busy}>
                {busy ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

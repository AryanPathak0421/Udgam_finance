import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorLeaveApproval() {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('pending'); // 'pending' | 'approved' | 'rejected'

  // Modal for Leave Decision (with editable dates)
  const [selectedLeave, setSelectedLeave] = useState(null);
  const [decisionAction, setDecisionAction] = useState('approved'); // 'approved' | 'rejected'
  const [editFrom, setEditFrom] = useState('');
  const [editTo, setEditTo] = useState('');
  const [editDays, setEditDays] = useState(1);
  const [decisionRemark, setDecisionRemark] = useState('');
  const [decisionDate, setDecisionDate] = useState(() => new Date().toISOString().slice(0, 10));
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

  function openDecisionModal(leave, action = 'approved') {
    setSelectedLeave(leave);
    setDecisionAction(action);
    const fDate = leave.from ? new Date(leave.from).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const tDate = leave.to ? new Date(leave.to).toISOString().slice(0, 10) : fDate;
    setEditFrom(fDate);
    setEditTo(tDate);
    setEditDays(leave.days || 1);
    setDecisionRemark(action === 'approved' ? 'Approved by Supervisor' : '');
    setDecisionDate(new Date().toISOString().slice(0, 10));
    setError('');
  }

  // Auto-calculate days when dates change
  useEffect(() => {
    if (editFrom && editTo) {
      const d1 = new Date(editFrom);
      const d2 = new Date(editTo);
      if (d2 >= d1) {
        const diff = Math.round((d2 - d1) / (24 * 60 * 60 * 1000)) + 1;
        setEditDays(diff);
      }
    }
  }, [editFrom, editTo]);

  async function handleSubmitDecision(e) {
    e.preventDefault();
    if (!selectedLeave) return;

    if (decisionAction === 'rejected' && !decisionRemark.trim()) {
      setError('Please provide a reason for rejecting the leave');
      return;
    }
    if (new Date(editTo) < new Date(editFrom)) {
      setError('To Date cannot be earlier than From Date');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await api.supervisorApp.decideLeave(selectedLeave._id, {
        action: decisionAction,
        fromDate: editFrom,
        toDate: editTo,
        days: editDays,
        remark: decisionRemark.trim(),
        rejectReason: decisionRemark.trim(),
        decisionDate,
      });
      setSuccess(`Leave application ${decisionAction} with updated dates successfully!`);
      setSelectedLeave(null);
      loadLeaves();
    } catch (err) {
      setError(err.message || 'Failed to submit leave decision');
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
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Permission &amp; Leave Decision Portal</div>
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
                {leave.decisionRemark && (
                  <div style={{ marginTop: 4, color: 'var(--sup-primary)', fontWeight: 600 }}>
                    Decision Note: {leave.decisionRemark}
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
                    onClick={() => openDecisionModal(leave, 'approved')}
                  >
                    <Icon name="check" size={14} />
                    <span>Approve (Edit Dates)</span>
                  </button>
                  <button
                    type="button"
                    className="sup-btn sm secondary"
                    style={{ color: 'var(--sup-danger)', borderColor: 'var(--sup-danger)' }}
                    disabled={busy}
                    onClick={() => openDecisionModal(leave, 'rejected')}
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

      {/* Point 10: Interactive Leave Decision Modal with Editable Dates */}
      {selectedLeave && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--sup-card-bg)', width: '100%', maxWidth: 420, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1.05rem', color: decisionAction === 'approved' ? 'var(--sup-success)' : 'var(--sup-danger)' }}>
                {decisionAction === 'approved' ? 'Approve & Edit Leave Dates' : 'Reject Leave Application'}
              </strong>
              <button className="sup-icon-btn" onClick={() => setSelectedLeave(null)}>
                <Icon name="cross" size={16} />
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', marginBottom: 12, padding: '8px 10px', background: 'var(--sup-bg)', borderRadius: 8 }}>
              Staff: <strong>{selectedLeave.employee?.name || selectedLeave.employeeName}</strong> ({selectedLeave.employee?.employeeCode || selectedLeave.employeeCode})
              <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
                Applied Reason: {selectedLeave.reason || 'N/A'}
              </div>
            </div>

            <form onSubmit={handleSubmitDecision}>
              {/* Decision Toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    border: 'none',
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    background: decisionAction === 'approved' ? 'var(--sup-success)' : 'var(--sup-border)',
                    color: decisionAction === 'approved' ? '#fff' : 'var(--sup-text)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setDecisionAction('approved')}
                >
                  ✓ Approve
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
                    background: decisionAction === 'rejected' ? 'var(--sup-danger)' : 'var(--sup-border)',
                    color: decisionAction === 'rejected' ? '#fff' : 'var(--sup-text)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setDecisionAction('rejected')}
                >
                  ✕ Reject
                </button>
              </div>

              {/* Editable From & To Dates */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="sup-input-group" style={{ flex: 1 }}>
                  <label className="sup-label">From Date (Editable) *</label>
                  <input
                    type="date"
                    required
                    className="sup-input"
                    value={editFrom}
                    onChange={(e) => setEditFrom(e.target.value)}
                  />
                </div>
                <div className="sup-input-group" style={{ flex: 1 }}>
                  <label className="sup-label">To Date (Editable) *</label>
                  <input
                    type="date"
                    required
                    className="sup-input"
                    value={editTo}
                    onChange={(e) => setEditTo(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 12px 0', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--sup-text-muted)' }}>Approved Leave Duration:</span>
                <strong style={{ color: 'var(--sup-primary)' }}>{editDays} Day{editDays === 1 ? '' : 's'}</strong>
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Decision Date</label>
                <input
                  type="date"
                  required
                  className="sup-input"
                  value={decisionDate}
                  onChange={(e) => setDecisionDate(e.target.value)}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">
                  {decisionAction === 'approved' ? 'Approval Remark' : 'Rejection Reason *'}
                </label>
                <textarea
                  rows={2}
                  required={decisionAction === 'rejected'}
                  className="sup-textarea"
                  placeholder={decisionAction === 'approved' ? 'e.g. Leave approved for 2 days due to field schedule' : 'Explain reason for rejection…'}
                  value={decisionRemark}
                  onChange={(e) => setDecisionRemark(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="sup-btn"
                style={{ background: decisionAction === 'approved' ? 'var(--sup-success)' : 'var(--sup-danger)' }}
                disabled={busy}
              >
                {busy ? 'Saving…' : decisionAction === 'approved' ? 'Confirm Approval with Edited Dates' : 'Confirm Rejection'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

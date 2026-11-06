import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorStaffRequisition() {
  const [tab, setTab] = useState('list'); // 'list' | 'create'
  const [requisitions, setRequisitions] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form State
  const [branchId, setBranchId] = useState('');
  const [designation, setDesignation] = useState('Field Officer');
  const [count, setCount] = useState(1);
  const [reason, setReason] = useState('');
  const [experience, setExperience] = useState('1-2 Years');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadRequisitions();
    loadBranches();
  }, []);

  async function loadRequisitions() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.staffRequisitions();
      setRequisitions(res.requisitions || []);
    } catch (err) {
      setError(err.message || 'Failed to load employee requisitions');
    } finally {
      setLoading(false);
    }
  }

  async function loadBranches() {
    try {
      const res = await api.supervisorApp.todayDue();
      if (res.branches) {
        setBranches(res.branches);
        if (res.branches.length > 0) {
          setBranchId(res.branches[0]._id);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!branchId) {
      setError('Please select branch');
      return;
    }
    if (!count || Number(count) < 1) {
      setError('Please specify at least 1 employee needed');
      return;
    }
    if (!reason.trim()) {
      setError('Please provide reason for hiring requisition');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await api.supervisorApp.submitStaffRequisition({
        branchId,
        designation,
        count: Number(count),
        reason: reason.trim(),
        experience,
      });
      setSuccess(res.message || 'Employee requisition submitted to Admin/HR successfully!');
      setReason('');
      setCount(1);
      setTab('list');
      loadRequisitions();
    } catch (err) {
      setError(err.message || 'Failed to submit employee requisition');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Employee Requisition</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Staff Demand & Branch Hiring Requests
        </div>
      </div>

      {/* Mode Tabs */}
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
            background: tab === 'list' ? 'var(--sup-card-bg)' : 'transparent',
            color: tab === 'list' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setTab('list')}
        >
          Requisitions ({requisitions.length})
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
            background: tab === 'create' ? 'var(--sup-card-bg)' : 'transparent',
            color: tab === 'create' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setTab('create')}
        >
          New Requisition
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

      {tab === 'create' ? (
        <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
          <strong style={{ fontSize: '1rem', display: 'block', marginBottom: 12 }}>
            Submit Staff Requisition (Item 30)
          </strong>
          <form onSubmit={handleSubmit}>
            <div className="sup-input-group">
              <label className="sup-label">Branch Name *</label>
              <select
                className="sup-select"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Employee Designation *</label>
              <select
                className="sup-select"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
              >
                <option value="Field Officer">Field Officer (FO)</option>
                <option value="Senior Field Officer">Senior Field Officer</option>
                <option value="Cashier">Cashier</option>
                <option value="Assistant Branch Manager">Assistant Branch Manager</option>
                <option value="Branch Manager">Branch Manager</option>
                <option value="Recovery Specialist">Recovery Specialist</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div className="sup-input-group" style={{ flex: 1 }}>
                <label className="sup-label">How Many Employees *</label>
                <input
                  type="number"
                  min="1"
                  max="25"
                  required
                  className="sup-input"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </div>

              <div className="sup-input-group" style={{ flex: 1 }}>
                <label className="sup-label">Experience Required</label>
                <select
                  className="sup-select"
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                >
                  <option value="Fresher">Fresher</option>
                  <option value="6+ Months">6+ Months</option>
                  <option value="1-2 Years">1-2 Years</option>
                  <option value="3+ Years">3+ Years</option>
                </select>
              </div>
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Reason for Requisition *</label>
              <textarea
                rows={3}
                required
                className="sup-textarea"
                placeholder="Reason (e.g. New center creation, increased portfolio volume, replacement for resigned staff)…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <button type="submit" className="sup-btn" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit Requisition to HR'}
            </button>
          </form>
        </div>
      ) : (
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
              Loading employee requisitions…
            </div>
          ) : requisitions.length === 0 ? (
            <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
              No employee requisitions found
            </div>
          ) : (
            requisitions.map((r) => (
              <div key={r._id} className="sup-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: '0.98rem' }}>{r.reqNo || 'Requisition'}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                      Branch: {r.branch?.name || 'Branch'} • Requested by: {r.requestedByCode || 'Supervisor'}
                    </div>
                  </div>
                  <span
                    style={{
                      background: r.status === 'approved' ? 'var(--sup-success-light)' : r.status === 'rejected' ? 'var(--sup-danger-light)' : 'var(--sup-warning-light)',
                      color: r.status === 'approved' ? 'var(--sup-success)' : r.status === 'rejected' ? 'var(--sup-danger)' : 'var(--sup-warning)',
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
                    <span style={{ color: 'var(--sup-text-muted)' }}>Required Staff Count:</span>
                    <strong>{r.count} Employee(s)</strong>
                  </div>
                  {r.expectedTime && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: 'var(--sup-text-muted)' }}>Required Experience:</span>
                      <strong>{r.expectedTime}</strong>
                    </div>
                  )}
                  {r.reason && (
                    <div style={{ marginTop: 4 }}>
                      <span style={{ color: 'var(--sup-text-muted)' }}>Reason: </span>
                      <span>{r.reason}</span>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)', marginTop: 8, textAlign: 'right' }}>
                  Date: {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}


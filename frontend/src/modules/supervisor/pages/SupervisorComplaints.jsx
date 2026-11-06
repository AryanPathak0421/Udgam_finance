import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorComplaints() {
  const [tab, setTab] = useState('report'); // 'report' | 'submit'
  const [complaints, setComplaints] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Submit form state
  const [branchId, setBranchId] = useState('');
  const [category, setCategory] = useState('field_staff');
  const [callerName, setCallerName] = useState('');
  const [callerMobile, setCallerMobile] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadComplaints();
    loadBranches();
  }, []);

  async function loadComplaints() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.complaintsReport();
      setComplaints(res.complaints || []);
    } catch (err) {
      setError(err.message || 'Failed to load complaints report');
    } finally {
      setLoading(false);
    }
  }

  async function loadBranches() {
    try {
      const res = await api.supervisorApp.todayDue();
      if (res.branches) setBranches(res.branches);
      if (res.branches && res.branches.length > 0) {
        setBranchId(res.branches[0]._id);
      }
    } catch (e) {
      // ignore
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!description.trim()) {
      setError('Please enter complaint description');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.supervisorApp.submitComplaint({
        branchId,
        category,
        callerName: callerName.trim(),
        callerMobile: callerMobile.trim(),
        description: description.trim(),
      });
      setSuccess('Complaint submitted successfully!');
      setDescription('');
      setCallerName('');
      setCallerMobile('');
      setTab('report');
      loadComplaints();
    } catch (err) {
      setError(err.message || 'Failed to submit complaint');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Complaints & Grievances</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Branch-wise Submit & Employee Report
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
          Employee Report ({complaints.length})
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
          Submit Branch Complaint
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
            Submit Complaint for Branch / Staff
          </strong>
          <form onSubmit={handleSubmit}>
            <div className="sup-input-group">
              <label className="sup-label">Target Branch</label>
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
              <label className="sup-label">Category</label>
              <select
                className="sup-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="field_staff">Field Staff Behavior</option>
                <option value="loan_process">Loan Processing / EMI</option>
                <option value="member_dispute">Center Member Dispute</option>
                <option value="cash_mismatch">Cash Collection Mismatch</option>
                <option value="operations">Branch Operational Issue</option>
                <option value="other">Other / General</option>
              </select>
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Reported By / Complainant Name</label>
              <input
                type="text"
                className="sup-input"
                placeholder="Staff, Member, or Leader Name"
                value={callerName}
                onChange={(e) => setCallerName(e.target.value)}
              />
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Contact Mobile Number (10 digits)</label>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                className="sup-input"
                placeholder="10-digit mobile"
                value={callerMobile}
                onChange={(e) => setCallerMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Detailed Complaint Description *</label>
              <textarea
                rows={3}
                required
                className="sup-textarea"
                placeholder="Describe the complaint in detail…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <button type="submit" className="sup-btn" disabled={submitting}>
              {submitting ? 'Submitting Complaint…' : 'Submit Complaint'}
            </button>
          </form>
        </div>
      ) : (
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
              Loading complaints report…
            </div>
          ) : complaints.length === 0 ? (
            <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
              No complaints filed under your supervised branches
            </div>
          ) : (
            complaints.map((c) => (
              <div key={c._id} className="sup-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{c.complaintNo || 'Complaint'}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                      Branch: {c.branch?.name || 'Branch'} • Entered by: {c.enteredByCode || 'Staff'}
                    </div>
                  </div>
                  <span
                    style={{
                      background: c.status === 'resolved' ? 'var(--sup-success-light)' : 'var(--sup-warning-light)',
                      color: c.status === 'resolved' ? 'var(--sup-success)' : 'var(--sup-warning)',
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {c.status || 'Open'}
                  </span>
                </div>

                <div style={{ marginTop: 8, fontSize: '0.82rem', padding: '8px 10px', background: 'var(--sup-bg)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--sup-text-muted)' }}>Category:</span>
                    <strong style={{ textTransform: 'capitalize' }}>{(c.category || '').replace('_', ' ')}</strong>
                  </div>
                  {c.callerName && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ color: 'var(--sup-text-muted)' }}>Complainant:</span>
                      <span>{c.callerName} {c.callerMobile ? `(${c.callerMobile})` : ''}</span>
                    </div>
                  )}
                  <div style={{ marginTop: 4 }}>
                    <span style={{ color: 'var(--sup-text-muted)' }}>Description: </span>
                    <span>{c.description}</span>
                  </div>
                </div>

                <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)', marginTop: 8, textAlign: 'right' }}>
                  Filed on: {c.date ? new Date(c.date).toLocaleDateString() : new Date(c.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

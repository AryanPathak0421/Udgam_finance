import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberComplaints() {
  const [complaints, setComplaints] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showForm, setShowForm] = useState(false);

  // Form fields
  const [category, setCategory] = useState('emi_collection');
  const [loanId, setLoanId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    loadComplaints();
  }, []);

  async function loadComplaints() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.complaints();
      setComplaints(res.complaints || []);
      setLoans(res.loans || []);
      if (res.loans && res.loans.length > 0 && !loanId) {
        setLoanId(res.loans[0].loanId);
      }
    } catch (err) {
      setError(err.message || 'Failed to load complaints');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!subject.trim() || !description.trim()) {
      setError('Please provide both subject and detailed description of your grievance');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.memberApp.submitComplaint({
        category,
        loanId: loanId || undefined,
        subject: subject.trim(),
        description: description.trim(),
      });
      setSuccessMsg(res.message || 'Grievance submitted successfully! Ticket ID assigned.');
      setShowForm(false);
      setSubject('');
      setDescription('');
      await loadComplaints();
    } catch (err) {
      setError(err.message || 'Failed to submit grievance');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0 }}>Grievance & Complaints</h2>
        <span className="mem-badge active">Direct Helpdesk</span>
      </div>

      {error && (
        <div className="mem-alert danger">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="mem-alert success">
          <Icon name="checkcircle" size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Trigger to show form */}
      <div style={{ marginBottom: 16 }}>
        {!showForm ? (
          <button
            type="button"
            className="mem-btn"
            onClick={() => setShowForm(true)}
            style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)' }}
          >
            <Icon name="plus" size={18} />
            <span>Raise New Complaint / Grievance</span>
          </button>
        ) : (
          <div className="mem-card" style={{ borderTop: '4px solid #ef4444' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 800, fontSize: '0.96rem', color: '#b91c1c' }}>
                Register Grievance
              </span>
              <button
                type="button"
                className="mem-btn sm secondary"
                style={{ width: 'auto', padding: '2px 8px', fontSize: '0.72rem' }}
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="mem-input-group">
                <label className="mem-label">Complaint Category *</label>
                <select
                  className="mem-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="emi_collection">EMI Collection Issue</option>
                  <option value="staff_behavior">Staff Misbehavior / Rude Conduct</option>
                  <option value="receipt_issue">Receipt Not Issued / Incorrect Amount</option>
                  <option value="loan_disbursal">Loan Disbursal Delay</option>
                  <option value="security_deposit">Security Deposit & Interest Issue</option>
                  <option value="passbook_discrepancy">Passbook Discrepancy</option>
                  <option value="general">Other / General Grievance</option>
                </select>
              </div>

              {loans.length > 0 && (
                <div className="mem-input-group">
                  <label className="mem-label">Related Loan Account (Optional)</label>
                  <select
                    className="mem-select"
                    value={loanId}
                    onChange={(e) => setLoanId(e.target.value)}
                  >
                    <option value="">General / None</option>
                    {loans.map((l) => (
                      <option key={l.id} value={l.loanId}>
                        {l.schemeName} ({l.loanId})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mem-input-group">
                <label className="mem-label">Subject / Short Summary *</label>
                <input
                  type="text"
                  className="mem-input"
                  placeholder="e.g. Overcharged EMI receipt not received"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                />
              </div>

              <div className="mem-input-group">
                <label className="mem-label">Detailed Description *</label>
                <textarea
                  className="mem-textarea"
                  rows={4}
                  placeholder="Please describe what happened, date, center, and staff involved if applicable…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="mem-btn"
                style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)' }}
                disabled={submitting}
              >
                {submitting ? 'Submitting Grievance…' : 'Submit Grievance'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Complaints List */}
      <div className="mem-card">
        <div className="mem-card-title">
          <span>My Complaints & Tickets ({complaints.length})</span>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--mem-text-muted)' }}>
            <Icon name="loader" size={24} className="spin" />
            <p style={{ marginTop: 8, fontSize: '0.82rem' }}>Loading complaints…</p>
          </div>
        ) : complaints.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--mem-text-muted)', fontSize: '0.84rem' }}>
            <Icon name="checkcircle" size={32} style={{ color: 'var(--mem-primary)', marginBottom: 8 }} />
            <div style={{ fontWeight: 700 }}>No Grievances Filed</div>
            <div style={{ fontSize: '0.76rem', marginTop: 4 }}>
              If you ever face any issues with collection or staff, submit a complaint here for immediate action.
            </div>
          </div>
        ) : (
          <div>
            {complaints.map((c) => {
              const st = c.status?.toLowerCase() || 'pending';
              const badgeClass = st === 'resolved' ? 'completed' : st === 'rejected' ? 'rejected' : 'pending';
              return (
                <div key={c.id || c._id} style={{ padding: '12px 0', borderBottom: '1px solid var(--mem-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)', textTransform: 'uppercase' }}>
                        Ticket #{c.ticketNo || c.complaintNo || 'TKT'} &bull; {new Date(c.createdAt).toLocaleDateString('en-IN')}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--mem-text)', marginTop: 2 }}>
                        {c.subject}
                      </div>
                    </div>
                    <span className={`mem-badge ${badgeClass}`} style={{ textTransform: 'capitalize' }}>
                      {c.status || 'Pending'}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.8rem', color: 'var(--mem-text)', margin: '6px 0 8px', lineHeight: 1.4 }}>
                    {c.description}
                  </p>

                  {c.resolutionRemarks && (
                    <div
                      style={{
                        background: '#f0fdf4',
                        borderLeft: '3px solid #10b981',
                        padding: '6px 10px',
                        borderRadius: 6,
                        fontSize: '0.74rem',
                        color: '#065f46',
                      }}
                    >
                      <strong>Resolution:</strong> {c.resolutionRemarks}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


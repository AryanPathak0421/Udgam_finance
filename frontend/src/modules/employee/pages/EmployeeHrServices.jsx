import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeHrServices() {
  const { t } = useEmployeeApp();
  const [section, setSection] = useState('leave'); // 'leave' | 'complaint' | 'resign' | 'transfer'

  // Branches for transfer
  const [branches, setBranches] = useState([]);

  // Leave state
  const [leaveData, setLeaveData] = useState(null);
  const [leaveForm, setLeaveForm] = useState({ type: 'casual', from: '', to: '', reason: '' });
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);

  // Complaint state
  const [complaints, setComplaints] = useState([]);
  const [complaintForm, setComplaintForm] = useState({ category: 'other', description: '', loanId: '' });
  const [complaintSubmitting, setComplaintSubmitting] = useState(false);

  // Resignation state
  const [resignation, setResignation] = useState(null);
  const [resignForm, setResignForm] = useState({ lastWorkingDate: '', reason: '' });
  const [resignSubmitting, setResignSubmitting] = useState(false);

  // Transfer state
  const [transfers, setTransfers] = useState([]);
  const [transferForm, setTransferForm] = useState({ targetBranchId: '', reason: '' });
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  const [message, setMessage] = useState({ text: '', type: '' });

  // Load branches
  useEffect(() => {
    api.employeeApp.transferRequests()
      .then((res) => {
        if (res.branches && res.branches.length > 0) {
          setBranches(res.branches);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch Leaves
  const fetchLeaves = async () => {
    try {
      const res = await api.employeeApp.leaveOverview();
      setLeaveData(res);
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch Complaints
  const fetchComplaints = async () => {
    try {
      const res = await api.employeeApp.myComplaints();
      setComplaints(res.items || []);
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch Resignation
  const fetchResignation = async () => {
    try {
      const res = await api.employeeApp.resignationStatus();
      setResignation(res.item);
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch Transfers
  const fetchTransfers = async () => {
    try {
      const res = await api.employeeApp.transferRequests();
      setTransfers(res.items || []);
      if (res.branches && res.branches.length > 0) {
        setBranches(res.branches);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    setMessage({ text: '', type: '' });
    if (section === 'leave') fetchLeaves();
    if (section === 'complaint') fetchComplaints();
    if (section === 'resign') fetchResignation();
    if (section === 'transfer') fetchTransfers();
  }, [section]);

  // Leave Submit
  const handleApplyLeave = async (e) => {
    e.preventDefault();
    setLeaveSubmitting(true);
    setMessage({ text: '', type: '' });
    try {
      const res = await api.employeeApp.applyLeave(leaveForm);
      setMessage({ text: res.message, type: 'success' });
      setLeaveForm({ type: 'casual', from: '', to: '', reason: '' });
      fetchLeaves();
    } catch (err) {
      setMessage({ text: err.message || 'Leave apply failed', type: 'error' });
    } finally {
      setLeaveSubmitting(false);
    }
  };

  // Complaint Submit
  const handleSubmitComplaint = async (e) => {
    e.preventDefault();
    setComplaintSubmitting(true);
    setMessage({ text: '', type: '' });
    try {
      const res = await api.employeeApp.submitComplaint(complaintForm);
      setMessage({ text: res.message, type: 'success' });
      setComplaintForm({ category: 'other', description: '', loanId: '' });
      fetchComplaints();
    } catch (err) {
      setMessage({ text: err.message || 'Complaint failed', type: 'error' });
    } finally {
      setComplaintSubmitting(false);
    }
  };

  // Resignation Submit
  const handleSubmitResign = async (e) => {
    e.preventDefault();
    setResignSubmitting(true);
    setMessage({ text: '', type: '' });
    try {
      const res = await api.employeeApp.submitResignation(resignForm);
      setMessage({ text: res.message, type: 'success' });
      fetchResignation();
    } catch (err) {
      setMessage({ text: err.message || 'Resignation failed', type: 'error' });
    } finally {
      setResignSubmitting(false);
    }
  };

  // Transfer Submit
  const handleSubmitTransfer = async (e) => {
    e.preventDefault();
    setTransferSubmitting(true);
    setMessage({ text: '', type: '' });
    try {
      const res = await api.employeeApp.requestBranchTransfer(transferForm);
      setMessage({ text: res.message, type: 'success' });
      setTransferForm({ targetBranchId: '', reason: '' });
      fetchTransfers();
    } catch (err) {
      setMessage({ text: err.message || 'Transfer request failed', type: 'error' });
    } finally {
      setTransferSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* 4 Tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
        {[
          { id: 'leave', label: 'Leaves', icon: 'calendar' },
          { id: 'complaint', label: 'Complaint', icon: 'alert' },
          { id: 'transfer', label: 'Transfer', icon: 'refresh' },
          { id: 'resign', label: 'Resign', icon: 'logout' },
        ].map((s) => (
          <button
            key={s.id}
            type="button"
            className={section === s.id ? 'emp-btn-primary' : 'emp-btn-secondary'}
            style={{ padding: '8px 4px', fontSize: '0.75rem', fontWeight: 700, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
            onClick={() => setSection(s.id)}
          >
            <Icon name={s.icon} size={15} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {message.text && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            fontSize: '0.85rem',
            marginBottom: 12,
            background: message.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: message.type === 'success' ? '#166534' : '#991b1b',
          }}
        >
          {message.text}
        </div>
      )}

      {/* ---------------- SECTION 1: LEAVE ---------------- */}
      {section === 'leave' && (
        <div>
          {/* Leave Balances Card */}
          {leaveData?.balances && (
            <div className="emp-card" style={{ padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text-muted)', marginBottom: 8 }}>
                LEAVE BALANCES
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ background: '#ecfdf5', border: '1px solid #10b981', padding: 10, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.72rem', color: '#047857' }}>Casual Leave (CL)</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#047857' }}>
                    {leaveData.balances.clBalance} <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>/ {leaveData.balances.clTotal}</span>
                  </div>
                </div>
                <div style={{ background: '#eff6ff', border: '1px solid #3b82f6', padding: 10, borderRadius: 8 }}>
                  <div style={{ fontSize: '0.72rem', color: '#1e40af' }}>Earned Leave (EL)</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e40af' }}>
                    {leaveData.balances.elBalance} <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>/ {leaveData.balances.elTotal}</span>
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#1e40af', marginTop: 2 }}>
                    Opening: {leaveData.balances.elOpening || 0} • Earned: {leaveData.balances.elEarned || 0} • Used: {leaveData.balances.elUsed || 0}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Apply Leave Form */}
          <div className="emp-card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 10px 0' }}>Apply for Leave</h3>
            <form onSubmit={handleApplyLeave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Leave Type</label>
                <select className="emp-input" value={leaveForm.type} onChange={(e) => setLeaveForm({ ...leaveForm, type: e.target.value })}>
                  <option value="casual">Casual Leave (CL)</option>
                  <option value="earned">Earned Leave (EL)</option>
                  <option value="sick">Sick / Medical Leave</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>From Date *</label>
                  <input type="date" className="emp-input" value={leaveForm.from} onChange={(e) => setLeaveForm({ ...leaveForm, from: e.target.value })} required />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>To Date *</label>
                  <input type="date" className="emp-input" value={leaveForm.to} onChange={(e) => setLeaveForm({ ...leaveForm, to: e.target.value })} required />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Reason</label>
                <textarea className="emp-input" rows="2" placeholder="Explain reason" value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} required />
              </div>

              <button type="submit" className="emp-btn-primary" style={{ padding: '10px', fontSize: '0.9rem', fontWeight: 700 }} disabled={leaveSubmitting}>
                {leaveSubmitting ? 'Submitting...' : 'Submit Leave Application'}
              </button>
            </form>
          </div>

          {/* Leave History List */}
          <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 8px 0' }}>Recent Applications</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {leaveData?.leaves?.length === 0 ? (
              <div className="emp-card" style={{ textAlign: 'center', padding: '20px', color: 'var(--emp-text-muted)' }}>No leaves applied yet.</div>
            ) : (
              leaveData?.leaves?.map((l) => (
                <div key={l._id} className="emp-card" style={{ margin: 0, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', textTransform: 'capitalize' }}>
                        {l.type} Leave ({l.days || 1} Days)
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>
                        {new Date(l.from).toLocaleDateString()} — {new Date(l.to).toLocaleDateString()}
                      </div>
                    </div>
                    <span className={`emp-badge ${l.status === 'approved' ? 'emp-badge-success' : l.status === 'rejected' ? 'emp-badge-danger' : 'emp-badge-warning'}`}>
                      {l.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ---------------- SECTION 2: COMPLAINT ---------------- */}
      {section === 'complaint' && (
        <div>
          <div className="emp-card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 10px 0' }}>Register Complaint</h3>
            <form onSubmit={handleSubmitComplaint} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Category</label>
                <select className="emp-input" value={complaintForm.category} onChange={(e) => setComplaintForm({ ...complaintForm, category: e.target.value })}>
                  <option value="loan">Loan issue</option>
                  <option value="emi">EMI / Collection dispute</option>
                  <option value="staff">Staff / Branch coordination</option>
                  <option value="product">Product issue</option>
                  <option value="other">Other grievance</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Loan ID (Optional)</label>
                <input type="text" className="emp-input" placeholder="e.g. LN00123" value={complaintForm.loanId} onChange={(e) => setComplaintForm({ ...complaintForm, loanId: e.target.value })} />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Description *</label>
                <textarea className="emp-input" rows="3" placeholder="Provide full details of the complaint" value={complaintForm.description} onChange={(e) => setComplaintForm({ ...complaintForm, description: e.target.value })} required />
              </div>

              <button type="submit" className="emp-btn-primary" style={{ padding: '10px', fontSize: '0.9rem', fontWeight: 700 }} disabled={complaintSubmitting}>
                {complaintSubmitting ? 'Registering...' : 'Register Complaint'}
              </button>
            </form>
          </div>

          <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 8px 0' }}>My Complaints ({complaints.length})</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {complaints.length === 0 ? (
              <div className="emp-card" style={{ textAlign: 'center', padding: '20px', color: 'var(--emp-text-muted)' }}>No complaints submitted.</div>
            ) : (
              complaints.map((c) => (
                <div key={c._id} className="emp-card" style={{ margin: 0, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.88rem' }}>#{c.complaintNo}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emp-text)', marginTop: 2 }}>{c.description}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>Date: {new Date(c.date).toLocaleDateString()}</div>
                    </div>
                    <span className="emp-badge emp-badge-warning">{c.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ---------------- SECTION 3: RESIGNATION ---------------- */}
      {section === 'resign' && (
        <div className="emp-card">
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="logout" size={18} style={{ color: 'var(--emp-danger)' }} />
            <span>Submit Resignation</span>
          </h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
            Submit your formal resignation to HR Management. Notice period will be calculated as per company policy.
          </p>

          {resignation ? (
            <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', padding: 14, borderRadius: 8, fontSize: '0.85rem' }}>
              <div style={{ fontWeight: 800, color: '#92400e', marginBottom: 4 }}>Resignation on Record</div>
              <div><strong>Status:</strong> {resignation.status?.toUpperCase()}</div>
              <div><strong>Proposed Last Day:</strong> {new Date(resignation.lastWorkingDate).toLocaleDateString()}</div>
              <div><strong>Reason:</strong> {resignation.reason}</div>
            </div>
          ) : (
            <form onSubmit={handleSubmitResign} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Proposed Last Working Date *</label>
                <input type="date" className="emp-input" value={resignForm.lastWorkingDate} onChange={(e) => setResignForm({ ...resignForm, lastWorkingDate: e.target.value })} required />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Reason for Resignation *</label>
                <textarea className="emp-input" rows="3" placeholder="Explain reason" value={resignForm.reason} onChange={(e) => setResignForm({ ...resignForm, reason: e.target.value })} required />
              </div>

              <button type="submit" className="emp-btn-primary" style={{ padding: '12px', background: '#dc2626', fontWeight: 700 }} disabled={resignSubmitting}>
                {resignSubmitting ? 'Submitting...' : 'Submit Resignation Request'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* ---------------- SECTION 4: BRANCH TRANSFER ---------------- */}
      {section === 'transfer' && (
        <div>
          <div className="emp-card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 10px 0' }}>Request Branch Transfer</h3>
            <form onSubmit={handleSubmitTransfer} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Preferred Target Branch *</label>
                <select className="emp-input" value={transferForm.targetBranchId} onChange={(e) => setTransferForm({ ...transferForm, targetBranchId: e.target.value })} required>
                  <option value="">Select Branch</option>
                  {branches.map((b) => (
                    <option key={b.id || b._id} value={b.id || b._id}>{b.name} ({b.city || 'Branch'})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 2 }}>Reason for Transfer</label>
                <textarea className="emp-input" rows="2" placeholder="e.g. Relocation, home proximity, personal reason" value={transferForm.reason} onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })} required />
              </div>

              <button type="submit" className="emp-btn-primary" style={{ padding: '10px', fontSize: '0.9rem', fontWeight: 700 }} disabled={transferSubmitting}>
                {transferSubmitting ? 'Submitting...' : 'Submit Transfer Request'}
              </button>
            </form>
          </div>

          <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 8px 0' }}>Transfer History</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {transfers.length === 0 ? (
              <div className="emp-card" style={{ textAlign: 'center', padding: '20px', color: 'var(--emp-text-muted)' }}>No transfer requests submitted.</div>
            ) : (
              transfers.map((t) => (
                <div key={t._id} className="emp-card" style={{ margin: 0, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.88rem' }}>Ref: #{t.letterNo}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Target: <strong>{t.toBranchName}</strong></div>
                    </div>
                    <span className="emp-badge emp-badge-info">Submitted</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}


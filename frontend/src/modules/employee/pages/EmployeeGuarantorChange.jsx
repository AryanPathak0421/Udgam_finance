import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeGuarantorChange() {
  const { empUser, t } = useEmployeeApp();
  const [tab, setTab] = useState('new'); // 'new' | 'list'
  const [query, setQuery] = useState('');
  const [member, setMember] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form
  const [form, setForm] = useState({
    newGuarantorName: '',
    newGuarantorRelation: '',
    newGuarantorMobile: '',
    newGuarantorAadhaar: '',
    newGuarantorAddress: '',
    reason: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // List of requests
  const [requests, setRequests] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  const fetchRequests = async () => {
    setListLoading(true);
    try {
      const data = await api.employeeApp.guarantorRequests();
      setRequests(data.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'list') {
      fetchRequests();
    }
  }, [tab]);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearchLoading(true);
    setError('');
    setMember(null);
    try {
      const data = await api.employeeApp.memberSynopsis(query.trim());
      setMember(data);
    } catch (err) {
      setError(err.message || 'Member not found');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!member) return;
    if (!form.newGuarantorName.trim()) return setError('Please enter new guarantor name');
    if (!/^\d{10}$/.test(form.newGuarantorMobile)) return setError('Enter valid 10-digit mobile for new guarantor');

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await api.employeeApp.requestGuarantorChange({
        memberId: member.id || member._id,
        ...form,
      });
      setSuccess('Guarantor change request submitted for Branch Manager approval!');
      setForm({
        newGuarantorName: '',
        newGuarantorRelation: '',
        newGuarantorMobile: '',
        newGuarantorAadhaar: '',
        newGuarantorAddress: '',
        reason: '',
      });
      setMember(null);
      setQuery('');
    } catch (err) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecision = async (reqId, decision) => {
    try {
      await api.employeeApp.decideGuarantorRequest(reqId, {
        decision,
        comment: decision === 'approved' ? 'Approved by BM' : 'Rejected by BM',
      });
      fetchRequests();
    } catch (err) {
      alert(err.message || 'Failed to update request');
    }
  };

  const isBranchManager = empUser?.role === 'branch_manager' || empUser?.role === 'admin' || empUser?.role === 'super_admin';

  return (
    <div className="emp-page-container">
      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={tab === 'new' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          onClick={() => setTab('new')}
        >
          <Icon name="plus" size={15} /> Change Request
        </button>
        <button
          type="button"
          className={tab === 'list' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          onClick={() => setTab('list')}
        >
          <Icon name="file" size={15} /> Status & History
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
          {success}
        </div>
      )}

      {tab === 'new' && (
        <>
          {/* Member Search Card */}
          <div className="emp-card">
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 10px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="users" size={20} style={{ color: 'var(--emp-primary)' }} /> {t('guarantorChange')}
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
              Search member to change their guarantor. All guarantor changes require Branch Manager approval before updating the Member Joining Report.
            </p>

            <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                className="emp-input"
                placeholder="Member Code, Phone, or Aadhaar..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="emp-btn-primary" style={{ padding: '0 16px' }} disabled={searchLoading}>
                {searchLoading ? 'Searching...' : 'Search'}
              </button>
            </form>
          </div>

          {member && (
            <>
              {/* Member & Current Guarantor Overview */}
              <div className="emp-card">
                <div style={{ borderBottom: '1px solid var(--emp-border)', paddingBottom: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)' }}>Selected Member</div>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--emp-text)' }}>{member.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)' }}>
                    Code: <strong>{member.code}</strong> • Branch: {member.branchName || member.branch}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)' }}>Current Guarantor on Record</div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', marginTop: 2 }}>
                    {member.guarantorName || member.guarantor?.name || 'No Guarantor Recorded'}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Relation: {member.guarantorRelation || member.guarantor?.relation || 'N/A'} • Phone: {member.guarantorMobile || member.guarantor?.phone || 'N/A'}
                  </div>
                </div>
              </div>

              {/* New Guarantor Details Form */}
              <div className="emp-card">
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 14px 0', color: 'var(--emp-text)' }}>
                  New Guarantor Information
                </h3>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      New Guarantor Full Name *
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="Enter new guarantor name"
                      value={form.newGuarantorName}
                      onChange={(e) => setForm({ ...form, newGuarantorName: e.target.value })}
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Relationship *
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="e.g. Brother, Uncle"
                        value={form.newGuarantorRelation}
                        onChange={(e) => setForm({ ...form, newGuarantorRelation: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Mobile Number *
                      </label>
                      <input
                        type="tel"
                        className="emp-input"
                        maxLength="10"
                        placeholder="10 digits"
                        value={form.newGuarantorMobile}
                        onChange={(e) => setForm({ ...form, newGuarantorMobile: e.target.value.replace(/\D/g, '') })}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Aadhaar Number (Optional)
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      maxLength="12"
                      placeholder="12 digits"
                      value={form.newGuarantorAadhaar}
                      onChange={(e) => setForm({ ...form, newGuarantorAadhaar: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      New Guarantor Address
                    </label>
                    <textarea
                      className="emp-input"
                      rows="2"
                      placeholder="Village/City, Landmark"
                      value={form.newGuarantorAddress}
                      onChange={(e) => setForm({ ...form, newGuarantorAddress: e.target.value })}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Reason for Guarantor Change *
                    </label>
                    <textarea
                      className="emp-input"
                      rows="2"
                      placeholder="Explain reason (e.g., previous guarantor shifted, deceased, mutual dispute)"
                      value={form.reason}
                      onChange={(e) => setForm({ ...form, reason: e.target.value })}
                      required
                    />
                  </div>

                  <div style={{ background: '#fef3c7', padding: '10px 12px', borderRadius: 8, fontSize: '0.78rem', color: '#92400e', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <Icon name="alertcircle" size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>This request will be sent to the <strong>Branch Manager</strong> for review and digital signature before updating the system.</span>
                  </div>

                  <button
                    type="submit"
                    className="emp-btn-primary"
                    style={{ padding: '12px', fontSize: '0.95rem', fontWeight: 700, marginTop: 4 }}
                    disabled={submitting}
                  >
                    {submitting ? 'Submitting Request...' : 'Submit Change Request'}
                  </button>
                </form>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {listLoading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>
              Loading requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--emp-text-muted)' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: 'rgba(16, 120, 112, 0.08)', color: 'var(--emp-primary)', margin: '0 auto 12px' }}>
                <Icon name="inbox" size={30} />
              </div>
              <div style={{ fontWeight: 600 }}>No guarantor change requests found</div>
            </div>
          ) : (
            requests.map((r) => (
              <div key={r.id || r._id} className="emp-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{r.memberName}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)' }}>
                      Code: {r.memberCode} • Req: {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div>
                    {r.status === 'approved' && (
                      <span className="emp-badge emp-badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="checkcircle" size={12} /> Approved
                      </span>
                    )}
                    {r.status === 'rejected' && (
                      <span className="emp-badge emp-badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="cross" size={12} /> Rejected
                      </span>
                    )}
                    {r.status === 'pending' && (
                      <span className="emp-badge emp-badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="clock" size={12} /> Pending BM
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ background: 'var(--emp-card-bg)', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10, fontSize: '0.8rem', marginBottom: 8 }}>
                  <div><strong>Old:</strong> {r.oldGuarantorName || 'None'}</div>
                  <div style={{ marginTop: 2 }}><strong>New:</strong> {r.newGuarantorName} ({r.newGuarantorRelation}, {r.newGuarantorMobile})</div>
                  {r.reason && <div style={{ marginTop: 2, color: 'var(--emp-text-muted)' }}><strong>Reason:</strong> {r.reason}</div>}
                </div>

                {/* If user is Branch Manager / Admin and status is pending, allow approval */}
                {isBranchManager && r.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      className="emp-btn-primary"
                      style={{ flex: 1, padding: '6px 12px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      onClick={() => handleDecision(r.id || r._id, 'approved')}
                    >
                      <Icon name="checkcircle" size={13} /> Approve (BM)
                    </button>
                    <button
                      type="button"
                      className="emp-btn-secondary"
                      style={{ flex: 1, padding: '6px 12px', fontSize: '0.8rem', color: '#dc2626', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      onClick={() => handleDecision(r.id || r._id, 'rejected')}
                    >
                      <Icon name="cross" size={13} /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}


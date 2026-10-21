import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(String(s).slice(0, 10) + (String(s).length <= 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN') : '—');
const MODE_LABEL = { cash: 'Cash', bank: 'Bank', upi: 'UPI', cheque: 'Cheque' };
const STATUS = { pending: ['Waiting for approval', 'amber'], approved: ['Approved', 'green'], rejected: ['Rejected', 'danger'] };
const Badge = ({ s }) => <span className={`badge ${STATUS[s]?.[1] || 'grey'}`}>{STATUS[s]?.[0] || s}</span>;

/** A list with a status filter, a search box and a branch filter, shared by the two approval pages. */
function useQueue(fetcher) {
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 350);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await fetcher({ branch, status, q })); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [branch, status, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { branches, branch, setBranch, status, setStatus, search, setSearch, data, loading, error, load };
}

function Toolbar({ qu, placeholder }) {
  return (
    <div className="toolbar" style={{ flexWrap: 'wrap' }}>
      {qu.branches.length > 1 && (
        <select value={qu.branch} onChange={(e) => qu.setBranch(e.target.value)} aria-label="Branch">
          <option value="">All branches</option>
          {qu.branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
      )}
      <select value={qu.status} onChange={(e) => qu.setStatus(e.target.value)} aria-label="Status">
        <option value="pending">Waiting for approval</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
        <option value="all">All</option>
      </select>
      <input type="search" placeholder={placeholder} value={qu.search} onChange={(e) => qu.setSearch(e.target.value)} aria-label="Search" style={{ minWidth: 200 }} />
      <button className="btn" onClick={qu.load} disabled={qu.loading}>{qu.loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>
  );
}

function ReasonDialog({ title, subject, onClose, onSend }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    setError('');
    try { await onSend(reason); } catch (err) { setError(err.errors?.reason || err.message); setBusy(false); }
  }
  return (
    <Modal open title={title} onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn danger" onClick={send} disabled={busy}>{busy ? 'Saving…' : 'Reject'}</button></>}>
      <p className="muted">{subject}</p>
      <FormField id="rsn" label="Reason" required error={error}><input id="rsn" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></FormField>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
export function AppUsers() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState({ user: '', note: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await api.app.users()); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function openAdd() {
    setForm({ user: '', note: '' });
    setErrors({});
    setAdding(true);
    try { setStaff((await api.app.staffOptions()).items); } catch (err) { toast.error(err.message); }
  }
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api.app.createUser(form);
      toast.success('The staff member can now use the app');
      setAdding(false);
      load();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally { setBusy(false); }
  }
  async function toggle(a) {
    try { await api.app.setUserStatus(a.id, !a.isActive); toast.success(a.isActive ? 'App access stopped' : 'App access restored'); load(); } catch (err) { toast.error(err.message); }
  }
  async function remove() {
    setBusy(true);
    try { await api.app.removeUser(removing.id); toast.success('App access removed'); setRemoving(null); load(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="App User Creation" description="The staff who may use the mobile app. They sign in to the app with their own login. What they register or collect in the app waits for approval under this section." />
      <div className="panel">
        <div className="toolbar">
          <button className="btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          <button className="btn primary" onClick={openAdd}>Create app user</button>
        </div>
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : !data || data.items.length === 0 ? (
          <EmptyState title="No app user" description="Create an app user to let a staff member use the mobile app." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Employee</th><th>Name</th><th>Role</th><th>Branches</th><th>Note</th><th>Status</th><th>Created</th><th /></tr></thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Employee"><strong>{a.employeeCode}</strong></td>
                    <td data-label="Name">{a.name}<div className="muted small">{a.email}</div></td>
                    <td data-label="Role">{a.role.replace(/_/g, ' ')}</td>
                    <td data-label="Branches">{a.branches.map((b) => b.code).join(', ') || '—'}</td>
                    <td data-label="Note">{a.note || '—'}</td>
                    <td data-label="Status"><span className={`badge ${a.isActive && a.staffActive ? 'green' : 'grey'}`}>{a.isActive ? (a.staffActive ? 'Active' : 'Login stopped') : 'Stopped'}</span></td>
                    <td data-label="Created">{dmy(a.createdAt)}<div className="muted small">{a.createdBy ? `by ${a.createdBy}` : ''}</div></td>
                    <td><div style={{ display: 'flex', gap: 6 }}><button className="btn sm" onClick={() => toggle(a)}>{a.isActive ? 'Stop' : 'Allow'}</button><button className="btn sm danger-outline" onClick={() => setRemoving(a)}>Remove</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={adding} title="Create app user" onClose={() => setAdding(false)} busy={busy}
        footer={<><button className="btn" onClick={() => setAdding(false)} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy || !form.user}>{busy ? 'Saving…' : 'Create'}</button></>}>
        <FormField id="auser" label="Staff member" required error={errors.user} hint="Staff with an active login and an employee code. The app signs in with the same email and password.">
          <select id="auser" value={form.user} onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}>
            <option value="">Select</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.employeeCode} — {s.name} ({s.role.replace(/_/g, ' ')}{s.branches ? `, ${s.branches}` : ''})</option>)}
          </select>
        </FormField>
        <FormField id="anote" label="Note" hint="Optional, for example the phone the app is on"><input id="anote" value={form.note} maxLength={100} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></FormField>
      </Modal>
      <ConfirmDialog open={Boolean(removing)} title="Remove app access?" tone="danger" confirmLabel="Remove" loading={busy} onCancel={() => setRemoving(null)} onConfirm={remove}
        message={removing ? `${removing.employeeCode} ${removing.name} will no longer be an app user. Their earlier submissions stay as they are.` : ''} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
export function MemberApproval() {
  const toast = useToast();
  const qu = useQueue((p) => api.app.memberApprovals(p));
  const [rejecting, setRejecting] = useState(null);
  const [busy, setBusy] = useState('');
  async function approve(m) {
    setBusy(m.id);
    try { await api.app.approveMember(m.id); toast.success(`${m.code} approved`); qu.load(); } catch (err) { toast.error(err.message); } finally { setBusy(''); }
  }
  const items = qu.data?.items || [];
  return (
    <>
      <PageHeader title="Member Joining Approval" description="Members registered in the mobile app. Until the joining is approved no loan can be made for the member." />
      <div className="panel">
        <Toolbar qu={qu} placeholder="Search member" />
        {qu.loading && !qu.data ? <Spinner label="Loading…" /> : qu.error ? <ErrorState message={qu.error} onRetry={qu.load} /> : items.length === 0 ? (
          <EmptyState title="Nothing here" description="No member from the app for this filter." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Member</th><th>Details</th><th>Address</th><th>Branch</th><th>Registered</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id}>
                    <td data-label="Member"><strong>{m.code}</strong> {m.name}<div className="muted small">{m.formId}</div></td>
                    <td data-label="Details">{m.mobile || '—'}<div className="muted small">{m.gender}{m.dob ? ` · born ${dmy(m.dob)}` : ''}{m.husbandName ? ` · ${m.husbandName}` : ''}</div><div className="muted small">Aadhaar {m.aadhaar}</div></td>
                    <td data-label="Address">{m.address}<div className="muted small">{[m.district, m.state, m.pincode].filter(Boolean).join(', ')}</div></td>
                    <td data-label="Branch">{m.branch?.code}</td>
                    <td data-label="Registered">{dmy(m.joiningDate)}<div className="muted small">by {m.registeredBy || '—'}</div></td>
                    <td data-label="Status"><Badge s={m.status} />{m.status !== 'pending' && <div className="muted small">{m.decidedBy}{m.reason ? ` — ${m.reason}` : ''}</div>}</td>
                    <td>{m.status === 'pending' && <div style={{ display: 'flex', gap: 6 }}><button className="btn sm primary" disabled={busy === m.id} onClick={() => approve(m)}>Approve</button><button className="btn sm danger-outline" onClick={() => setRejecting(m)}>Reject</button></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {rejecting && <ReasonDialog title="Reject the joining" subject={`${rejecting.code} ${rejecting.name} will not be able to get a loan.`} onClose={() => setRejecting(null)}
        onSend={async (reason) => { await api.app.rejectMember(rejecting.id, reason); toast.success('Joining rejected'); setRejecting(null); qu.load(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
export function EmiApproval() {
  const toast = useToast();
  const qu = useQueue((p) => api.app.emiApprovals(p));
  const [rejecting, setRejecting] = useState(null);
  const [busy, setBusy] = useState('');
  async function approve(c) {
    setBusy(c.id);
    try { const r = await api.app.approveEmi(c.id); toast.success(`${inr(c.amount)} received — receipt ${r.receiptNo}`); qu.load(); } catch (err) { toast.error(err.message); } finally { setBusy(''); }
  }
  const items = qu.data?.items || [];
  return (
    <>
      <PageHeader title="Loan EMI Collection Approval" description="EMI collected in the mobile app. It counts (cashbook, loan balance) only after it is approved here; then the EMI receipt is made." />
      <div className="panel">
        <Toolbar qu={qu} placeholder="Search loan, member, staff" />
        {qu.loading && !qu.data ? <Spinner label="Loading…" /> : qu.error ? <ErrorState message={qu.error} onRetry={qu.load} /> : items.length === 0 ? (
          <EmptyState title="Nothing here" description="No EMI collection from the app for this filter." />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '8px 0' }}><span>Collections <strong>{qu.data.summary.requests}</strong></span><span>Amount <strong>{inr(qu.data.summary.amount)}</strong></span></div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Loan</th><th>Borrower</th><th>Branch</th><th className="num">Amount</th><th>Collected</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Loan"><strong>{c.loanId}</strong>{c.group && <div className="muted small">{c.group}</div>}</td>
                      <td data-label="Borrower">{c.memberCode} {c.memberName}</td>
                      <td data-label="Branch">{c.branch?.code}</td>
                      <td data-label="Amount" className="num">{inr(c.amount)}{c.installments ? <div className="muted small">{c.installments} installment{c.installments === 1 ? "" : "s"} ({c.type})</div> : null}</td>
                      <td data-label="Collected">{dmy(c.collectedOn)} · {MODE_LABEL[c.payMode] || c.payMode}<div className="muted small">by {c.collectedBy || '—'}{c.reference ? ` · ${c.reference}` : ''}</div></td>
                      <td data-label="Status"><Badge s={c.status} />{c.status === 'approved' && <div className="muted small">{c.receiptNo}</div>}{c.status === 'rejected' && c.reason && <div className="muted small">{c.reason}</div>}</td>
                      <td>{c.status === 'pending' && <div style={{ display: 'flex', gap: 6 }}><button className="btn sm primary" disabled={busy === c.id} onClick={() => approve(c)}>{busy === c.id ? '…' : 'Approve'}</button><button className="btn sm danger-outline" onClick={() => setRejecting(c)}>Reject</button></div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {rejecting && <ReasonDialog title="Reject the collection" subject={`${rejecting.loanId} · ${rejecting.memberCode} · ${inr(rejecting.amount)} collected by ${rejecting.collectedBy}. It will not be received.`} onClose={() => setRejecting(null)}
        onSend={async (reason) => { await api.app.rejectEmi(rejecting.id, reason); toast.success('Collection rejected'); setRejecting(null); qu.load(); }} />}
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const LIMIT = 25;
const REQUESTERS = ['super_admin', 'admin', 'branch_manager', 'accountant'];
const MODE_LABEL = { cash: 'Cash', bank: 'Bank transfer', upi: 'UPI', cheque: 'Cheque' };
const KIND_LABEL = { withdraw: 'Withdrawal', adjust: 'Adjusted against EMI' };
const TONE = { pending: 'grey', awaiting_otp: 'grey', completed: 'green', rejected: 'danger' };
const STAGE_LABEL = { pending: 'Pending admin approval', awaiting_otp: 'Approved — OTP pending', completed: 'Completed', rejected: 'Rejected' };
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(s.length === 10 ? `${s}T00:00:00` : s).toLocaleDateString('en-IN') : '—');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// Branch, from date and to date (and a search) that the two lists share.
function useFilters() {
  const [f, setF] = useState({ branch: '', from: '', to: '', search: '' });
  const [branches, setBranches] = useState([]);
  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);
  return { f, set: (patch) => setF((x) => ({ ...x, ...patch })), branches };
}

function FilterBar({ f, set, branches, children }) {
  const has = f.branch || f.from || f.to || f.search;
  return (
    <div className="toolbar" style={{ flexWrap: 'wrap' }}>
      <input type="search" className="toolbar-search" placeholder="Search member code, name or Loan ID" value={f.search} onChange={(e) => set({ search: e.target.value })} aria-label="Search" />
      {branches.length > 1 && (
        <select value={f.branch} onChange={(e) => set({ branch: e.target.value })} aria-label="Branch">
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
      )}
      <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} aria-label="From date" /></label>
      <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} aria-label="To date" /></label>
      {children}
      {has && <button className="btn" onClick={() => set({ branch: '', from: '', to: '', search: '' })}>Clear</button>}
    </div>
  );
}

// ---- Security Deposit List: branch wise, from - to date -------------------------------------------------------------------
export function SecurityDeposits() {
  const { f, set, branches } = useFilters();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(f.search);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.savings.deposits({ page, limit: LIMIT, branch: f.branch, from: f.from, to: f.to, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, f.branch, f.from, f.to, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [f.branch, f.from, f.to, q]);

  return (
    <>
      <PageHeader title="Security Deposit List" description="The security amount kept from each loan when it was paid out. Choose the branch and the from and to dates." />
      <div className="panel">
        <FilterBar f={f} set={set} branches={branches} />
        {data && <div className="muted small" style={{ margin: '6px 0' }}>{data.total} deposit{data.total === 1 ? '' : 's'} from {data.members} member{data.members === 1 ? '' : 's'} · total security {inr(data.totalAmount)}</div>}
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : data.items.length === 0 ? (
          <EmptyState title="No security deposit" description="Security amounts appear here once loans with a security deposit are paid out." />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Date</th><th>Member</th><th>Loan ID</th><th>Branch</th><th>Scheme</th><th className="num">Loan amount</th><th className="num">Security deposit</th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={`${r.loanPaymentId}-${r.code}`}>
                      <td data-label="Date">{dmy(r.date)}</td>
                      <td data-label="Member"><strong>{r.code}</strong> {r.name}{r.group && <div className="muted small">{r.group}</div>}</td>
                      <td data-label="Loan ID">{r.loanId || r.formId}</td>
                      <td data-label="Branch">{r.branch?.name || '—'}</td>
                      <td data-label="Scheme">{r.schemeName}</td>
                      <td data-label="Loan amount" className="num">{inr(r.loanAmount)}</td>
                      <td data-label="Security" className="num"><strong>{inr(r.amount)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}

// ---- Security Withdrawal List: the same filters; the admin approves or rejects here ---------------------------------------
function WithdrawalTable({ approval }) {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const { f, set, branches } = useFilters();
  const canDecide = approval && isAdmin;
  const [status, setStatus] = useState('pending'); // pending | awaiting_otp | completed | rejected | '' (all)
  const [kind, setKind] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState('');
  const [otpFor, setOtpFor] = useState(null);
  const [otpValue, setOtpValue] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpNote, setOtpNote] = useState('');
  const q = useDebounce(f.search);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const stage = status === 'awaiting_otp' || status === 'completed' ? status : undefined;
      setData(await api.savings.withdrawals({ page, limit: LIMIT, status: stage ? undefined : status, stage, kind, branch: f.branch, from: f.from, to: f.to, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, status, kind, f.branch, f.from, f.to, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [status, kind, f.branch, f.from, f.to, q]);

  async function approve(w) {
    setBusy(w.id);
    try {
      const r = await api.savings.approve(w.id);
      toast.success(r.otp?.error ? `Approved, but the OTP could not be sent: ${r.otp.error}. Send it again from the Security Withdrawal List.` : `Approved — an OTP was sent to the member's phone (${r.otp?.sentTo}). The security is released when the OTP is verified.${r.otp?.devOtp ? ` [dev OTP ${r.otp.devOtp}]` : ''}`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  }
  function openOtp(w) { setOtpFor(w); setOtpValue(''); setOtpError(''); setOtpNote(''); }
  async function resendOtp() {
    setBusy(otpFor.id);
    setOtpError('');
    try {
      const r = await api.savings.sendOtp(otpFor.id);
      setOtpNote(`OTP sent to ${r.otp.sentTo}.${r.otp.devOtp ? ` [dev OTP ${r.otp.devOtp}]` : ''}`);
    } catch (err) {
      setOtpError(err.message);
    } finally {
      setBusy('');
    }
  }
  async function verifyOtp() {
    if (!/^\d{6}$/.test(otpValue)) return setOtpError('Enter the 6-digit OTP');
    setBusy(otpFor.id);
    try {
      const r = await api.savings.verifyOtp(otpFor.id, otpValue);
      toast.success(r.withdrawal.kind === 'adjust' ? `OTP verified — EMI receipt ${r.withdrawal.emiReceiptNo}` : 'OTP verified — pay the amount back to the member');
      setOtpFor(null);
      load();
    } catch (err) {
      setOtpError(err.errors?.otp || err.message);
    } finally {
      setBusy('');
    }
  }
  async function reject() {
    if (reason.trim().length < 3) return setReasonError('Enter the reason');
    setBusy(rejecting.id);
    try {
      await api.savings.reject(rejecting.id, reason.trim());
      toast.success('Request rejected');
      setRejecting(null);
      setReason('');
      load();
    } catch (err) {
      setReasonError(err.errors?.reason || err.message);
    } finally {
      setBusy('');
    }
  }

  const tab = (key, label) => <button key={key} className={`btn sm${status === key ? ' primary' : ''}`} onClick={() => setStatus(key)}>{label}{key === 'pending' && data ? ` (${data.pending})` : ''}{key === 'awaiting_otp' && data?.awaitingOtp ? ` (${data.awaitingOtp})` : ''}</button>;
  return (
    <>
      <PageHeader
        title={approval ? 'Security Approval' : 'Security Withdrawal List'}
        description={approval ? 'Requests to withdraw the security or adjust it against an EMI. Check the request, the security left and the EMI due, then approve or reject. After you approve, an OTP goes to the member and the security is released when the OTP is verified.' : 'Requests to withdraw the security or adjust it against an EMI, with their status. The admin approves them under Security Approval; then the member\'s OTP is verified here and the security is released.'}
      />
      <div className="panel">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {tab('pending', approval ? 'Pending approval' : 'Pending admin approval')}{tab('awaiting_otp', 'Approved — OTP pending')}{tab('completed', 'Completed')}{tab('rejected', 'Rejected')}{tab('', 'All')}
        </div>
        <FilterBar f={f} set={set} branches={branches}>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
            <option value="">Withdrawal and adjustment</option>
            <option value="withdraw">Withdrawal</option>
            <option value="adjust">Adjusted against EMI</option>
          </select>
        </FilterBar>
        {data && <div className="muted small" style={{ margin: '6px 0' }}>{data.total} request{data.total === 1 ? '' : 's'} · total {inr(data.totalAmount)}</div>}
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : data.items.length === 0 ? (
          <EmptyState title="No security withdrawal" description={status === 'pending' ? 'Nothing is waiting for approval.' : status === 'awaiting_otp' ? 'No approved request is waiting for the member\'s OTP.' : 'No request matches these filters.'} />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Request</th><th>Date</th><th>Member</th><th>Branch</th><th>Type</th><th className="num">Amount</th><th>Status</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {data.items.map((w) => (
                    <tr key={w.id}>
                      <td data-label="Request"><strong>{w.receiptNo}</strong></td>
                      <td data-label="Date">{dmy(w.requestedOn)}{w.requestedByCode && <div className="muted small">by {w.requestedByCode}</div>}</td>
                      <td data-label="Member"><strong>{w.memberCode}</strong> {w.memberName}</td>
                      <td data-label="Branch">{w.branch?.name || '—'}</td>
                      <td data-label="Type">
                        {KIND_LABEL[w.kind]}
                        {w.kind === 'adjust' && <div className="muted small">Loan {w.loanId}{w.emiReceiptNo ? ` · ${w.emiReceiptNo}` : ''}</div>}
                        {w.kind === 'withdraw' && w.payMode && <div className="muted small">{MODE_LABEL[w.payMode]}{w.reference ? ` · ${w.reference}` : ''}</div>}
                        {w.remark && <div className="muted small">{w.remark}</div>}
                        {w.status === 'pending' && w.info && (
                          <div className="small" style={{ marginTop: 4 }}>
                            Request {inr(w.info.requested)} of the security {inr(w.info.securityLeft)} ({inr(w.info.staysAfter)} stays)
                            {w.kind === 'adjust' && w.info.emiDue !== undefined && (
                              <> · EMI due {inr(w.info.emiDue)} (left {inr(w.info.emiLeft)}){w.info.emiDue > 0 ? " → " + inr(Math.min(w.amount, w.info.emiDue)) + " of the due EMI is covered" + (w.info.emiDue - w.amount > 0 ? ", " + inr(w.info.emiDue - w.amount) + " stays due" : "") : ""}</>
                            )}
                          </div>
                        )}
                      </td>
                      <td data-label="Amount" className="num"><strong>{inr(w.amount)}</strong></td>
                      <td data-label="Status">
                        <span className={`badge ${TONE[w.stage]}`}>{STAGE_LABEL[w.stage]}</span>
                        {w.status === 'rejected' && <div className="muted small">{w.rejectReason}</div>}
                        {w.decidedByCode && <div className="muted small">approved/decided by {w.decidedByCode}</div>}
                        {w.stage === 'completed' && w.completedByCode && <div className="muted small">OTP verified · {w.completedByCode}</div>}
                      </td>
                      <td data-label="Actions" className="actions-col">
                        {canDecide && w.status === 'pending' ? (
                          <div className="row-actions">
                            <button className="btn sm primary" disabled={busy === w.id} onClick={() => approve(w)}>Approve</button>
                            <button className="btn sm danger-outline" disabled={busy === w.id} onClick={() => { setRejecting(w); setReason(''); setReasonError(''); }}>Reject</button>
                          </div>
                        ) : w.stage === 'awaiting_otp' && !approval && REQUESTERS.includes(user?.role) ? (
                          <div className="row-actions">
                            <button className="btn sm primary" onClick={() => openOtp(w)}>Verify OTP</button>
                            {isAdmin && <button className="btn sm danger-outline" disabled={busy === w.id} onClick={() => { setRejecting(w); setReason(''); setReasonError(''); }}>Reject</button>}
                          </div>
                        ) : <span className="muted">{w.stage === 'pending' ? 'Waiting for admin' : w.stage === 'awaiting_otp' ? 'Waiting for the member\'s OTP' : '—'}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>
      {otpFor && (
        <Modal open title={`Verify OTP — ${otpFor.receiptNo}`} onClose={() => setOtpFor(null)} busy={Boolean(busy)}
          footer={<><button className="btn" onClick={() => setOtpFor(null)}>Close</button><button className="btn primary" onClick={verifyOtp} disabled={Boolean(busy)}>{otpFor.kind === 'adjust' ? 'Verify and adjust the EMI' : 'Verify and release the security'}</button></>}>
          <p style={{ marginTop: 0 }}>{otpFor.memberCode} {otpFor.memberName} · {KIND_LABEL[otpFor.kind]} · <strong>{inr(otpFor.amount)}</strong>. Ask the member for the 6-digit OTP sent to the registered phone.</p>
          <FormField id="otpv" label="OTP" required error={otpError}>
            <input id="otpv" inputMode="numeric" maxLength={6} autoFocus value={otpValue} onChange={(e) => { setOtpValue(e.target.value.replace(/\D/g, '')); setOtpError(''); }} />
          </FormField>
          <button type="button" className="link-btn" disabled={Boolean(busy)} onClick={resendOtp}>Send the OTP again</button>
          {otpNote && <div className="muted small" style={{ marginTop: 6 }}>{otpNote}</div>}
        </Modal>
      )}
      {rejecting && (
        <Modal open title={`Reject ${rejecting.receiptNo}?`} onClose={() => setRejecting(null)} busy={Boolean(busy)}
          footer={<><button className="btn" onClick={() => setRejecting(null)}>Keep</button><button className="btn danger-outline" onClick={reject} disabled={Boolean(busy)}>Reject request</button></>}>
          <FormField id="rj" label="Reason for rejection" required error={reasonError}>
            <input id="rj" value={reason} maxLength={200} autoFocus onChange={(e) => { setReason(e.target.value); setReasonError(''); }} />
          </FormField>
        </Modal>
      )}
    </>
  );
}

export const SecurityWithdrawals = () => <WithdrawalTable approval={false} />;
export const SecurityApproval = () => <WithdrawalTable approval />;

// ---- Security Withdrawal: search the member code, choose one (adjust the EMI / withdraw), send for admin approval -----------
export function SecurityWithdraw() {
  const { user } = useAuth();
  const toast = useToast();
  const canRequest = REQUESTERS.includes(user?.role);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState(null); // savings of the chosen member
  const [error, setError] = useState('');
  const [kind, setKind] = useState('adjust');
  const [form, setForm] = useState({ amount: '', loan: '', payMode: 'cash', reference: '', remark: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    if (member || q.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let live = true;
    setSearching(true);
    api.members.list({ q: q.trim(), limit: 10 }).then((r) => live && setResults(r.items)).catch(() => live && setResults([])).finally(() => live && setSearching(false));
    return () => {
      live = false;
    };
  }, [q, member]);

  async function open(id) {
    setError('');
    try {
      const d = await api.savings.member(id);
      setMember(d);
      const open = d.loans.filter((l) => l.open && !l.settled);
      setForm({ amount: '', loan: open[0]?.id || '', payMode: 'cash', reference: '', remark: '' });
      setKind(open.length ? 'adjust' : d.withdrawable >= 1 ? 'withdraw' : 'adjust');
      setErrors({});
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    }
  }

  async function send() {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.savings.request({ member: member.member.id, kind, amount: form.amount, loan: kind === 'adjust' ? form.loan : undefined, payMode: kind === 'withdraw' ? form.payMode : undefined, reference: form.reference, remark: form.remark });
      toast.success(`Request ${r.withdrawal.receiptNo} for ${inr(r.withdrawal.amount)} sent to the admin for approval`);
      await open(member.member.id);
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const openLoans = member ? member.loans.filter((l) => l.open && !l.settled) : [];
  const chosenLoan = openLoans.find((l) => l.id === form.loan);
  // Adjust EMI: what the security can cover = the smaller of the security left and the EMI due (or the EMI left when nothing is due).
  const emiDue = chosenLoan ? (chosenLoan.due > 0 ? chosenLoan.due : chosenLoan.outstanding) : 0;
  const adjustable = member ? Math.round(Math.min(member.available, emiDue) * 100) / 100 : 0;
  const typed = Number(form.amount) || 0;

  return (
    <>
      <PageHeader title="Security Withdrawal" description="Search the member code to see the security amount. Choose one: adjust it against an EMI, or withdraw it. The admin has to approve it." />
      {!member ? (
        <div className="panel">
          <div className="toolbar">
            <input type="search" className="toolbar-search" placeholder="Search by member code, name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search member" />
          </div>
          {error && <ErrorState message={error} />}
          {q.trim().length < 2 ? <EmptyState title="Search a member" description="Type the member code (for example MEM000001), name or mobile." /> : searching && !results.length ? <Spinner label="Searching…" /> : results.length === 0 ? (
            <EmptyState title="No member found" description="Try the member code." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Member code</th><th>Name</th><th>Branch</th><th>Mobile</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {results.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Code"><strong>{m.code}</strong></td>
                      <td data-label="Name">{m.name}</td>
                      <td data-label="Branch">{m.branch?.name || '—'}</td>
                      <td data-label="Mobile">{m.mobile}</td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm primary" onClick={() => open(m.id)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 10 }}><button className="btn" onClick={() => setMember(null)}>← Search another member</button></div>
          <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
            <h3 className="section-title">{member.member.code} — {member.member.name} {member.member.isBlocked && <span className="badge danger">Blocked</span>}</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              <span className="badge grey">Security deposited {inr(member.deposited)}</span>
              <span className="badge grey">Withdrawn / adjusted {inr(member.withdrawn)}</span>
              {member.pending > 0 && <span className="badge grey">Waiting for approval {inr(member.pending)}</span>}
              <span className="badge green">Available {inr(member.available)}</span>
            </div>
            {member.deposits.length === 0 ? <span className="muted">No security amount has been kept from this member's loans.</span> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Loan ID</th><th>Scheme</th><th className="num">Loan amount</th><th className="num">Security</th></tr></thead>
                  <tbody>
                    {member.deposits.map((d) => (
                      <tr key={d.loanPaymentId}>
                        <td data-label="Date">{dmy(d.date)}</td><td data-label="Loan ID">{d.loanId || d.formId}</td><td data-label="Scheme">{d.schemeName}</td>
                        <td data-label="Loan amount" className="num">{inr(d.loanAmount)}</td><td data-label="Security" className="num"><strong>{inr(d.amount)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
            <h3 className="section-title">Withdraw the security</h3>
            {member.member.isBlocked ? <div className="notice warn">This member is blocked. Unblock the member before any withdrawal.</div> : member.available < 1 ? <div className="notice">There is no security amount available to withdraw.</div> : !canRequest ? (
              <div className="muted">You can view the security but not request a withdrawal.</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 18, marginBottom: 10, flexWrap: 'wrap' }} role="radiogroup" aria-label="Choose one">
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" name="kind" checked={kind === 'adjust'} onChange={() => setKind('adjust')} disabled={!openLoans.length} /> Adjust EMI</label>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" name="kind" checked={kind === 'withdraw'} onChange={() => setKind('withdraw')} disabled={member.withdrawable < 1} /> Withdrawal</label>
                </div>
                <div className="form-grid">
                  {kind === 'adjust' && (
                    <FormField id="wloan" label="Loan whose EMI is adjusted" required error={errors.loan} hint={chosenLoan ? `EMI due now ${inr(chosenLoan.due)} · EMI left ${inr(chosenLoan.outstanding)}` : undefined}>
                      <select id="wloan" value={form.loan} onChange={set('loan')}>
                        {openLoans.map((l) => <option key={l.id} value={l.id}>{l.loanId || l.formId} — {l.schemeName}</option>)}
                      </select>
                    </FormField>
                  )}
                  <FormField id="wamount" label="Amount (₹)" required error={errors.amount} hint={kind === 'adjust' ? `Security ${inr(member.available)}, EMI ${chosenLoan?.due > 0 ? 'due' : 'left'} ${inr(emiDue)} → up to ${inr(adjustable)} can be adjusted` : `Up to ${inr(member.withdrawable)} (security of closed loans)`}>
                    <input id="wamount" inputMode="decimal" value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })); setErrors((x) => ({ ...x, amount: undefined })); }} />
                  </FormField>
                  {kind === 'withdraw' && (
                    <>
                      <FormField id="wmode" label="Paid back by" required error={errors.payMode}>
                        <select id="wmode" value={form.payMode} onChange={set('payMode')}>
                          {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </FormField>
                      <FormField id="wref" label="Reference no." hint="Optional"><input id="wref" value={form.reference} maxLength={60} onChange={set('reference')} /></FormField>
                    </>
                  )}
                  <FormField id="wremark" label="Remark" className="span-2"><input id="wremark" value={form.remark} maxLength={300} onChange={set('remark')} /></FormField>
                </div>
                {kind === 'adjust' && chosenLoan && (
                  <div style={{ margin: '10px 0' }}>
                    <div className="notice">
                      Security available {inr(member.available)} · EMI {chosenLoan.due > 0 ? 'due' : 'left'} {inr(emiDue)}. <strong>{inr(adjustable)}</strong> can be adjusted
                      {emiDue - adjustable > 0 ? <>, and {inr(emiDue - adjustable)} will still be due.</> : '.'}{' '}
                      <button type="button" className="link-btn" onClick={() => setForm((f) => ({ ...f, amount: String(adjustable) }))}>Fill in {inr(adjustable)}</button>
                    </div>
                    {typed > 0 && typed <= adjustable && <div className="muted small" style={{ marginTop: 4 }}>Adjusting {inr(typed)}: EMI {chosenLoan.due > 0 ? 'due' : 'left'} becomes {inr(Math.max(emiDue - typed, 0))}.</div>}
                  </div>
                )}
                {member.withdrawable < 1 && <div className="notice" style={{ margin: '10px 0' }}>The security of a running loan cannot be withdrawn. It can only be adjusted against an EMI. Withdrawal is possible once the loan is closed.</div>}
                <div className="notice" style={{ margin: '10px 0' }}>The request goes to the admin. After the admin approves it, an OTP goes to the member's phone; nothing is paid or adjusted until that OTP is verified.</div>
                <button className="btn primary" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send for admin approval'}</button>
              </>
            )}
          </div>

          {member.withdrawals.length > 0 && (
            <div className="panel" style={{ padding: 16 }}>
              <h3 className="section-title">Requests of this member</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Request</th><th>Date</th><th>Type</th><th className="num">Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {member.withdrawals.map((w) => (
                      <tr key={w.id}>
                        <td data-label="Request"><strong>{w.receiptNo}</strong></td><td data-label="Date">{dmy(w.requestedOn)}</td>
                        <td data-label="Type">{KIND_LABEL[w.kind]}{w.kind === 'adjust' && <div className="muted small">Loan {w.loanId}</div>}</td>
                        <td data-label="Amount" className="num">{inr(w.amount)}</td>
                        <td data-label="Status"><span className={`badge ${TONE[w.stage]}`}>{STAGE_LABEL[w.stage]}</span>{w.status === 'rejected' && <div className="muted small">{w.rejectReason}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

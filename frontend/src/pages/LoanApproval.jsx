import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { Detail } from './RequisitionList.jsx';

const LIMIT = 25;
const APPROVERS = ['super_admin', 'admin', 'branch_manager'];
const KINDS = [['', 'All loans'], ['personal', 'Personal'], ['group', 'Group'], ['business', 'Business / MSME'], ['product', 'Product']];
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');

const TEXT = {
  pending: { title: 'Pending Loans', desc: 'Loan requisitions waiting for approval. Review a loan to edit the amount and approve it, or reject it with a reason.' },
  approved: { title: 'Approved Loans', desc: 'Loans that have been approved.' },
  rejected: { title: 'Rejected Loans', desc: 'Loans that have been rejected, with the reason.' },
};

// Review one pending loan: edit the amount (the EMI and cash are worked out again), approve, or reject with a reason.
function ReviewDialog({ id, onClose, onDone }) {
  const toast = useToast();
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [calc, setCalc] = useState(null);
  const [calcError, setCalcError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  const debounced = useDebounce(amount, 400);

  useEffect(() => {
    api.loanRequisitions.get(id).then((x) => { setR(x.requisition); setAmount(String(x.requisition.amount)); }).catch((e) => setError(e.message));
  }, [id]);

  const editable = r && r.kind !== 'product';
  // The new EMI and cash for the edited amount.
  useEffect(() => {
    if (!r || !debounced || Number(debounced) === r.amount) {
      setCalc(null);
      setCalcError('');
      return;
    }
    api.loanRequisitions.preview({ schemeId: r.schemeId, amount: debounced, mode: r.mode, term: r.term, rate: r.rate })
      .then((res) => { setCalc(res); setCalcError(''); })
      .catch((err) => { setCalc(null); setCalcError(err.errors?.amount || err.message); });
  }, [debounced, r]);

  async function act(fn, ok) {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      toast.success(ok);
      onDone();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const changed = r && Number(amount) !== r.amount;
  return (
    <>
      <Modal open title={r ? `Review ${r.formId}` : 'Review loan'} onClose={onClose} size="lg" busy={busy} footer={<button className="btn" onClick={onClose}>Close</button>}>
        {error ? <ErrorState message={error} /> : !r ? <Spinner label="Loading…" /> : (
          <>
            <DetailList
              items={[
                ['Type', r.kindLabel], ['Branch', r.branch?.name], ['Loan date', r.loanDate],
                [r.group ? 'Group' : 'Borrower', r.group ? `${r.group.code} — ${r.group.name} (${r.memberCount} members)` : `${r.borrower.code} — ${r.borrower.name}`],
                ['Scheme', `${r.schemeCode} — ${r.schemeName}`], ['Mode & term', `${r.modeLabel}, ${r.term} installments`], ['Interest rate', `${r.rate}% p.a. (${r.calculationType})`],
                ...(r.product ? [['Product', `${r.product.name} × ${r.product.quantity}`]] : []),
                ['Requested amount', `${inr(r.requestedAmount ?? r.amount)}${r.group ? ' per member' : ''}`], ['EMI', inr(r.emi)], ['Cash in hand', inr(r.cash)], ['Employee ID', r.employeeCode],
              ]}
            />
            <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setFull(true)}>View full details and documents</button></div>

            {!rejecting && (
              <div className="panel" style={{ padding: 14, marginTop: 14 }}>
                <h3 className="section-title">Approve</h3>
                {editable ? (
                  <FormField id="aamount" label={r.group ? 'Loan amount per member (₹)' : 'Loan amount (₹)'} error={errors.amount || calcError}
                    hint={r.kind === 'group' ? 'Edit the amount if needed. A product on top of the loan stays within 25% of it.' : 'Edit the amount if needed. The EMI and cash are worked out again.'}>
                    <input id="aamount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setErrors((x) => ({ ...x, amount: undefined })); }} />
                  </FormField>
                ) : <div className="muted small">The amount of a product loan is the value of the goods and cannot be edited.</div>}
                {changed && calc && (
                  <div className="notice" style={{ margin: '8px 0' }}>
                    New amount {inr(Number(amount))}{r.group ? ` per member (${inr(Number(amount) * r.memberCount)} in all)` : ''} · EMI {inr(calc.summary.installmentAmount)} · Cash in hand {inr(calc.cash)}
                  </div>
                )}
                <button className="btn primary" disabled={busy || Boolean(calcError)} onClick={() => act(() => api.loanRequisitions.approve(id, editable && changed ? amount : undefined), 'Loan approved')}>
                  {changed ? 'Approve with the new amount' : 'Approve loan'}
                </button>{' '}
                <button className="btn danger-outline" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
              </div>
            )}
            {rejecting && (
              <div className="panel" style={{ padding: 14, marginTop: 14 }}>
                <h3 className="section-title">Reject</h3>
                <FormField id="rreason" label="Reason for rejection" required error={errors.reason}>
                  <input id="rreason" value={reason} maxLength={200} autoFocus onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, reason: undefined })); }} />
                </FormField>
                <button className="btn danger-outline" disabled={busy} onClick={() => act(() => api.loanRequisitions.reject(id, reason.trim()), 'Loan rejected')}>Reject loan</button>{' '}
                <button className="btn" disabled={busy} onClick={() => setRejecting(false)}>Cancel</button>
              </div>
            )}
          </>
        )}
      </Modal>
      {full && <Detail id={id} onClose={() => setFull(false)} />}
    </>
  );
}

function LoanApproval({ status }) {
  const { user } = useAuth();
  const canDecide = APPROVERS.includes(user?.role);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [branches, setBranches] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('');
  const [branch, setBranch] = useState('');
  const [group, setGroup] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [reviewId, setReviewId] = useState(null);
  const [viewId, setViewId] = useState(null);
  const q = useDebounce(search);

  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);
  // Groups of the chosen branch (a single-branch user is on that branch already).
  const branchForGroups = branch || (branches.length === 1 ? branches[0].id : '');
  useEffect(() => {
    setGroup('');
    if (!branchForGroups) return setGroups([]);
    api.loanRequisitions.groups({ branch: branchForGroups }).then((r) => setGroups(r.items)).catch(() => setGroups([]));
    return undefined;
  }, [branchForGroups]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.loanRequisitions.list({ page, limit: LIMIT, status, kind, branch, group, from, to, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, status, kind, branch, group, from, to, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [status, kind, branch, group, from, to, q]);
  useEffect(() => {
    setKind('');
    setPage(1);
  }, [status]);

  const hasFilters = kind || branch || group || from || to || search;
  const text = TEXT[status];

  return (
    <>
      <PageHeader title={text.title} description={text.desc} />
      <div className="panel">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {KINDS.map(([k, label]) => <button key={k} className={`btn sm${kind === k ? ' primary' : ''}`} onClick={() => setKind(k)}>{label}</button>)}
        </div>
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <input type="search" className="toolbar-search" placeholder="Search form ID, borrower or group code / name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          )}
          <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group" disabled={!branchForGroups}>
            <option value="">{branchForGroups ? 'All groups' : 'Select a branch to filter groups'}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
          </select>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          {hasFilters && <button className="btn" onClick={() => { setKind(''); setBranch(''); setGroup(''); setFrom(''); setTo(''); setSearch(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState title={`No ${status} loans`} description={hasFilters ? 'No loans match these filters.' : status === 'pending' ? 'Nothing is waiting for approval.' : `There are no ${status} loans yet.`} />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Form ID</th><th>Loan date</th><th>Type</th><th>Borrower / Group</th><th>Branch</th><th>Scheme</th>
                    <th className="num">Amount</th><th className="num">EMI</th>
                    {status !== 'pending' && <th>{status === 'approved' ? 'Approved' : 'Rejected'}</th>}
                    {status === 'rejected' && <th>Reason</th>}
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Form ID"><strong>{r.formId}</strong></td>
                      <td data-label="Loan date">{r.loanDate}</td>
                      <td data-label="Type">{r.kindLabel}</td>
                      <td data-label="Borrower">{r.subjectCode} — {r.subjectName}</td>
                      <td data-label="Branch">{r.branch?.name || '—'}</td>
                      <td data-label="Scheme">{r.schemeName}</td>
                      <td data-label="Amount" className="num">
                        {inr(r.amount)}
                        {r.kind === 'group' && <div className="muted small">× {r.memberCount} = {inr(r.totalAmount)}</div>}
                        {r.requestedAmount && <div className="muted small">asked {inr(r.requestedAmount)}</div>}
                      </td>
                      <td data-label="EMI" className="num">{inr(r.emi)}</td>
                      {status !== 'pending' && <td data-label="Decided">{fmt(r.decidedAt)}{r.decidedByCode ? <div className="muted small">by {r.decidedByCode}</div> : null}</td>}
                      {status === 'rejected' && <td data-label="Reason" style={{ maxWidth: 260 }}>{r.rejectReason || '—'}</td>}
                      <td data-label="Actions" className="actions-col">
                        {status === 'pending' && canDecide
                          ? <button className="btn sm primary" onClick={() => setReviewId(r.id)}>Review</button>
                          : <button className="btn sm" onClick={() => setViewId(r.id)}>View</button>}
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
      {reviewId && <ReviewDialog id={reviewId} onClose={() => setReviewId(null)} onDone={() => { setReviewId(null); load(); }} />}
      {viewId && <Detail id={viewId} onClose={() => setViewId(null)} />}
    </>
  );
}

export const PendingLoans = () => <LoanApproval status="pending" />;
export const ApprovedLoans = () => <LoanApproval status="approved" />;
export const RejectedLoans = () => <LoanApproval status="rejected" />;

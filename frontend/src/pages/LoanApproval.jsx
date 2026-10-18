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

const KIND_TEXT = {
  group: { title: 'Group Loan Approval', desc: 'Group loan requisitions waiting for approval. Review a loan to see the offline form, change the scheme or amount, and approve or reject it.' },
  personal: { title: 'Personal Loan Approval', desc: 'Personal loan requisitions waiting for approval. Review a loan to see the offline form, change the scheme or amount, and approve or reject it.' },
  product: { title: 'Product Loan Approval', desc: 'Product loan requisitions waiting for approval. Review a loan to see the offline form, change the scheme, and approve or reject it.' },
  business: { title: 'Business / MSME Loan Approval', desc: 'Business and MSME loan requisitions waiting for approval. Review a loan to see the offline form and documents, change the scheme or amount, and approve or reject it.' },
};
const TEXT = {
  pending: { title: 'Pending Loans', desc: 'Loan requisitions waiting for approval. Review a loan to edit the amount and approve it, or reject it with a reason.' },
  approved: { title: 'Approved Loans', desc: 'Loans that have been approved.' },
  rejected: { title: 'Rejected Loans', desc: 'Loans that have been rejected, with the reason.' },
};

// Review one pending loan: see the offline application form, change the scheme / amount / installments / rate (the EMI and
// cash are worked out again), then approve it or reject it with a reason.
function ReviewDialog({ id, onClose, onDone }) {
  const toast = useToast();
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [schemes, setSchemes] = useState([]);
  const [f, setF] = useState({ schemeId: '', amount: '', mode: '', term: '', rate: '' });
  const [calc, setCalc] = useState(null);
  const [calcError, setCalcError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  const [zoom, setZoom] = useState(null);
  const debounced = useDebounce(JSON.stringify(f), 400);

  useEffect(() => {
    api.loanRequisitions.get(id).then((x) => {
      const q = x.requisition;
      setR(q);
      setF({ schemeId: String(q.schemeId), amount: String(q.amount), mode: q.mode, term: String(q.term), rate: String(q.rate) });
      // the schemes this kind of loan can be moved to (a business / MSME loan stays in its own type)
      api.loanRequisitions.schemes({ kind: q.kind, type: q.kind === 'business' ? q.business?.loanType : undefined }).then((res) => {
        // a group takes loans in the mode it meets in (daily / weekly / monthly)
        const meeting = q.kind === 'group' ? q.group?.meetingType : '';
        setSchemes(meeting ? res.items.filter((s) => s.modes.some((m) => m.value === meeting)).map((s) => ({ ...s, modes: s.modes.filter((m) => m.value === meeting) })) : res.items);
      }).catch(() => setSchemes([]));
    }).catch((e) => setError(e.message));
  }, [id]);

  const scheme = schemes.find((x) => x.id === f.schemeId);
  const editableAmount = r && r.kind !== 'product';
  const changed = r && (f.schemeId !== String(r.schemeId) || Number(f.amount) !== r.amount || f.mode !== r.mode || Number(f.term) !== r.term || Number(f.rate) !== r.rate);

  // The new EMI and cash for what is entered.
  useEffect(() => {
    if (!r || !changed) {
      setCalc(null);
      setCalcError('');
      return;
    }
    const x = JSON.parse(debounced);
    api.loanRequisitions.preview({ schemeId: x.schemeId, amount: x.amount, mode: x.mode, term: Number(x.term), rate: x.rate })
      .then((res) => { setCalc(res); setCalcError(''); })
      .catch((err) => { setCalc(null); setCalcError(err.errors?.amount || err.errors?.term || err.errors?.rate || err.errors?.mode || err.errors?.schemeId || err.message); });
  }, [debounced, r]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseScheme(e) {
    const s2 = schemes.find((x) => x.id === e.target.value);
    setF((x) => ({
      ...x,
      schemeId: e.target.value,
      // keep what the new scheme allows, otherwise start from its own values
      mode: s2 && !s2.modes.some((m) => m.value === x.mode) ? s2.modes[0].value : x.mode,
      rate: s2 && (Number(x.rate) < s2.roiMin || Number(x.rate) > s2.roiMax) ? String(s2.roiMin) : x.rate,
    }));
    setErrors({});
  }
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

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

  const forms = r ? (r.memberForms?.length ? r.memberForms.map((m) => ({ label: `Form of ${m.memberCode}${m.topUp ? ' (product loan)' : ''}`, front: m.front, back: m.back })) : [{ label: 'Application form', front: r.formFrontPhoto, back: r.formBackPhoto }]) : [];
  const Img = ({ src, alt }) => (src ? <img src={src} alt={alt} className="stamp-img" style={{ cursor: 'zoom-in' }} onClick={() => setZoom({ src, alt })} /> : <span className="muted">—</span>);
  return (
    <>
      <Modal open title={r ? `Review ${r.formId}` : 'Review loan'} onClose={onClose} size="lg" busy={busy} footer={<button className="btn" onClick={onClose}>Close</button>}>
        {error ? <ErrorState message={error} /> : !r ? <Spinner label="Loading…" /> : (
          <>
            <DetailList
              items={[
                ['Type', r.kindLabel], ['Branch', r.branch?.name], ['Loan date', r.loanDate],
                [r.group ? 'Group' : 'Borrower', r.group ? `${r.group.code} — ${r.group.name} (${r.memberCount} members)` : `${r.borrower.code} — ${r.borrower.name}`],
                ['Requested scheme', `${r.requestedSchemeName || r.schemeName}`], ['Mode & term', `${r.modeLabel}, ${r.term} installments`], ['Interest rate', `${r.rate}% p.a. (${r.calculationType})`],
                ...(r.product ? [['Product', `${r.product.name} × ${r.product.quantity}`]] : []),
                ['Requested amount', `${inr(r.requestedAmount ?? r.amount)}${r.group ? ' per member' : ''}`], ['EMI', inr(r.emi)], ['Cash in hand', inr(r.cash)], ['Employee ID', r.employeeCode],
              ]}
            />

            {r.batchId && r.batchCount > 1 && (
              <div className="notice" style={{ marginTop: 10 }}>
                This loan is one of the {r.batchCount} member loans of requisition <strong>{r.batchFormId}</strong>. Each member has her own scheme and amount.
                {!rejecting && (
                  <div style={{ marginTop: 6 }}>
                    <button className="btn sm primary" disabled={busy} onClick={() => act(async () => { const x = await api.loanRequisitions.approveBatch(r.batchId); toast.info?.(`${x.approved} approved`); }, 'All pending loans of this requisition approved')}>Approve all pending loans of {r.batchFormId}</button>
                  </div>
                )}
              </div>
            )}
            <h3 className="section-title" style={{ marginTop: 14 }}>Offline application form</h3>
            {forms.map((x) => (
              <div key={x.label} style={{ marginBottom: 10 }}>
                <div className="detail-label">{x.label}</div>
                <div className="stamp-view sign-row"><div><Img src={x.front} alt={`${x.label} front`} /></div><div><Img src={x.back} alt={`${x.label} back`} /></div></div>
              </div>
            ))}
            <div style={{ margin: '4px 0 8px' }}><button className="btn sm" onClick={() => setFull(true)}>All details and other documents</button></div>

            {!rejecting && (
              <div className="panel" style={{ padding: 14, marginTop: 14 }}>
                <h3 className="section-title">Approve</h3>
                <div className="muted small" style={{ marginBottom: 8 }}>The loan can be changed before it is approved: the loan scheme, the amount, the installments and the rate. The EMI and cash are worked out again.</div>
                <div className="form-grid">
                  <FormField id="ascheme" label="Loan scheme" error={errors.schemeId}>
                    <select id="ascheme" value={f.schemeId} onChange={chooseScheme}>
                      {schemes.length === 0 && <option value={f.schemeId}>{r.schemeName}</option>}
                      {schemes.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
                    </select>
                  </FormField>
                  <FormField id="aamount" label={r.group ? 'Loan amount per member (₹)' : 'Loan amount (₹)'} error={errors.amount} hint={editableAmount ? (scheme ? `Scheme limit ${inr(scheme.amountMin)} to ${inr(scheme.amountMax)}` : undefined) : 'The amount of a product loan is the value of the goods'}>
                    <input id="aamount" inputMode="decimal" value={f.amount} disabled={!editableAmount} onChange={(e) => { setF((x) => ({ ...x, amount: e.target.value.replace(/[^\d.]/g, '') })); setErrors((x) => ({ ...x, amount: undefined })); }} />
                  </FormField>
                  <FormField id="amode" label="Repayment mode" error={errors.mode}>
                    <select id="amode" value={f.mode} onChange={set('mode')}>
                      {(scheme?.modes || [{ value: r.mode, label: r.modeLabel }]).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </FormField>
                  <FormField id="aterm" label="Installments" error={errors.term}>
                    <input id="aterm" inputMode="numeric" value={f.term} onChange={(e) => { setF((x) => ({ ...x, term: e.target.value.replace(/\D/g, '').slice(0, 4) })); setErrors((x) => ({ ...x, term: undefined })); }} />
                  </FormField>
                  <FormField id="arate" label="Interest rate (% p.a.)" error={errors.rate} hint={scheme ? `Scheme ${scheme.roiMin}% to ${scheme.roiMax}%` : undefined}>
                    <input id="arate" inputMode="decimal" value={f.rate} onChange={(e) => { setF((x) => ({ ...x, rate: e.target.value.replace(/[^\d.]/g, '') })); setErrors((x) => ({ ...x, rate: undefined })); }} />
                  </FormField>
                </div>
                {calcError && <div className="field-error" role="alert">{calcError}</div>}
                {changed && calc && (
                  <div className="notice" style={{ margin: '8px 0' }}>
                    {scheme ? `${scheme.name} · ` : ''}{inr(Number(f.amount))}{r.group ? ` per member (${inr(Number(f.amount) * r.memberCount)} in all)` : ''} · EMI {inr(calc.summary.installmentAmount)} · Cash in hand {inr(calc.cash)}
                  </div>
                )}
                <button className="btn primary" disabled={busy || Boolean(calcError)} onClick={() => act(() => api.loanRequisitions.approve(id, changed ? { schemeId: f.schemeId, amount: editableAmount ? f.amount : undefined, mode: f.mode, term: f.term, rate: f.rate } : {}), 'Loan approved')}>
                  {changed ? 'Approve with these changes' : 'Approve loan'}
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
      {zoom && (
        <Modal open title={zoom.alt} onClose={() => setZoom(null)} size="lg" footer={<button className="btn" onClick={() => setZoom(null)}>Close</button>}>
          <img src={zoom.src} alt={zoom.alt} style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} />
        </Modal>
      )}
    </>
  );
}

function LoanApproval({ status, fixedKind = '' }) {
  const { user } = useAuth();
  const canDecide = APPROVERS.includes(user?.role);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [branches, setBranches] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState(fixedKind);
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
    setKind(fixedKind);
    setPage(1);
  }, [status, fixedKind]);

  const hasFilters = (!fixedKind && kind) || branch || group || from || to || search;
  const text = fixedKind ? KIND_TEXT[fixedKind] : TEXT[status];

  return (
    <>
      <PageHeader title={text.title} description={text.desc} />
      <div className="panel">
        {!fixedKind && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {KINDS.map(([k, label]) => <button key={k} className={`btn sm${kind === k ? ' primary' : ''}`} onClick={() => setKind(k)}>{label}</button>)}
        </div>}
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
          {hasFilters && <button className="btn" onClick={() => { setKind(fixedKind); setBranch(''); setGroup(''); setFrom(''); setTo(''); setSearch(''); }}>Clear</button>}
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
                      <td data-label="Form ID"><strong>{r.formId}</strong>{r.batchCount > 1 && <div className="muted small">Batch {r.batchFormId} · {r.batchCount} members</div>}</td>
                      <td data-label="Loan date">{r.loanDate}</td>
                      <td data-label="Type">{r.kindLabel}</td>
                      <td data-label="Borrower">{r.subjectCode} — {r.subjectName}</td>
                      <td data-label="Branch">{r.branch?.name || '—'}</td>
                      <td data-label="Scheme">{r.schemeName}</td>
                      <td data-label="Amount" className="num">
                        {inr(r.amount)}
                        {r.kind === 'group' && r.memberCount > 1 && <div className="muted small">× {r.memberCount} = {inr(r.totalAmount)}</div>}
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
      {viewId && <Detail id={viewId} onClose={() => setViewId(null)} onChanged={load} />}
    </>
  );
}

export const PendingLoans = () => <LoanApproval status="pending" />;
export const GroupLoanApproval = () => <LoanApproval status="pending" fixedKind="group" />;
export const PersonalLoanApproval = () => <LoanApproval status="pending" fixedKind="personal" />;
export const ProductLoanApproval = () => <LoanApproval status="pending" fixedKind="product" />;
export const BusinessLoanApproval = () => <LoanApproval status="pending" fixedKind="business" />;
export const ApprovedLoans = () => <LoanApproval status="approved" />;
export const RejectedLoans = () => <LoanApproval status="rejected" />;

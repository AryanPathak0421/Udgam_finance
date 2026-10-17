import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { ReceiptDialog } from './EmiPayment.jsx';

const LIMIT = 25;
const COLLECTORS = ['super_admin', 'admin', 'branch_manager', 'accountant', 'collection_officer', 'field_officer'];
const MODE_LABEL = { cash: 'Cash', bank: 'Bank transfer', upi: 'UPI', cheque: 'Cheque' };
const REPAY_LABEL = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly', quarterly: 'Quarterly', halfyearly: 'Half-yearly', yearly: 'Yearly' };
const LOAN_TYPES = [['', 'All loan types'], ['personal', 'Personal'], ['business', 'Business'], ['msme', 'MSME'], ['product', 'Product']];
const todayISO = () => new Date().toISOString().slice(0, 10);
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');
const key = (r) => `${r.loan}|${r.member}`;
const cleanAmount = (v) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

// The filters of both collection screens.
function Filters({ f, set, branches, staff, modes }) {
  return (
    <div className="toolbar" style={{ flexWrap: 'wrap' }}>
      <input type="search" className="toolbar-search" placeholder="Search Loan ID, borrower or group" value={f.search} onChange={(e) => set({ search: e.target.value })} aria-label="Search" />
      {branches.length > 1 && (
        <select value={f.branch} onChange={(e) => set({ branch: e.target.value })} aria-label="Branch">
          <option value="">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
      )}
      <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        EMI due up to
        <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value || todayISO() })} aria-label="Date" />
      </label>
      <select value={f.staff} onChange={(e) => set({ staff: e.target.value })} aria-label="Staff">
        <option value="">All staff</option>
        {staff.map((s) => <option key={s.code} value={s.code}>{s.code}{s.name ? ` — ${s.name}` : ''}</option>)}
      </select>
      <select value={f.mode} onChange={(e) => set({ mode: e.target.value })} aria-label="Repayment mode">
        <option value="">All modes</option>
        {modes.map((m) => <option key={m} value={m}>{REPAY_LABEL[m] || m}</option>)}
      </select>
      {f.withType && (
        <select value={f.loanType} onChange={(e) => set({ loanType: e.target.value })} aria-label="Loan type">
          {LOAN_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
    </div>
  );
}

function useCollection(kind) {
  const [f, setF] = useState({ search: '', branch: '', date: todayISO(), staff: '', mode: '', loanType: '', withType: kind === 'single' });
  const [branches, setBranches] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(f.search);
  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.emi.collection({ kind, page, limit: LIMIT, branch: f.branch, date: f.date, staff: f.staff, mode: f.mode, loanType: f.loanType, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [kind, page, f.branch, f.date, f.staff, f.mode, f.loanType, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [f.branch, f.date, f.staff, f.mode, f.loanType, q]);
  return { f, set: (patch) => setF((x) => ({ ...x, ...patch })), branches, data, loading, error, load, page, setPage };
}

// ---- single loan EMI: one row per borrower, the EMI that is due is filled in, edit it and pay -------------------------
export function SingleLoanEmi() {
  const { user } = useAuth();
  const toast = useToast();
  const canCollect = COLLECTORS.includes(user?.role);
  const c = useCollection('single');
  const [amounts, setAmounts] = useState({});
  const [payMode, setPayMode] = useState('cash');
  const [busy, setBusy] = useState('');
  const [receipt, setReceipt] = useState(null);
  const rows = c.data?.items || [];

  async function pay(r) {
    const amount = amounts[key(r)] ?? String(r.dueAmount);
    if (!(Number(amount) >= 1)) return toast.error('Enter the amount received');
    if (Number(amount) > r.dueAmount) return toast.error(`Only the due EMI (${inr(r.dueAmount)}) can be collected here. Use Advance EMI Payment for later installments.`);
    setBusy(key(r));
    try {
      const res = await api.emi.collect({ items: [{ loan: r.loan, member: r.member, amount }], payMode });
      const one = res.results[0];
      if (one.ok) {
        toast.success(`EMI received — receipt ${one.payment.receiptNo}`);
        setReceipt(one.payment);
        setAmounts((a) => { const n = { ...a }; delete n[key(r)]; return n; });
      } else toast.error(one.message);
    } catch (err) {
      toast.error(err.results?.[0]?.message || err.message);
    } finally {
      setBusy('');
      c.load();
    }
  }

  return (
    <>
      <PageHeader title="Single Loan EMI" description="EMI due on personal, business, MSME and product loans. The EMI amount is filled in; change it if needed and click Pay." />
      <div className="panel">
        <Filters f={c.f} set={c.set} branches={c.branches} staff={c.data?.staff || []} modes={c.data?.modes || []} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 10px' }}>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Paid by
            <select value={payMode} onChange={(e) => setPayMode(e.target.value)} aria-label="Paid by">
              {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {c.data && <span className="muted small">{c.data.total} borrower{c.data.total === 1 ? '' : 's'} with EMI due · total due {inr(c.data.totalDue)}</span>}
        </div>
        {c.loading && !c.data ? <Spinner label="Loading…" /> : c.error ? <ErrorState message={c.error} onRetry={c.load} /> : rows.length === 0 ? (
          <EmptyState title="No EMI is due" description="No single loan has an EMI due on or before this date for these filters." />
        ) : (
          <>
            <div className={`table-wrap${c.loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr><th>Loan ID</th><th>Borrower</th><th>Type</th><th>Branch</th><th>Staff</th><th>Mode</th><th>Due</th><th className="num">EMI</th><th className="num">Amount to receive</th><th className="actions-col">Actions</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={key(r)}>
                      <td data-label="Loan ID"><strong>{r.loanId || r.formId}</strong></td>
                      <td data-label="Borrower"><strong>{r.code}</strong> {r.name}</td>
                      <td data-label="Type">{r.loanTypeLabel}</td>
                      <td data-label="Branch">{r.branch?.name || '—'}</td>
                      <td data-label="Staff">{r.employeeCode || '—'}</td>
                      <td data-label="Mode">{REPAY_LABEL[r.mode] || r.modeLabel}</td>
                      <td data-label="Due">{r.dueCount} installment{r.dueCount === 1 ? '' : 's'}{r.overdueDays > 0 && <div className="muted small">{r.overdueDays} day{r.overdueDays === 1 ? '' : 's'} overdue</div>}</td>
                      <td data-label="EMI" className="num">{inr(r.emi)}</td>
                      <td data-label="Amount" className="num">
                        <input aria-label={`Amount for ${r.code}`} inputMode="decimal" style={{ width: 110, textAlign: 'right' }} value={amounts[key(r)] ?? String(r.dueAmount)} disabled={!canCollect}
                          onChange={(e) => setAmounts((a) => ({ ...a, [key(r)]: cleanAmount(e.target.value) }))} />
                        <div className="muted small">due {inr(r.dueAmount)}</div>
                      </td>
                      <td data-label="Actions" className="actions-col">
                        {canCollect ? <button className="btn sm primary" disabled={busy === key(r)} onClick={() => pay(r)}>{busy === key(r) ? 'Paying…' : 'Pay'}</button> : <span className="muted">View only</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={c.data.page || c.page} totalPages={c.data.totalPages} total={c.data.total} limit={LIMIT} onPage={c.setPage} />
          </>
        )}
      </div>
      {receipt && <ReceiptDialog payment={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

// ---- group loan EMI: choose the group, tick the members, edit the EMI and pay -----------------------------------------
function GroupCollect({ group, canCollect, onClose, onDone }) {
  const toast = useToast();
  const [ticked, setTicked] = useState(() => new Set(group.members.map(key)));
  const [amounts, setAmounts] = useState({});
  const [payMode, setPayMode] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const amountOf = (m) => amounts[key(m)] ?? String(m.dueAmount);
  const chosen = group.members.filter((m) => ticked.has(key(m)));
  const total = chosen.reduce((s, m) => s + (Number(amountOf(m)) || 0), 0);
  const toggle = (m) => setTicked((t) => { const n = new Set(t); if (n.has(key(m))) n.delete(key(m)); else n.add(key(m)); return n; });

  async function collect() {
    if (chosen.some((m) => !(Number(amountOf(m)) >= 1))) return toast.error('Enter the amount for every ticked member');
    if (chosen.some((m) => Number(amountOf(m)) > m.dueAmount)) return toast.error('A member cannot pay more than the EMI due today. Use Advance EMI Payment for later installments.');
    setBusy(true);
    try {
      const r = await api.emi.collect({ items: chosen.map((m) => ({ loan: m.loan, member: m.member, amount: amountOf(m) })), payMode });
      setResults(r);
      toast.success(`${r.paidCount} EMI received — ${inr(r.totalAmount)}`);
      if (r.failedCount) toast.error(`${r.failedCount} could not be received`);
    } catch (err) {
      if (err.results) setResults(err);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const close = () => { if (results) onDone(); else onClose(); };
  return (
    <>
      <Modal open title={`${group.code} — ${group.name}`} onClose={close} size="lg" busy={busy} footer={<button className="btn" onClick={close}>{results ? 'Done' : 'Close'}</button>}>
        <p className="muted small" style={{ marginTop: 0 }}>{group.branch?.name} · staff {group.employeeCode || '—'} · {group.modeLabel} · total due {inr(group.dueAmount)}</p>
        {!results ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}><input type="checkbox" aria-label="Select all members" checked={chosen.length === group.members.length} onChange={(e) => setTicked(e.target.checked ? new Set(group.members.map(key)) : new Set())} /></th>
                    <th>Member</th><th>Loan ID</th><th>Due</th><th className="num">EMI</th><th className="num">Amount to receive</th>
                  </tr>
                </thead>
                <tbody>
                  {group.members.map((m) => (
                    <tr key={key(m)} style={ticked.has(key(m)) ? undefined : { opacity: 0.55 }}>
                      <td><input type="checkbox" aria-label={`Select ${m.code}`} checked={ticked.has(key(m))} onChange={() => toggle(m)} disabled={!canCollect} /></td>
                      <td data-label="Member"><strong>{m.code}</strong> {m.name}</td>
                      <td data-label="Loan ID">{m.loanId || m.formId}</td>
                      <td data-label="Due">{m.dueCount} installment{m.dueCount === 1 ? '' : 's'}{m.overdueDays > 0 && <div className="muted small">{m.overdueDays} day{m.overdueDays === 1 ? '' : 's'} overdue</div>}</td>
                      <td data-label="EMI" className="num">{inr(m.emi)}</td>
                      <td data-label="Amount" className="num">
                        <input aria-label={`Amount for ${m.code}`} inputMode="decimal" style={{ width: 110, textAlign: 'right' }} value={amountOf(m)} disabled={!canCollect || !ticked.has(key(m))}
                          onChange={(e) => setAmounts((a) => ({ ...a, [key(m)]: cleanAmount(e.target.value) }))} />
                        <div className="muted small">due {inr(m.dueAmount)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canCollect ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                <FormField id="gpay" label="Paid by">
                  <select id="gpay" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                    {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </FormField>
                <button className="btn primary" disabled={busy || !chosen.length} onClick={collect}>{busy ? 'Collecting…' : `Collect ${inr(total)} from ${chosen.length} member${chosen.length === 1 ? '' : 's'}`}</button>
              </div>
            ) : <div className="muted" style={{ marginTop: 10 }}>You can view the group but not collect EMI.</div>}
          </>
        ) : (
          <>
            <div className="notice" style={{ marginBottom: 10 }}>{results.paidCount} received · {inr(results.totalAmount)}{results.failedCount ? ` · ${results.failedCount} failed` : ''}</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Member</th><th>Result</th><th className="actions-col">Receipt</th></tr></thead>
                <tbody>
                  {results.results.map((r) => {
                    const m = group.members.find((x) => String(x.member) === String(r.member) && String(x.loan) === String(r.loan));
                    return (
                      <tr key={`${r.loan}|${r.member}`}>
                        <td data-label="Member"><strong>{m?.code}</strong> {m?.name}</td>
                        <td data-label="Result">{r.ok ? <span className="badge green">{inr(r.payment.amount)} — {r.payment.receiptNo}</span> : <span className="badge danger">{r.message}</span>}</td>
                        <td data-label="Receipt" className="actions-col">{r.ok && <button className="btn sm" onClick={() => setReceipt(r.payment)}>Receipt</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
      {receipt && <ReceiptDialog payment={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

export function GroupLoanEmi() {
  const { user } = useAuth();
  const canCollect = COLLECTORS.includes(user?.role);
  const c = useCollection('group');
  const [open, setOpen] = useState(null);
  const groups = c.data?.groups || [];

  return (
    <>
      <PageHeader title="Group Loan EMI" description="Choose the group, tick the members who pay, change the EMI amount if needed and collect." />
      <div className="panel">
        <Filters f={c.f} set={c.set} branches={c.branches} staff={c.data?.staff || []} modes={c.data?.modes || []} />
        {c.data && <div className="muted small" style={{ margin: '4px 0 10px' }}>{groups.length} group{groups.length === 1 ? '' : 's'} with EMI due · total due {inr(c.data.totalDue)}</div>}
        {c.loading && !c.data ? <Spinner label="Loading…" /> : c.error ? <ErrorState message={c.error} onRetry={c.load} /> : groups.length === 0 ? (
          <EmptyState title="No group EMI is due" description="No group loan has an EMI due on or before this date for these filters." />
        ) : (
          <div className={`table-wrap${c.loading ? ' dim' : ''}`}>
            <table className="data-table">
              <thead><tr><th>Group</th><th>Branch</th><th>Staff</th><th>Mode</th><th className="num">Members with EMI due</th><th className="num">Total due</th><th className="actions-col">Actions</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.code}>
                    <td data-label="Group"><strong>{g.code}</strong> {g.name}</td>
                    <td data-label="Branch">{g.branch?.name || '—'}</td>
                    <td data-label="Staff">{g.employeeCode || '—'}</td>
                    <td data-label="Mode">{REPAY_LABEL[g.members[0]?.mode] || g.modeLabel}</td>
                    <td data-label="Members" className="num">{g.members.length}</td>
                    <td data-label="Due" className="num">{inr(g.dueAmount)}</td>
                    <td data-label="Actions" className="actions-col"><button className="btn sm primary" onClick={() => setOpen(g)}>{canCollect ? 'Select & collect' : 'View'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <GroupCollect group={open} canCollect={canCollect} onClose={() => setOpen(null)} onDone={() => { setOpen(null); c.load(); }} />}
    </>
  );
}

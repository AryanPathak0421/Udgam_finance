import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const LIMIT = 25;
const COLLECTORS = ['super_admin', 'admin', 'branch_manager', 'accountant', 'collection_officer', 'field_officer'];
const MODE_LABEL = { cash: 'Cash', bank: 'Bank transfer', upi: 'UPI', cheque: 'Cheque' };
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TONE = { paid: 'green', due: 'danger', upcoming: 'grey' };
const LABEL = { paid: 'Paid', due: 'Due', upcoming: 'Upcoming' };

// Opens the EMI receipt in its own window and prints it.
function printReceipt(p) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>EMI receipt ${esc(p.receiptNo)}</title>
  <style>body{font-family:Arial,sans-serif;max-width:680px;margin:24px auto;color:#111;font-size:14px}h1{margin:0;font-size:20px}.muted{color:#555}
  .head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}table{width:100%;border-collapse:collapse;margin:8px 0}
  td,th{padding:5px 6px;border-bottom:1px solid #ddd;text-align:left}.n{text-align:right}.tot td{font-weight:bold;border-top:2px solid #111}
  .sign{display:flex;justify-content:space-between;margin-top:48px}.sign div{border-top:1px solid #111;padding-top:4px;width:40%;text-align:center}</style></head><body>
  <div class="head"><div><h1>Udgam Microfinance</h1><div class="muted">${p.type === 'advance' ? 'Advance EMI receipt' : 'EMI receipt'}</div></div><div style="text-align:right"><b>${esc(p.receiptNo)}</b><br>${dmy(p.paidOn)}</div></div>
  <table><tr><td>Loan ID</td><td><b>${esc(p.loanId || p.formId)}</b></td><td>Branch</td><td>${esc(p.branch ? `${p.branch.code} — ${p.branch.name}` : '')}</td></tr>
  <tr><td>Borrower</td><td><b>${esc(p.memberCode)}</b> ${esc(p.memberName)}</td><td>Paid by</td><td>${esc(MODE_LABEL[p.payMode] || p.payMode)}${p.reference ? ` · ${esc(p.reference)}` : ''}</td></tr>
  ${p.group ? `<tr><td>Group</td><td colspan="3">${esc(p.group)}</td></tr>` : ''}</table>
  <table><thead><tr><th>Installment</th><th>Due date</th><th class="n">Amount</th></tr></thead><tbody>
  ${p.items.map((i) => `<tr><td>${i.no}</td><td>${dmy(i.dueDate)}</td><td class="n">${inr(i.amount)}</td></tr>`).join('')}
  <tr class="tot"><td colspan="2">Total received (${p.items.length} installment${p.items.length === 1 ? '' : 's'})</td><td class="n">${inr(p.amount)}</td></tr></tbody></table>
  <div class="sign"><div>Borrower's signature</div><div>Authorised signatory</div></div>
  <script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank', 'width=780,height=900');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

function ReceiptDialog({ payment: p, onClose }) {
  const toast = useToast();
  return (
    <Modal open title={`Receipt ${p.receiptNo}`} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => { if (!printReceipt(p)) toast.error('Allow pop-ups to print the receipt'); }}>Print receipt</button></>}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {p.type === 'advance' ? 'Advance EMI' : 'EMI'} · Loan {p.loanId || p.formId} · {p.memberCode} {p.memberName} · {dmy(p.paidOn)} by {MODE_LABEL[p.payMode]}{p.reference ? ` (${p.reference})` : ''}
        {p.status === 'cancelled' && <span className="badge danger" style={{ marginLeft: 8 }}>Cancelled: {p.cancelReason}</span>}
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Installment</th><th>Due date</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {p.items.map((i) => <tr key={i.no}><td data-label="No">{i.no}</td><td data-label="Due date">{dmy(i.dueDate)}</td><td data-label="Amount" className="num">{inr(i.amount)}</td></tr>)}
            <tr><td colSpan={2}><strong>Total received</strong></td><td className="num"><strong>{inr(p.amount)}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// One loan: its details and installments, and the EMI collection of the chosen borrower.
function LoanView({ id, advance, canCollect, onBack }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [member, setMember] = useState('');
  const [count, setCount] = useState('1');
  const [payMode, setPayMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);

  const load = useCallback(() => api.emi.loan(id).then((d) => { setData(d); setMember((m) => m || String(d.borrowers[0]?.member || '')); setError(''); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  const b = data?.borrowers.find((x) => String(x.member) === String(member)) || data?.borrowers[0];
  const dueRows = b ? b.schedule.filter((s) => s.status === 'due') : [];
  const leftRows = b ? b.schedule.filter((s) => s.status !== 'paid') : [];
  // regular: the due installments; advance: installments ahead of their due date
  const pool = advance ? leftRows : dueRows;
  const n = Math.min(Math.max(Number(count) || 0, 0), pool.length);
  const chosen = pool.slice(0, n);
  const amount = chosen.reduce((s, x) => s + x.amount, 0);
  // Whole due amount by default for a regular EMI.
  useEffect(() => {
    if (!b) return;
    setCount(advance ? '1' : String(Math.max(dueRows.length, 1)));
    setErrors({});
  }, [member, data, advance]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pay() {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.emi.pay({ loan: id, member: b.member, type: advance ? 'advance' : 'regular', count: Number(count), payMode, reference });
      toast.success(`${advance ? 'Advance EMI' : 'EMI'} received — receipt ${r.payment.receiptNo}`);
      setReceipt(r.payment);
      await load();
    } catch (err) {
      setErrors(err.errors || { general: err.message });
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Spinner label="Loading the loan…" />;
  const { loan } = data;
  const blockedAdvance = advance && dueRows.length > 0;
  return (
    <>
      <div style={{ marginBottom: 10 }}><button className="btn" onClick={onBack}>← Search another loan</button></div>
      <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <DetailList items={[
          ['Loan ID', loan.loanId || loan.formId], ['Form ID', loan.formId], ['Branch', loan.branch], [loan.group ? 'Group' : 'Borrower', loan.group || `${data.borrowers[0].code} — ${data.borrowers[0].name}`],
          ['Scheme', loan.schemeName], ['Loan amount', `${inr(loan.amount)}${loan.group ? ' per member' : ''}`], ['Installments', `${loan.installments} (${loan.modeLabel}) at ${loan.rate}% p.a.`],
          ['Paid out on', dmy(loan.paidOn)], ['First / last installment', `${dmy(loan.emiStartDate)} → ${dmy(loan.emiEndDate)}`], ['Today', dmy(data.today)],
        ]} />
      </div>

      {data.borrowers.length > 1 && (
        <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
          <h3 className="section-title">Members</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Member</th><th className="num">EMI</th><th className="num">Paid</th><th className="num">Due now</th><th className="num">Outstanding</th><th className="actions-col">Actions</th></tr></thead>
              <tbody>
                {data.borrowers.map((x) => (
                  <tr key={x.code} style={String(x.member) === String(member) ? { background: 'var(--primary-soft, #eef7f4)' } : undefined}>
                    <td data-label="Member"><strong>{x.code}</strong> {x.name}</td>
                    <td data-label="EMI" className="num">{inr(x.emi)}</td>
                    <td data-label="Paid" className="num">{x.paidCount}/{loan.installments}</td>
                    <td data-label="Due" className="num">{x.dueCount ? <span className="badge danger">{x.dueCount} · {inr(x.dueAmount)}</span> : '—'}</td>
                    <td data-label="Outstanding" className="num">{inr(x.outstanding)}</td>
                    <td data-label="Actions" className="actions-col"><button className="btn sm" onClick={() => setMember(String(x.member))}>{String(x.member) === String(member) ? 'Selected' : 'Select'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <h3 className="section-title">{advance ? 'Advance EMI payment' : 'EMI payment'} — {b.code} {b.name}</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <span className="badge green">Paid {b.paidCount}/{loan.installments} · {inr(b.paidAmount)}</span>
          <span className={`badge ${b.dueCount ? 'danger' : 'grey'}`}>Due now {b.dueCount} · {inr(b.dueAmount)}{b.overdueCount ? ` (${b.overdueCount} overdue)` : ''}</span>
          <span className="badge grey">Outstanding {inr(b.outstanding)}</span>
          {b.next && <span className="badge grey">Next: installment {b.next.no} on {dmy(b.next.dueDate)} — {inr(b.next.amount)}</span>}
        </div>
        {b.closed ? <div className="notice">All installments of this loan are paid.</div> : !canCollect ? (
          <div className="muted">You can view the loan but not collect EMI.</div>
        ) : blockedAdvance ? (
          <div className="notice warn">{b.dueCount} installment{b.dueCount === 1 ? ' is' : 's are'} due ({inr(b.dueAmount)}). Collect the due EMI under EMI Payment first, then pay in advance.</div>
        ) : !advance && !dueRows.length ? (
          <div className="notice">No installment is due now. To pay ahead, use Advance EMI Payment.</div>
        ) : (
          <>
            <div className="form-grid">
              <FormField id="ecount" label={advance ? 'Installments to pay in advance' : 'Due installments to pay'} required error={errors.count} hint={`1 to ${pool.length}`}>
                <input id="ecount" inputMode="numeric" value={count} onChange={(e) => { setCount(e.target.value.replace(/\D/g, '').slice(0, 4)); setErrors((x) => ({ ...x, count: undefined })); }} />
              </FormField>
              <FormField id="emode" label="Paid by" required error={errors.payMode}>
                <select id="emode" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                  {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FormField>
              <FormField id="eref" label="Reference no." hint="Optional">
                <input id="eref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
              </FormField>
            </div>
            {chosen.length > 0 && (
              <div className="notice" style={{ margin: '10px 0' }}>
                {advance ? 'Advance EMI' : 'EMI'}: installments {chosen[0].no}{chosen.length > 1 ? ` to ${chosen[chosen.length - 1].no}` : ''} ({dmy(chosen[0].dueDate)}{chosen.length > 1 ? ` → ${dmy(chosen[chosen.length - 1].dueDate)}` : ''})
                {' '}· {chosen.length} × {inr(b.emi)} = <strong>{inr(amount)}</strong>
              </div>
            )}
            {errors.general && <div className="field-error" role="alert">{errors.general}</div>}
            <button className="btn primary" disabled={busy || !chosen.length} onClick={pay}>{busy ? 'Saving…' : `Receive ${inr(amount)}${advance ? ' (advance)' : ''}`}</button>
          </>
        )}
      </div>

      <div className="panel" style={{ padding: 16 }}>
        <h3 className="section-title">Installments of {b.code}</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th className="num">No</th><th>Due date</th><th className="num">Amount</th><th>Status</th><th>Receipt</th></tr></thead>
            <tbody>
              {b.schedule.map((s) => (
                <tr key={s.no}>
                  <td data-label="No" className="num">{s.no}</td>
                  <td data-label="Due date">{dmy(s.dueDate)}{s.overdueDays > 0 && <div className="muted small">{s.overdueDays} day{s.overdueDays === 1 ? '' : 's'} overdue</div>}</td>
                  <td data-label="Amount" className="num">{inr(s.amount)}</td>
                  <td data-label="Status"><span className={`badge ${TONE[s.status]}`}>{LABEL[s.status]}</span>{s.paidType === 'advance' && <span className="badge grey" style={{ marginLeft: 4 }}>Advance</span>}</td>
                  <td data-label="Receipt">{s.receiptNo ? `${s.receiptNo} · ${dmy(s.paidOn)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {receipt && <ReceiptDialog payment={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

function EmiPaymentPage({ advance }) {
  const { user } = useAuth();
  const canCollect = COLLECTORS.includes(user?.role);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loanId, setLoanId] = useState(null);
  const q = useDebounce(search);

  useEffect(() => {
    if (loanId || q.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let live = true;
    setSearching(true);
    api.emi.search(q.trim()).then((r) => live && setResults(r.items)).catch(() => live && setResults([])).finally(() => live && setSearching(false));
    return () => {
      live = false;
    };
  }, [q, loanId]);

  return (
    <>
      <PageHeader
        title={advance ? 'Advance EMI Payment' : 'EMI Payment'}
        description={advance ? 'Search the Loan ID to see the loan, then pay installments ahead of their due date. The amount is the EMI of those installments.' : 'Search the Loan ID to see all the details of the loan and collect the EMI that is due.'}
      />
      {loanId ? (
        <LoanView id={loanId} advance={advance} canCollect={canCollect} onBack={() => setLoanId(null)} />
      ) : (
        <div className="panel">
          <div className="toolbar">
            <input type="search" className="toolbar-search" placeholder="Search by Loan ID, form ID, borrower or group code / name" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search loan" />
          </div>
          {q.trim().length < 2 ? <EmptyState title="Search a loan" description="Type at least 2 letters of the Loan ID (for example LN00000001), borrower or group." /> : searching && !results.length ? <Spinner label="Searching…" /> : results.length === 0 ? (
            <EmptyState title="No loan found" description="Only loans that have been paid out can take EMI. Check the Loan ID." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Loan ID</th><th>Form ID</th><th>Borrower / Group</th><th>Branch</th><th>Scheme</th><th>Paid on</th><th className="num">Installments</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {results.map((l) => (
                    <tr key={l.id}>
                      <td data-label="Loan ID"><strong>{l.loanId || '—'}</strong></td>
                      <td data-label="Form ID">{l.formId}</td>
                      <td data-label="Borrower">{l.who}</td>
                      <td data-label="Branch">{l.branch}</td>
                      <td data-label="Scheme">{l.schemeName}</td>
                      <td data-label="Paid on">{dmy(l.paidOn)}</td>
                      <td data-label="Installments" className="num">{l.installments}</td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm primary" onClick={() => setLoanId(l.id)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export const RegularEmi = () => <EmiPaymentPage advance={false} />;
export const AdvanceEmi = () => <EmiPaymentPage advance />;

export function EmiReceipts() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1, totalAmount: 0 });
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('paid');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.emi.payments({ page, limit: LIMIT, type, status, branch, from, to, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, type, status, branch, from, to, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [type, status, branch, from, to, q]);

  async function cancel() {
    if (reason.trim().length < 3) return setReasonError('Enter the reason');
    setBusy(true);
    try {
      await api.emi.cancel(cancelling.id, reason.trim());
      toast.success('EMI payment cancelled');
      setCancelling(null);
      setReason('');
      load();
    } catch (err) {
      setReasonError(err.errors?.reason || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="EMI Receipts" description="EMI and advance EMI received. Open a payment to see its installments and print the receipt." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <input type="search" className="toolbar-search" placeholder="Search receipt no, Loan ID, borrower or group" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <option value="">EMI and advance EMI</option>
            <option value="regular">EMI</option>
            <option value="advance">Advance EMI</option>
          </select>
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          )}
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          {isAdmin && (
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="paid">Received</option>
              <option value="cancelled">Cancelled</option>
            </select>
          )}
        </div>
        {loading && !data.items.length ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : data.items.length === 0 ? (
          <EmptyState title="No EMI payments" description="EMI payments appear here with their receipt." />
        ) : (
          <>
            <div className="muted small" style={{ margin: '6px 0' }}>{data.total} payment{data.total === 1 ? '' : 's'} · total {inr(data.totalAmount)}</div>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Receipt</th><th>Date</th><th>Loan ID</th><th>Borrower</th><th>Branch</th><th>Type</th><th>Installments</th><th className="num">Amount</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Receipt"><strong>{p.receiptNo}</strong></td>
                      <td data-label="Date">{dmy(p.paidOn)}</td>
                      <td data-label="Loan ID">{p.loanId || p.formId}</td>
                      <td data-label="Borrower"><strong>{p.memberCode}</strong> {p.memberName}{p.group && <div className="muted small">{p.group}</div>}</td>
                      <td data-label="Branch">{p.branch?.name || '—'}</td>
                      <td data-label="Type"><span className={`badge ${p.type === 'advance' ? 'grey' : 'green'}`}>{p.type === 'advance' ? 'Advance' : 'EMI'}</span></td>
                      <td data-label="Installments">{p.installments.length > 1 ? `${p.installments[0]}–${p.installments[p.installments.length - 1]}` : p.installments[0]} <span className="muted small">({p.installments.length})</span></td>
                      <td data-label="Amount" className="num">{inr(p.amount)}</td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setReceipt(p)}>Receipt</button>
                          {isAdmin && p.status === 'paid' && <button className="btn sm danger-outline" onClick={() => { setCancelling(p); setReason(''); setReasonError(''); }}>Cancel</button>}
                        </div>
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
      {receipt && <ReceiptDialog payment={receipt} onClose={() => setReceipt(null)} />}
      {cancelling && (
        <Modal open title={`Cancel ${cancelling.receiptNo}?`} onClose={() => setCancelling(null)} busy={busy}
          footer={<><button className="btn" onClick={() => setCancelling(null)} disabled={busy}>Keep</button><button className="btn danger-outline" onClick={cancel} disabled={busy}>Cancel payment</button></>}>
          <p style={{ marginTop: 0 }}>The installments of this receipt become unpaid again. Only the latest EMI of a borrower can be cancelled.</p>
          <FormField id="ecreason" label="Reason" required error={reasonError}>
            <input id="ecreason" value={reason} maxLength={200} autoFocus onChange={(e) => { setReason(e.target.value); setReasonError(''); }} />
          </FormField>
        </Modal>
      )}
    </>
  );
}

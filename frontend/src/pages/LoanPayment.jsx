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
const PAYERS = ['super_admin', 'admin', 'branch_manager', 'accountant'];
const KINDS = [['', 'All loans'], ['personal', 'Personal'], ['group', 'Group'], ['business', 'Business / MSME'], ['product', 'Product']];
const MODE_LABEL = { cash: 'Cash', bank: 'Bank transfer', upi: 'UPI', cheque: 'Cheque' };
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Opens the receipt in its own window and prints it.
function printReceipt(p) {
  const rows = p.lines.map((l) => `
    <div class="card">
      <div class="who"><b>${esc(l.code)}</b> — ${esc(l.name)}</div>
      <table>
        <tr><td>Loan amount</td><td class="n">${inr(l.amount)}</td></tr>
        <tr><td>Processing fee</td><td class="n">− ${inr(l.processingFee)}</td></tr>
        <tr><td>Insurance fee</td><td class="n">− ${inr(l.insuranceFee)}</td></tr>
        <tr><td>Security</td><td class="n">− ${inr(l.security)}</td></tr>
        <tr><td>Product${l.products.length ? ` (${l.products.map((x) => `${esc(x.name)} × ${x.quantity}`).join(', ')})` : ''}</td><td class="n">− ${inr(l.product)}</td></tr>
        <tr class="tot"><td>${l.cash < 0 ? 'To be paid by the borrower' : 'Balance cash paid'}</td><td class="n">${inr(Math.abs(l.cash))}</td></tr>
      </table>
    </div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(p.receiptNo)}</title>
  <style>body{font-family:Arial,sans-serif;max-width:720px;margin:24px auto;color:#111;font-size:14px}h1{margin:0;font-size:20px}.muted{color:#555}
  .head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}table{width:100%;border-collapse:collapse}
  td{padding:4px 6px;border-bottom:1px solid #ddd}.n{text-align:right}.tot td{font-weight:bold;border-top:2px solid #111}.card{border:1px solid #bbb;border-radius:6px;padding:10px;margin:10px 0;page-break-inside:avoid}
  .meta td{border:0;padding:2px 6px}.sign{display:flex;justify-content:space-between;margin-top:48px}.sign div{border-top:1px solid #111;padding-top:4px;width:40%;text-align:center}</style></head><body>
  <div class="head"><div><h1>Udgam Microfinance</h1><div class="muted">Loan payment receipt</div></div><div style="text-align:right"><b>${esc(p.receiptNo)}</b><br>${dmy(p.paidOn)}</div></div>
  <table class="meta">
    <tr><td>Form ID</td><td><b>${esc(p.formId)}</b></td><td>Branch</td><td>${esc(p.branch ? `${p.branch.code} — ${p.branch.name}` : '')}</td></tr>
    <tr><td>Scheme</td><td>${esc(p.schemeName)}</td><td>Interest</td><td>${p.rate}% p.a.</td></tr>
    <tr><td>Installments</td><td>${p.installments} (${esc(p.modeLabel)}) of ${inr(p.emi)}</td><td>Paid by</td><td>${esc(MODE_LABEL[p.payMode] || p.payMode)}${p.reference ? ` · ${esc(p.reference)}` : ''}</td></tr>
    <tr><td>First installment</td><td>${dmy(p.emiStartDate)}</td><td>Last installment</td><td>${dmy(p.emiEndDate)}</td></tr>
    ${p.group ? `<tr><td>Group</td><td colspan="3">${esc(p.group)}</td></tr>` : ''}
  </table>
  ${rows}
  <table><tr class="tot"><td>Total ${p.lines.length > 1 ? `(${p.lines.length} members)` : ''} cash paid</td><td class="n">${inr(p.totalCash)}</td></tr></table>
  <div class="sign"><div>Borrower's signature</div><div>Authorised signatory</div></div>
  <script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

function ReceiptDialog({ payment, onClose, onPrintFailed }) {
  const p = payment;
  return (
    <Modal open title={`Receipt ${p.receiptNo}`} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => { if (!printReceipt(p)) onPrintFailed(); }}>Print receipt</button></>}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {p.formId} · {p.branch?.name} · Paid {dmy(p.paidOn)} by {MODE_LABEL[p.payMode]}{p.reference ? ` (${p.reference})` : ''} · First installment {dmy(p.emiStartDate)} · Last installment {dmy(p.emiEndDate)}
        {p.status === 'cancelled' && <span className="badge danger" style={{ marginLeft: 8 }}>Cancelled: {p.cancelReason}</span>}
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Borrower</th><th className="num">Loan amount</th><th className="num">Processing</th><th className="num">Insurance</th><th className="num">Security</th><th className="num">Product</th><th className="num">Cash paid</th></tr></thead>
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.code}>
                <td data-label="Borrower"><strong>{l.code}</strong> {l.name}</td>
                <td data-label="Amount" className="num">{inr(l.amount)}</td>
                <td data-label="Processing" className="num">{inr(l.processingFee)}</td>
                <td data-label="Insurance" className="num">{inr(l.insuranceFee)}</td>
                <td data-label="Security" className="num">{inr(l.security)}</td>
                <td data-label="Product" className="num">{inr(l.product)}{l.products.map((x, i) => <div key={i} className="muted small">{x.name} × {x.quantity}</div>)}</td>
                <td data-label="Cash" className="num"><strong>{inr(l.cash)}</strong></td>
              </tr>
            ))}
            {p.lines.length > 1 && <tr><td colSpan={6}><strong>Total cash</strong></td><td className="num"><strong>{inr(p.totalCash)}</strong></td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// Pay an approved loan: dates, deductions, optional products from the branch stock, then the balance cash.
function PayDialog({ id, onClose, onPaid }) {
  const toast = useToast();
  const [prep, setPrep] = useState(null);
  const [error, setError] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [emiStart, setEmiStart] = useState('');
  const [payMode, setPayMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [items, setItems] = useState([]); // { member, stockProduct, quantity }
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const dPaid = useDebounce(paidOn, 300);
  const dStart = useDebounce(emiStart, 300);

  const load = useCallback((p, s) => api.loanPayments.prepare(id, { paidOn: p || undefined, emiStartDate: s || undefined })
    .then((r) => { setPrep(r); setError(''); return r; }), [id]);
  useEffect(() => {
    load().then((r) => { setPaidOn(r.dates.paidOn); setEmiStart(r.dates.emiStartDate); }).catch((e) => setError(e.message));
  }, [load]);
  // The last installment date follows the payment date and the first installment date.
  useEffect(() => {
    if (!prep || !dPaid || !dStart) return;
    if (dPaid === prep.dates.paidOn && dStart === prep.dates.emiStartDate) return;
    load(dPaid, dStart).then((r) => setErrors((x) => ({ ...x, paidOn: undefined, emiStartDate: undefined, dates: undefined, _r: r && undefined }))).catch((e) => setErrors((x) => ({ ...x, paidOn: e.errors?.paidOn, emiStartDate: e.errors?.emiStartDate, dates: e.message })));
  }, [dPaid, dStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const stock = prep?.stock || [];
  const isGroup = prep?.requisition.kind === 'group';
  const isProduct = prep?.requisition.kind === 'product';
  const lines = (prep?.lines || []).map((l) => {
    const mine = items.filter((it) => (isGroup ? String(it.member) === String(l.member) : true) && it.stockProduct);
    const product = mine.reduce((s, it) => s + (stock.find((x) => x.id === it.stockProduct)?.unitPrice || 0) * (Number(it.quantity) || 0), 0);
    return { ...l, addedProduct: product, cash: Math.round((l.cash - product) * 100) / 100 };
  });
  const totalCash = lines.reduce((s, l) => s + l.cash, 0);
  const setItem = (i, patch) => setItems((x) => x.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  async function pay() {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.loanPayments.pay({
        requisition: id, paidOn, emiStartDate: emiStart, payMode, reference,
        items: items.filter((it) => it.stockProduct).map((it) => ({ member: isGroup ? it.member : undefined, stockProduct: it.stockProduct, quantity: Number(it.quantity) || 1 })),
      });
      toast.success(`Loan paid — receipt ${r.payment.receiptNo}`);
      onPaid(r.payment);
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const r = prep?.requisition;
  return (
    <Modal open title={r ? `Pay loan ${r.formId}` : 'Pay loan'} onClose={onClose} size="lg" busy={busy} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {error ? <ErrorState message={error} /> : !prep ? <Spinner label="Loading…" /> : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            {r.subject} · {r.schemeName} · {r.term} {r.modeLabel} installments of {inr(r.emi)} · {r.rate}% p.a. · loan date {dmy(r.loanDate)}
          </p>
          <div className="form-grid">
            <FormField id="ppaidOn" label="Payment date" required error={errors.paidOn}>
              <input id="ppaidOn" type="date" max={new Date().toISOString().slice(0, 10)} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </FormField>
            <FormField id="pstart" label="First installment date" error={errors.emiStartDate} hint="One period after the payment date, unless you change it">
              <input id="pstart" type="date" value={emiStart} onChange={(e) => setEmiStart(e.target.value)} />
            </FormField>
            <FormField id="pend" label="Last installment date" hint="Worked out from the first installment">
              <input id="pend" value={dmy(prep.dates.emiEndDate)} disabled />
            </FormField>
            <FormField id="pmode" label="Paid by" required error={errors.payMode}>
              <select id="pmode" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            <FormField id="pref" label="Reference no." hint="Optional (UTR, cheque no.)">
              <input id="pref" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
            </FormField>
          </div>
          {errors.dates && <div className="field-error" role="alert">{errors.dates}</div>}

          {isProduct ? (
            <div className="notice" style={{ margin: '10px 0' }}>Product loan: {prep.productLoan.name} × {prep.productLoan.quantity} ({inr(prep.productLoan.value)}) is handed over with this payment.</div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <h3 className="section-title">Add product (from stock)</h3>
              <div className="muted small" style={{ marginBottom: 6 }}>A product taken at payment time is deducted from the cash. It comes out of this branch's stock.</div>
              {errors.items && <div className="field-error" role="alert">{errors.items}</div>}
              {items.map((it, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  {isGroup && (
                    <select aria-label="Member" value={it.member} onChange={(e) => setItem(i, { member: e.target.value })}>
                      <option value="">Select member</option>
                      {prep.lines.map((l) => <option key={l.member} value={l.member}>{l.code} — {l.name}</option>)}
                    </select>
                  )}
                  <select aria-label="Product" style={{ flex: 1, minWidth: 200 }} value={it.stockProduct} onChange={(e) => setItem(i, { stockProduct: e.target.value })}>
                    <option value="">{stock.length ? 'Select product' : 'No product in stock'}</option>
                    {stock.map((s) => <option key={s.id} value={s.id}>{s.name} · {inr(s.unitPrice)} · {s.stockQty} in stock</option>)}
                  </select>
                  <input aria-label="Units" inputMode="numeric" style={{ width: 70 }} value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
                  <button type="button" className="btn sm danger-outline" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn sm" disabled={!stock.length} onClick={() => setItems((x) => [...x, { member: isGroup ? '' : prep.lines[0].member, stockProduct: '', quantity: '1' }])}>+ Add product</button>
            </div>
          )}

          <h3 className="section-title" style={{ marginTop: 14 }}>Payment</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Borrower</th><th className="num">Loan amount</th><th className="num">Processing</th><th className="num">Insurance</th><th className="num">Security</th><th className="num">Product</th><th className="num">Balance cash</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.member}>
                    <td data-label="Borrower"><strong>{l.code}</strong> {l.name}</td>
                    <td data-label="Amount" className="num">{inr(l.amount)}</td>
                    <td data-label="Processing" className="num">− {inr(l.processingFee)}</td>
                    <td data-label="Insurance" className="num">− {inr(l.insuranceFee)}</td>
                    <td data-label="Security" className="num">− {inr(l.security)}</td>
                    <td data-label="Product" className="num">− {inr(l.product + l.addedProduct)}</td>
                    <td data-label="Cash" className="num"><strong>{inr(l.cash)}</strong></td>
                  </tr>
                ))}
                {lines.length > 1 && <tr><td colSpan={6}><strong>Total cash to pay</strong></td><td className="num"><strong>{inr(totalCash)}</strong></td></tr>}
              </tbody>
            </table>
          </div>
          {errors.amount && <div className="field-error" role="alert">{errors.amount}</div>}
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={busy || Boolean(errors.dates)} onClick={pay}>{busy ? 'Paying…' : `Pay ${isProduct && totalCash <= 0 ? '(hand over goods)' : inr(totalCash)} and generate receipt`}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Filters({ f, set, branches, groups, showGroup }) {
  const hasFilters = f.kind || f.branch || f.group || f.from || f.to || f.search;
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {KINDS.map(([k, label]) => <button key={k} className={`btn sm${f.kind === k ? ' primary' : ''}`} onClick={() => set({ kind: k })}>{label}</button>)}
      </div>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <input type="search" className="toolbar-search" placeholder="Search form ID, receipt no, borrower or group" value={f.search} onChange={(e) => set({ search: e.target.value })} aria-label="Search" />
        {branches.length > 1 && (
          <select value={f.branch} onChange={(e) => set({ branch: e.target.value, group: '' })} aria-label="Branch">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        )}
        {showGroup && (
          <select value={f.group} onChange={(e) => set({ group: e.target.value })} aria-label="Group" disabled={!groups.length}>
            <option value="">{groups.length ? 'All groups' : 'Select a branch to filter groups'}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
          </select>
        )}
        <input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
        <input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
        {hasFilters && <button className="btn" onClick={() => set({ kind: '', branch: '', group: '', from: '', to: '', search: '' })}>Clear</button>}
      </div>
    </>
  );
}

function useFilters() {
  const [f, setF] = useState({ kind: '', branch: '', group: '', from: '', to: '', search: '' });
  const [branches, setBranches] = useState([]);
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);
  const branchForGroups = f.branch || (branches.length === 1 ? branches[0].id : '');
  useEffect(() => {
    if (!branchForGroups) return setGroups([]);
    api.loanRequisitions.groups({ branch: branchForGroups }).then((r) => setGroups(r.items)).catch(() => setGroups([]));
    return undefined;
  }, [branchForGroups]);
  return { f, set: (patch) => setF((x) => ({ ...x, ...patch })), branches, groups };
}

export function PendingPayments() {
  const { user } = useAuth();
  const toast = useToast();
  const canPay = PAYERS.includes(user?.role);
  const { f, set, branches, groups } = useFilters();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [payId, setPayId] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const q = useDebounce(f.search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.loanRequisitions.list({ page, limit: LIMIT, status: 'approved', disbursed: 'no', kind: f.kind, branch: f.branch, group: f.group, from: f.from, to: f.to, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, f.kind, f.branch, f.group, f.from, f.to, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [f.kind, f.branch, f.group, f.from, f.to, q]);

  return (
    <>
      <PageHeader title="Pending Payment" description="Approved loans waiting to be paid. Pay a loan to take off the charges and any product, set the installment dates and print the receipt." />
      <div className="panel">
        <Filters f={f} set={set} branches={branches} groups={groups} showGroup />
        {loading && !data.items.length ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : data.items.length === 0 ? (
          <EmptyState title="No loan is waiting for payment" description="Loans appear here once they are approved." />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Form ID</th><th>Loan date</th><th>Type</th><th>Borrower / Group</th><th>Branch</th><th>Scheme</th><th className="num">Amount</th><th className="num">Cash after charges</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Form ID"><strong>{r.formId}</strong></td>
                      <td data-label="Loan date">{r.loanDate}</td>
                      <td data-label="Type">{r.kindLabel}</td>
                      <td data-label="Borrower">{r.subjectCode} — {r.subjectName}</td>
                      <td data-label="Branch">{r.branch?.name || '—'}</td>
                      <td data-label="Scheme">{r.schemeName}</td>
                      <td data-label="Amount" className="num">{inr(r.amount)}{r.kind === 'group' && <div className="muted small">× {r.memberCount} = {inr(r.totalAmount)}</div>}</td>
                      <td data-label="Cash" className="num">{r.kind === 'product' ? '—' : inr(r.totalCash)}</td>
                      <td data-label="Actions" className="actions-col">{canPay ? <button className="btn sm primary" onClick={() => setPayId(r.id)}>Pay</button> : <span className="muted">Waiting</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>
      {payId && <PayDialog id={payId} onClose={() => setPayId(null)} onPaid={(p) => { setPayId(null); setReceipt(p); load(); }} />}
      {receipt && <ReceiptDialog payment={receipt} onClose={() => setReceipt(null)} onPrintFailed={() => toast.error('Allow pop-ups to print the receipt')} />}
    </>
  );
}

export function PaidLoans() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const { f, set, branches } = useFilters();
  const [status, setStatus] = useState('paid');
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [receipt, setReceipt] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useDebounce(f.search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.loanPayments.list({ page, limit: LIMIT, status, kind: f.kind, branch: f.branch, from: f.from, to: f.to, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, status, f.kind, f.branch, f.from, f.to, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [status, f.kind, f.branch, f.from, f.to, q]);

  async function cancel() {
    if (reason.trim().length < 3) return setReasonError('Enter the reason');
    setBusy(true);
    try {
      await api.loanPayments.cancel(cancelling.id, reason.trim());
      toast.success('Payment cancelled — the loan is back in Pending Payment');
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
      <PageHeader title="Paid Loans & Receipts" description="Loans that have been paid out. Open a payment to see the deductions and print the receipt." />
      <div className="panel">
        <Filters f={f} set={set} branches={branches} groups={[]} showGroup={false} />
        {isAdmin && (
          <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
            <button className={`btn sm${status === 'paid' ? ' primary' : ''}`} onClick={() => setStatus('paid')}>Paid</button>
            <button className={`btn sm${status === 'cancelled' ? ' primary' : ''}`} onClick={() => setStatus('cancelled')}>Cancelled</button>
          </div>
        )}
        {loading && !data.items.length ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : data.items.length === 0 ? (
          <EmptyState title={status === 'cancelled' ? 'No cancelled payment' : 'No paid loans yet'} description="Paid loans appear here with their receipt." />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Receipt</th><th>Paid on</th><th>Form ID</th><th>Type</th><th>Borrower / Group</th><th>Branch</th><th className="num">Loan amount</th><th className="num">Cash paid</th><th>First / last installment</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Receipt"><strong>{p.receiptNo}</strong></td>
                      <td data-label="Paid on">{dmy(p.paidOn)}</td>
                      <td data-label="Form ID">{p.formId}</td>
                      <td data-label="Type">{p.kind}</td>
                      <td data-label="Borrower">{p.group || `${p.lines[0]?.code} — ${p.lines[0]?.name}`}{p.lines.length > 1 && <div className="muted small">{p.lines.length} members</div>}</td>
                      <td data-label="Branch">{p.branch?.name || '—'}</td>
                      <td data-label="Amount" className="num">{inr(p.totalAmount)}</td>
                      <td data-label="Cash" className="num">{inr(p.totalCash)}</td>
                      <td data-label="Installments">{dmy(p.emiStartDate)} → {dmy(p.emiEndDate)}</td>
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
      {receipt && <ReceiptDialog payment={receipt} onClose={() => setReceipt(null)} onPrintFailed={() => toast.error('Allow pop-ups to print the receipt')} />}
      {cancelling && (
        <Modal open title={`Cancel payment ${cancelling.receiptNo}?`} onClose={() => setCancelling(null)} busy={busy}
          footer={<><button className="btn" onClick={() => setCancelling(null)} disabled={busy}>Keep</button><button className="btn danger-outline" onClick={cancel} disabled={busy}>Cancel payment</button></>}>
          <p style={{ marginTop: 0 }}>The loan goes back to Pending Payment and any product added at payment time returns to stock.</p>
          <FormField id="creason" label="Reason" required error={reasonError}>
            <input id="creason" value={reason} maxLength={200} autoFocus onChange={(e) => { setReason(e.target.value); setReasonError(''); }} />
          </FormField>
        </Modal>
      )}
    </>
  );
}

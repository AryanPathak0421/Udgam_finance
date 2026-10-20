import BankAccountSelect from '../components/BankAccountSelect.jsx';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';

const MODE_LABEL = { cash: 'Cash', bank: 'Bank', upi: 'UPI', cheque: 'Cheque', security: 'Security' };
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');
const today = () => new Date().toISOString().slice(0, 10);

// One side of the cashbook: a line for everything that is received (or paid), the amount, and what it is made of when clicked.
function Side({ title, lines, rows, total, totalLabel, openRow, closeRow, tone, extra, canDelete, onDelete }) {
  const [open, setOpen] = useState('');
  return (
    <div className="panel" style={{ padding: 14, flex: '1 1 420px', minWidth: 0 }}>
      <h3 className="section-title">{title}</h3>
      <div className="table-wrap">
        <table className="data-table">
          <tbody>
            {openRow}
            {lines.map((l) => {
              const mine = rows.filter((r) => r.cat === l.key);
              return (
                <Fragment key={l.key}>
                  <tr style={l.memo ? { opacity: 0.65, fontStyle: 'italic' } : undefined}>
                    <td data-label="Particulars">
                      {mine.length > 0 ? <button type="button" className="link-btn" onClick={() => setOpen(open === l.key ? '' : l.key)}>{open === l.key ? '▾' : '▸'} {l.label}</button> : l.label}
                      {l.memo && <div className="muted small">for information, not in the total</div>}
                    </td>
                    <td data-label="Entries" className="num muted small">{l.count || ''}</td>
                    <td data-label="Amount" className="num">{inr(l.amount)}</td>
                  </tr>
                  {open === l.key && mine.length > 0 && (
                    <tr>
                      <td colSpan={3} style={{ background: 'var(--surface-2, #f6f8f8)' }}>
                        <table className="data-table" style={{ margin: 0 }}>
                          <thead><tr><th>Date</th><th>Particulars</th><th>Mode</th><th className="num">Amount</th>{canDelete && <th />}</tr></thead>
                          <tbody>
                            {mine.map((r, i) => (
                              <tr key={i}>
                                <td data-label="Date">{dmy(r.date)}</td>
                                <td data-label="Particulars">{r.particulars || '—'}<div className="muted small">{r.branch}{r.ref ? ` · ${r.ref}` : ''}</div></td>
                                <td data-label="Mode">{MODE_LABEL[r.mode] || r.mode || '—'}</td>
                                <td data-label="Amount" className="num">{inr(r.amount)}</td>
                                {canDelete && <td>{r.manual && <button type="button" className="btn sm danger-outline" onClick={() => onDelete(r)}>Remove</button>}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr style={{ borderTop: '2px solid currentColor' }}>
              <td><strong>{totalLabel}</strong></td><td />
              <td className="num"><span className={`badge ${tone}`}><strong>{inr(total)}</strong></span></td>
            </tr>
            {closeRow}
          </tbody>
        </table>
      </div>
      {extra}
    </div>
  );
}

// Add a line typed in by hand: cash fund, NPA, voucher, bank / cash deposit, fund transfer, staff salary, other.
function EntryDialog({ cats, ledgers, branches, isAdmin, defaultBranch, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ side: 'receive', category: '', branch: defaultBranch, date: today(), amount: '', mode: 'cash', bankAccount: '', remark: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'side' ? { category: '' } : {}) })); setErrors((x) => ({ ...x, [k]: undefined })); };
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const isLedger = form.category.startsWith('ledger:');
      await api.cashbookEntry({ ...form, category: isLedger ? '' : form.category, ledger: isLedger ? form.category.slice(7) : undefined });
      toast.success('Entry added to the cashbook');
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="Add a cashbook entry" onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add entry'}</button></>}>
      <div className="form-grid">
        <FormField id="cside" label="Side" required error={errors.side}>
          <select id="cside" value={form.side} onChange={set('side')}>
            <option value="receive">Receive side</option>
            <option value="payment">Payment side</option>
          </select>
        </FormField>
        <FormField id="ccat" label="For" required error={errors.category}>
          <select id="ccat" value={form.category} onChange={set('category')}>
            <option value="">Select</option>
            {(cats[form.side] || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            {(ledgers?.[form.side] || []).length > 0 && (
              <optgroup label={form.side === 'receive' ? 'Ledger master (credit)' : 'Ledger master (debit)'}>
                {ledgers[form.side].map((l) => <option key={l.id} value={`ledger:${l.id}`}>{l.name}</option>)}
              </optgroup>
            )}
          </select>
        </FormField>
        {(branches.length > 1 || isAdmin) && (
          <FormField id="cbranch" label="Cashbook of" required error={errors.branch}>
            <select id="cbranch" value={form.branch} onChange={set('branch')}>
              <option value="">Select</option>
              {isAdmin && <option value="ho">Head office</option>}
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </FormField>
        )}
        <FormField id="cdate" label="Date" required error={errors.date}><input id="cdate" type="date" max={today()} value={form.date} onChange={set('date')} /></FormField>
        <FormField id="camount" label="Amount (₹)" required error={errors.amount}>
          <input id="camount" inputMode="decimal" value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })); setErrors((x) => ({ ...x, amount: undefined })); }} />
        </FormField>
        <FormField id="cmode" label="By" required error={errors.mode}>
          <select id="cmode" value={form.mode} onChange={set('mode')}>
            {['cash', 'bank', 'upi', 'cheque'].map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
        </FormField>
        <BankAccountSelect id="cbank" mode={form.mode} value={form.bankAccount} onChange={(v) => setForm((f) => ({ ...f, bankAccount: v }))} error={errors.bankAccount} />
        <FormField id="cremark" label="Remark" className="span-2" hint="For example the bank, the person or the voucher number"><input id="cremark" value={form.remark} maxLength={200} onChange={set('remark')} /></FormField>
      </div>
    </Modal>
  );
}

// Cashbook: the receive side and the payment side line by line, with the opening balance, the totals and the closing balance.
export default function Cashbook() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [mode, setMode] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.cashbook({ branch, from, to, mode }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [branch, from, to, mode]);
  useEffect(() => {
    load();
  }, [load]);

  async function remove(r) {
    try {
      await api.cashbookEntryDelete(r.entryId);
      toast.success('Entry removed');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <PageHeader title="Cashbook" description="Receive side and payment side line by line, with the opening balance, the totals and the closing balance. Click a line to see what it is made of. Cash fund, NPA, voucher, deposits, fund transfer and salary are added by hand." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          {(branches.length > 1 || isAdmin) && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="">{isAdmin ? 'All branches and head office' : 'All my branches'}</option>
              {isAdmin && <option value="ho">Head office</option>}
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          )}
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Payment mode">
            <option value="">All modes</option>
            <option value="cash">Cash only</option>
            <option value="bank">Bank</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
          </select>
          <button className="btn" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
          <button className="btn primary" onClick={() => setAdding(true)}>Add entry</button>
        </div>
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : !data ? <EmptyState title="No data" /> : (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <Side title="Receive side" lines={data.receiveLines} rows={data.receipts} total={data.totals.grand} totalLabel="Grand total (opening + receipts)" tone="green" canDelete={isAdmin} onDelete={remove}
              openRow={<tr><td><strong>Opening balance</strong></td><td /><td className="num"><strong>{inr(data.opening)}</strong></td></tr>}
              extra={<div className="muted small" style={{ marginTop: 6 }}>Receipts in the period {inr(data.totals.receipts)}</div>} />
            <Side title="Payment side" lines={data.paymentLines} rows={data.payments} total={data.totals.payments} totalLabel="Total" tone="danger" canDelete={isAdmin} onDelete={remove}
              closeRow={<><tr><td><strong>Closing balance</strong></td><td /><td className="num"><span className="badge grey"><strong>{inr(data.closing)}</strong></span></td></tr><tr style={{ borderTop: '2px solid currentColor' }}><td><strong>Grand total (payments + closing)</strong></td><td /><td className="num"><span className="badge danger"><strong>{inr(data.totals.grand)}</strong></span></td></tr></>}
              extra={<div className="muted small" style={{ marginTop: 6 }}>"Today due" is the EMI still to be collected up to {dmy(data.asOf)}; it is part of the payment total.</div>} />
          </div>
        )}
      </div>
      {adding && data && (
        <EntryDialog cats={data.entryCategories} ledgers={data.ledgers} branches={branches} isAdmin={isAdmin} defaultBranch={branch && branch !== '' ? branch : branches.length === 1 ? branches[0].id : ''} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />
      )}
    </>
  );
}

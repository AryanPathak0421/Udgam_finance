import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { compressImage } from '../utils/image.js';

const LIMIT = 25;
const SETTLERS = ['super_admin', 'admin', 'branch_manager', 'accountant'];
const MODE_LABEL = { cash: 'Cash', bank: 'Bank transfer', upi: 'UPI', cheque: 'Cheque' };
const MAX_DOC_BYTES = 800 * 1024;
const todayISO = () => new Date().toISOString().slice(0, 10);
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Opens the settlement receipt in its own window and prints it.
function printSettlement(s) {
  const death = s.kind === 'death';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.receiptNo)}</title>
  <style>body{font-family:Arial,sans-serif;max-width:680px;margin:24px auto;color:#111;font-size:14px}h1{margin:0;font-size:20px}.muted{color:#555}
  .head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}table{width:100%;border-collapse:collapse;margin:8px 0}
  td{padding:5px 6px;border-bottom:1px solid #ddd}.n{text-align:right}.tot td{font-weight:bold;border-top:2px solid #111}
  .sign{display:flex;justify-content:space-between;margin-top:48px}.sign div{border-top:1px solid #111;padding-top:4px;width:40%;text-align:center}</style></head><body>
  <div class="head"><div><h1>Udgam Microfinance</h1><div class="muted">${death ? 'Death settlement' : 'Loan settlement'}</div></div><div style="text-align:right"><b>${esc(s.receiptNo)}</b><br>${dmy(s.settledOn)}</div></div>
  <table><tr><td>Loan ID</td><td><b>${esc(s.loanId || s.formId)}</b></td><td>Branch</td><td>${esc(s.branch ? `${s.branch.code} — ${s.branch.name}` : '')}</td></tr>
  <tr><td>Borrower</td><td><b>${esc(s.memberCode)}</b> ${esc(s.memberName)}</td><td>${s.group ? 'Group' : ''}</td><td>${esc(s.group)}</td></tr>
  ${death ? `<tr><td>Date of death</td><td>${dmy(s.deathDate)}</td><td>Verified by</td><td>${esc(s.verifier?.code)} ${esc(s.verifier?.name)}</td></tr>${s.claimRef ? `<tr><td>Insurance claim</td><td colspan="3">${esc(s.claimRef)}</td></tr>` : ''}` : `<tr><td>Paid by</td><td>${esc(MODE_LABEL[s.payMode] || '—')}${s.reference ? ` · ${esc(s.reference)}` : ''}</td><td></td><td></td></tr>`}
  </table>
  <table><tr><td>Outstanding at settlement</td><td class="n">${inr(s.outstanding)}</td></tr>
  <tr><td>${death ? 'Settled against insurance (written off)' : 'Waived'}</td><td class="n">${inr(s.waiver)}</td></tr>
  <tr class="tot"><td>Amount received</td><td class="n">${inr(s.amount)}</td></tr></table>
  ${s.remark ? `<p>Remark: ${esc(s.remark)}</p>` : ''}
  <div class="sign"><div>${death ? 'Verifier' : "Borrower's signature"}</div><div>Authorised signatory</div></div>
  <script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank', 'width=780,height=900');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

function SettlementDialog({ settlement: s, onClose }) {
  const toast = useToast();
  const [full, setFull] = useState(null);
  useEffect(() => {
    if (s.kind === 'death') api.settlements.get(s.id).then((r) => setFull(r.settlement)).catch(() => {});
  }, [s]);
  const cert = full?.certificate;
  return (
    <Modal open title={`${s.kind === 'death' ? 'Death settlement' : 'Loan settlement'} ${s.receiptNo}`} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => { if (!printSettlement(s)) toast.error('Allow pop-ups to print'); }}>Print</button></>}>
      <DetailList items={[
        ['Loan ID', s.loanId || s.formId], ['Branch', s.branch ? `${s.branch.code} — ${s.branch.name}` : ''], ['Borrower', `${s.memberCode} — ${s.memberName}`], ...(s.group ? [['Group', s.group]] : []),
        ['Settlement date', dmy(s.settledOn)], ['Outstanding', inr(s.outstanding)], [s.kind === 'death' ? 'Settled against insurance' : 'Waived', inr(s.waiver)], ['Amount received', inr(s.amount)],
        ...(s.kind === 'loan' && s.payMode ? [['Paid by', `${MODE_LABEL[s.payMode]}${s.reference ? ` · ${s.reference}` : ''}`]] : []),
        ...(s.kind === 'death' ? [['Date of death', dmy(s.deathDate)], ['Verified by', s.verifier ? `${s.verifier.code} — ${s.verifier.name}` : ''], ...(s.claimRef ? [['Insurance claim', s.claimRef]] : [])] : []),
        ...(s.remark ? [['Remark', s.remark]] : []), ['Status', s.status === 'cancelled' ? `Cancelled: ${s.cancelReason}` : 'Settled'],
      ]} />
      {s.kind === 'death' && (
        <div style={{ marginTop: 12 }}>
          <div className="detail-label">Death certificate</div>
          {!full ? <Spinner label="Loading…" /> : cert?.startsWith('data:image') ? <img src={cert} alt="Death certificate" className="stamp-img" style={{ maxWidth: '100%' }} /> : cert ? <a className="btn sm" href={cert} target="_blank" rel="noreferrer" download={`${s.receiptNo}-death-certificate`}>Open / download</a> : <span className="muted">—</span>}
        </div>
      )}
    </Modal>
  );
}

// Search a loan (Loan ID, form ID, borrower, group), then choose the borrower of it.
function LoanFinder({ onPick }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const q = useDebounce(search);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let live = true;
    setSearching(true);
    api.emi.search(q.trim()).then((r) => live && setResults(r.items)).catch(() => live && setResults([])).finally(() => live && setSearching(false));
    return () => {
      live = false;
    };
  }, [q]);
  return (
    <div className="panel">
      <div className="toolbar">
        <input type="search" className="toolbar-search" placeholder="Search by Loan ID, form ID, borrower or group code / name" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search loan" />
      </div>
      {q.trim().length < 2 ? <EmptyState title="Search a loan" description="Type at least 2 letters of the Loan ID (for example LN00000001), borrower or group." /> : searching && !results.length ? <Spinner label="Searching…" /> : results.length === 0 ? (
        <EmptyState title="No loan found" description="Only loans that have been paid out can be settled." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Loan ID</th><th>Form ID</th><th>Borrower / Group</th><th>Branch</th><th>Scheme</th><th>Paid on</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {results.map((l) => (
                <tr key={l.id}>
                  <td data-label="Loan ID"><strong>{l.loanId || '—'}</strong></td>
                  <td data-label="Form ID">{l.formId}</td>
                  <td data-label="Borrower">{l.who}</td>
                  <td data-label="Branch">{l.branch}</td>
                  <td data-label="Scheme">{l.schemeName}</td>
                  <td data-label="Paid on">{dmy(l.paidOn)}</td>
                  <td data-label="Actions" className="actions-col"><button className="btn sm primary" onClick={() => onPick(l)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// The loan and its borrower(s): a group loan asks which member.
function BorrowerStep({ loan, onBack, children }) {
  const [members, setMembers] = useState(null);
  const [member, setMember] = useState('');
  useEffect(() => {
    api.emi.loan(loan.id).then((d) => {
      setMembers(d.borrowers);
      if (d.borrowers.length === 1) setMember(String(d.borrowers[0].member));
    }).catch(() => setMembers([]));
  }, [loan.id]);
  if (!members) return <Spinner label="Loading the loan…" />;
  return (
    <>
      <div style={{ marginBottom: 10 }}><button className="btn" onClick={onBack}>← Search another loan</button></div>
      {members.length > 1 && (
        <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
          <h3 className="section-title">Which member?</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Member</th><th className="num">Outstanding</th><th>Status</th><th className="actions-col">Actions</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.code} style={String(m.member) === member ? { background: 'var(--primary-soft, #eef7f4)' } : undefined}>
                    <td data-label="Member"><strong>{m.code}</strong> {m.name}</td>
                    <td data-label="Outstanding" className="num">{inr(m.outstanding)}</td>
                    <td data-label="Status">{m.settled ? <span className="badge grey">Settled ({m.settled.kind})</span> : m.closed ? <span className="badge green">Paid up</span> : <span className="badge grey">Running</span>}</td>
                    <td data-label="Actions" className="actions-col"><button className="btn sm" disabled={m.settled || m.closed} onClick={() => setMember(String(m.member))}>{String(m.member) === member ? 'Selected' : 'Select'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {member ? children(member) : members.length > 1 ? <div className="muted">Select the member.</div> : null}
    </>
  );
}

// Loads what the settlement forms show (loan, outstanding, verifier).
function usePreview(loanId, member) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.settlements.preview({ loan: loanId, member }).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [loanId, member]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, load };
}

function LoanSummary({ d }) {
  return (
    <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
      <DetailList items={[
        ['Loan ID', d.loan.loanId || d.loan.formId], ['Form ID', d.loan.formId], ['Branch', d.loan.branch], ['Borrower', `${d.borrower.code} — ${d.borrower.name}`],
        ...(d.loan.group ? [['Group', d.loan.group]] : []), ['Scheme', d.loan.schemeName], ['Loan amount', inr(d.loan.amount)], ['Installments', `${d.loan.installments} (${d.loan.modeLabel})`], ['Paid out on', dmy(d.loan.paidOn)],
        ['Installments paid', `${d.state.paidInstallments} of ${d.loan.installments} — ${inr(d.state.paid)}`], ['Due now', inr(d.state.due)], ['Outstanding', inr(d.state.outstanding)],
        ...(d.state.nextDue ? [['Next installment', `${d.state.nextDue.no} on ${dmy(d.state.nextDue.dueDate)} — ${inr(d.state.nextDue.amount)}`]] : []),
      ]} />
    </div>
  );
}

// ---- loan settlement ---------------------------------------------------------------------------------------------------
function LoanSettleForm({ loanId, member, canSettle, onDone }) {
  const toast = useToast();
  const { data: d, error, load } = usePreview(loanId, member);
  const [form, setForm] = useState({ settledOn: todayISO(), amount: '', payMode: 'cash', reference: '', remark: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (d) setForm((f) => ({ ...f, amount: String(d.state.outstanding) }));
  }, [d?.state.outstanding]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!d) return <Spinner label="Loading…" />;
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const amount = Number(form.amount) || 0;
  const waiver = Math.max(Math.round((d.state.outstanding - amount) * 100) / 100, 0);

  async function settle() {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.settlements.settleLoan({ loan: loanId, member, ...form });
      toast.success(`Loan settled — ${r.settlement.receiptNo}`);
      onDone(r.settlement);
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LoanSummary d={d} />
      {d.state.settled ? <div className="notice">This loan is already settled ({d.state.settled.receiptNo}).</div> : d.state.outstanding <= 0 ? <div className="notice">All installments are paid. There is nothing to settle.</div> : !canSettle ? (
        <div className="muted">You can view the loan but not settle it.</div>
      ) : (
        <div className="panel" style={{ padding: 16 }}>
          <h3 className="section-title">Settle the loan</h3>
          <div className="form-grid">
            <FormField id="sdate" label="Settlement date" required error={errors.settledOn}>
              <input id="sdate" type="date" max={todayISO()} value={form.settledOn} onChange={set('settledOn')} />
            </FormField>
            <FormField id="samount" label="Settlement amount received (₹)" required error={errors.amount} hint={`Outstanding ${inr(d.state.outstanding)}${d.canWaive ? '. A lower amount is a waiver.' : ''}`}>
              <input id="samount" inputMode="decimal" value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })); setErrors((x) => ({ ...x, amount: undefined })); }} />
            </FormField>
            <FormField id="smode" label="Paid by" required error={errors.payMode}>
              <select id="smode" value={form.payMode} onChange={set('payMode')}>
                {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            <FormField id="sref" label="Reference no." hint="Optional">
              <input id="sref" value={form.reference} maxLength={60} onChange={set('reference')} />
            </FormField>
            <FormField id="sremark" label={waiver > 0 ? 'Remark (reason for the waiver)' : 'Remark'} required={waiver > 0} error={errors.remark} className="span-2">
              <input id="sremark" value={form.remark} maxLength={300} onChange={set('remark')} />
            </FormField>
          </div>
          {waiver > 0 && <div className="notice warn" style={{ margin: '10px 0' }}>{inr(waiver)} will be waived.{d.canWaive ? '' : ' Only a branch manager or admin can settle for less than the outstanding.'}</div>}
          <button className="btn primary" disabled={busy} onClick={settle}>{busy ? 'Settling…' : `Settle loan — receive ${inr(amount)}`}</button>
        </div>
      )}
    </>
  );
}

// ---- death settlement --------------------------------------------------------------------------------------------------
function DeathSettleForm({ loanId, member, canSettle, onDone }) {
  const toast = useToast();
  const { data: d, error, load } = usePreview(loanId, member);
  const [form, setForm] = useState({ deathDate: '', settledOn: todayISO(), remark: '', claimRef: '', certificate: '', certificateName: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!d) return <Spinner label="Loading…" />;
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      let data;
      if (file.type === 'application/pdf') {
        if (file.size > MAX_DOC_BYTES) throw new Error('The PDF must be 800 KB or smaller');
        data = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(new Error('Could not read the file')); fr.readAsDataURL(file); });
      } else data = await compressImage(file, { maxSide: 1600, quality: 0.75 });
      setForm((f) => ({ ...f, certificate: data, certificateName: file.name }));
      setErrors((x) => ({ ...x, certificate: undefined }));
    } catch (ex) {
      setErrors((x) => ({ ...x, certificate: ex.message }));
    }
  }

  async function save() {
    const found = {};
    if (!form.deathDate) found.deathDate = 'Enter the date of death';
    if (!form.certificate) found.certificate = 'Upload the death certificate';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const r = await api.settlements.settleDeath({ loan: loanId, member, ...form });
      toast.success(`Death settlement saved — ${r.settlement.receiptNo}${r.memberBlocked ? '. The member is blocked.' : ''}`);
      onDone(r.settlement);
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LoanSummary d={d} />
      {d.state.settled ? <div className="notice">This loan is already settled ({d.state.settled.receiptNo}).</div> : d.state.outstanding <= 0 ? <div className="notice">All installments are paid. There is nothing to settle.</div> : !canSettle ? (
        <div className="muted">You can view the loan but not settle it.</div>
      ) : (
        <div className="panel" style={{ padding: 16 }}>
          <h3 className="section-title">Death settlement — {d.borrower.code} {d.borrower.name}</h3>
          <div className="form-grid">
            <FormField id="dbranch" label="Branch"><input id="dbranch" value={d.loan.branch} disabled /></FormField>
            <FormField id="ddeath" label="Date of death" required error={errors.deathDate}>
              <input id="ddeath" type="date" max={todayISO()} min={d.loan.paidOn} value={form.deathDate} onChange={set('deathDate')} />
            </FormField>
            <FormField id="dsettle" label="Settlement date" required error={errors.settledOn}>
              <input id="dsettle" type="date" max={todayISO()} min={form.deathDate || undefined} value={form.settledOn} onChange={set('settledOn')} />
            </FormField>
            <FormField id="dclaim" label="Insurance claim reference" hint="Optional" error={errors.claimRef}>
              <input id="dclaim" value={form.claimRef} maxLength={60} onChange={set('claimRef')} />
            </FormField>
            <FormField id="dver-code" label="Verifier employee code" hint="Taken from your login"><input id="dver-code" value={d.verifier.code} disabled /></FormField>
            <FormField id="dver-name" label="Verifier name" hint="Taken from your login"><input id="dver-name" value={d.verifier.name} disabled /></FormField>
            <FormField id="dcert" label="Death certificate" required error={errors.certificate} className="span-2" hint="PDF or image, up to 800 KB">
              <div className="stamp-upload">
                {form.certificate ? <div className="muted">{form.certificateName || 'Certificate attached'}</div> : <div className="stamp-empty">No file</div>}
                <div className="stamp-actions">
                  <input id="dcert" ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" onChange={pick} hidden />
                  <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>{form.certificate ? 'Change' : 'Upload'}</button>
                  {form.certificate && <button type="button" className="btn sm danger-outline" onClick={() => setForm((f) => ({ ...f, certificate: '', certificateName: '' }))}>Remove</button>}
                </div>
              </div>
            </FormField>
            <FormField id="dremark" label="Remark" error={errors.remark} className="span-2">
              <input id="dremark" value={form.remark} maxLength={300} onChange={set('remark')} />
            </FormField>
          </div>
          <div className="notice warn" style={{ margin: '10px 0' }}>
            The outstanding {inr(d.state.outstanding)} is settled against the loan insurance and no more EMI is due on this loan. After saving, <strong>{d.borrower.name} is blocked automatically</strong>.
          </div>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save death settlement'}</button>
        </div>
      )}
    </>
  );
}

// ---- history of settlements --------------------------------------------------------------------------------------------
function History({ kind, reloadKey }) {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('active');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null);
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
      setData(await api.settlements.list({ kind, page, limit: LIMIT, status, branch, from, to, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [kind, page, status, branch, from, to, q]);
  useEffect(() => {
    load();
  }, [load, reloadKey]);
  useEffect(() => setPage(1), [status, branch, from, to, q]);

  async function cancel() {
    if (reason.trim().length < 3) return setReasonError('Enter the reason');
    setBusy(true);
    try {
      const r = await api.settlements.cancel(cancelling.id, reason.trim());
      toast.success(r.memberStaysBlocked ? 'Settlement cancelled. The member stays blocked; unblock under Block / Unblock if needed.' : 'Settlement cancelled — the loan is open again');
      setCancelling(null);
      setReason('');
      load();
    } catch (err) {
      setReasonError(err.errors?.reason || err.message);
    } finally {
      setBusy(false);
    }
  }

  const death = kind === 'death';
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h3 className="section-title">{death ? 'Death settlements' : 'Loan settlements'}</h3>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <input type="search" className="toolbar-search" placeholder="Search receipt, Loan ID, borrower or group" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search settlements" />
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
            <option value="active">Settled</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
      </div>
      {loading && !data.items.length ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : data.items.length === 0 ? (
        <EmptyState title={death ? 'No death settlement' : 'No loan settlement'} description="Settlements appear here." />
      ) : (
        <>
          <div className={`table-wrap${loading ? ' dim' : ''}`}>
            <table className="data-table">
              <thead>
                <tr><th>Receipt</th><th>Date</th><th>Loan ID</th><th>Borrower</th><th>Branch</th>{death && <th>Died on</th>}<th className="num">Outstanding</th><th className="num">{death ? 'Insurance' : 'Waived'}</th>{!death && <th className="num">Received</th>}{death && <th>Verified by</th>}<th className="actions-col">Actions</th></tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Receipt"><strong>{s.receiptNo}</strong></td>
                    <td data-label="Date">{dmy(s.settledOn)}</td>
                    <td data-label="Loan ID">{s.loanId || s.formId}</td>
                    <td data-label="Borrower"><strong>{s.memberCode}</strong> {s.memberName}{s.group && <div className="muted small">{s.group}</div>}</td>
                    <td data-label="Branch">{s.branch?.name || '—'}</td>
                    {death && <td data-label="Died on">{dmy(s.deathDate)}</td>}
                    <td data-label="Outstanding" className="num">{inr(s.outstanding)}</td>
                    <td data-label="Waived" className="num">{inr(s.waiver)}</td>
                    {!death && <td data-label="Received" className="num">{inr(s.amount)}</td>}
                    {death && <td data-label="Verified by">{s.verifier?.code || '—'}</td>}
                    <td data-label="Actions" className="actions-col">
                      <div className="row-actions">
                        <button className="btn sm" onClick={() => setView(s)}>View</button>
                        {isAdmin && s.status === 'active' && <button className="btn sm danger-outline" onClick={() => { setCancelling(s); setReason(''); setReasonError(''); }}>Cancel</button>}
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
      {view && <SettlementDialog settlement={view} onClose={() => setView(null)} />}
      {cancelling && (
        <Modal open title={`Cancel ${cancelling.receiptNo}?`} onClose={() => setCancelling(null)} busy={busy}
          footer={<><button className="btn" onClick={() => setCancelling(null)} disabled={busy}>Keep</button><button className="btn danger-outline" onClick={cancel} disabled={busy}>Cancel settlement</button></>}>
          <p style={{ marginTop: 0 }}>The loan of this borrower is open again and EMI is due as before.{death ? ' The member stays blocked until you unblock them.' : ''}</p>
          <FormField id="screason" label="Reason" required error={reasonError}>
            <input id="screason" value={reason} maxLength={200} autoFocus onChange={(e) => { setReason(e.target.value); setReasonError(''); }} />
          </FormField>
        </Modal>
      )}
    </div>
  );
}

function SettlementPage({ kind }) {
  const { user } = useAuth();
  const canSettle = SETTLERS.includes(user?.role);
  const death = kind === 'death';
  const [loan, setLoan] = useState(null);
  const [done, setDone] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const Form = death ? DeathSettleForm : LoanSettleForm;

  return (
    <>
      <PageHeader
        title={death ? 'Death Settlement' : 'Loan Settlement'}
        description={death ? 'Search the Loan ID of the borrower who has died. Enter the date of death, upload the death certificate and save. The loan is settled and the member is blocked.' : 'Search the Loan ID to see the outstanding and settle the loan in one go.'}
      />
      {loan ? (
        <BorrowerStep key={loan.id} loan={loan} onBack={() => setLoan(null)}>
          {(member) => <Form key={`${loan.id}-${member}-${reloadKey}`} loanId={loan.id} member={member} canSettle={canSettle} onDone={(s) => { setDone(s); setReloadKey((k) => k + 1); }} />}
        </BorrowerStep>
      ) : <LoanFinder onPick={setLoan} />}
      <History kind={kind} reloadKey={reloadKey} />
      {done && <SettlementDialog settlement={done} onClose={() => setDone(null)} />}
    </>
  );
}

export const LoanSettlement = () => <SettlementPage kind="loan" />;
export const DeathSettlement = () => <SettlementPage kind="death" />;

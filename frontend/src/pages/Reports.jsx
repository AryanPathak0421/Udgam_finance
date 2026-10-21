import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const MODE_LABEL = { cash: 'Cash', bank: 'Bank', upi: 'UPI', cheque: 'Cheque' };
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN') : '—');
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
const LIMIT = 50;
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '—');

const STATUS_BADGE = { approved: 'green', rejected: 'danger', pending: 'grey', cancelled: 'grey' };

// the columns of every report: [label, row => cell, numeric?]
const COLS = {
  requisition: [
    ['Form ID', (r) => <strong>{r.formId}</strong>], ['Date', (r) => dmy(r.date)], ['Branch', (r) => r.branch], ['Type', (r) => cap(r.loanType)], ['Applicant', (r) => <>{r.applicant}{r.mobile && <div className="muted small">{r.mobile}</div>}</>],
    ['Scheme', (r) => r.scheme], ['Mode · term', (r) => `${cap(r.mode)} · ${r.term}`], ['Amount', (r) => inr(r.amount), true], ['Status', (r) => <span className={`badge ${STATUS_BADGE[r.status] || 'grey'}`}>{cap(r.status)}</span>], ['By', (r) => r.requestedBy],
  ],
  approval: [
    ['Form ID', (r) => <strong>{r.formId}</strong>], ['Decided on', (r) => dmy(r.date)], ['Branch', (r) => r.branch], ['Type', (r) => cap(r.loanType)], ['Applicant', (r) => <>{r.applicant}{r.mobile && <div className="muted small">{r.mobile}</div>}</>],
    ['Asked', (r) => inr(r.requested), true], ['Approved', (r) => inr(r.amount), true], ['Status', (r) => <><span className={`badge ${STATUS_BADGE[r.status] || 'grey'}`}>{cap(r.status)}</span>{r.reason && <div className="muted small">{r.reason}</div>}</>],
    ['By', (r) => r.decidedBy], ['Paid out', (r) => (r.paidOut ? dmy(r.paidOut) : '—')],
  ],
  disbursement: [
    ['Loan ID', (r) => <strong>{r.loanId}</strong>], ['Paid on', (r) => dmy(r.date)], ['Branch', (r) => r.branch], ['Type', (r) => cap(r.loanType)], ['Borrower(s)', (r) => r.borrowers], ['Scheme', (r) => r.scheme],
    ['Mode · term', (r) => `${r.mode} · ${r.installments}`], ['Loan amount', (r) => inr(r.amount), true], ['Cash paid', (r) => inr(r.cash), true], ['Paid by', (r) => MODE_LABEL[r.payMode] || r.payMode],
  ],
  'emi-collection': [
    ['Receipt', (r) => <strong>{r.receiptNo}</strong>], ['Date', (r) => dmy(r.date)], ['Loan ID', (r) => r.loanId], ['Borrower', (r) => <>{r.memberCode} {r.memberName}{r.group && <div className="muted small">{r.group}</div>}</>], ['Branch', (r) => r.branch],
    ['Type', (r) => cap(r.type)], ['Installments', (r) => r.installments], ['Amount', (r) => inr(r.amount), true], ['By', (r) => MODE_LABEL[r.payMode] || r.payMode], ['Collected by', (r) => r.collectedBy],
  ],
  'member-joining': [
    ['Member', (r) => <><strong>{r.memberCode}</strong> {r.memberName}</>], ['Mobile', (r) => r.mobile || '—'], ['Branch', (r) => r.branch], ['Joined on', (r) => dmy(r.date)], ['Gender', (r) => cap(r.gender)], ['District', (r) => r.district || '—'], ['Registered by', (r) => r.registeredBy || '—'],
    ['Source', (r) => (r.fromOldSystem ? 'Old system' : 'New')],
  ],
};
const borrowerCols = (extra) => [
  ['Loan ID', (r) => <strong>{r.loanId}</strong>], ['Borrower', (r) => <>{r.memberCode} {r.memberName}{r.mobile && <div className="muted small">{r.mobile}</div>}{r.group && <div className="muted small">{r.group}</div>}</>],
  ['Branch', (r) => r.branch], ['Scheme', (r) => <>{r.scheme}<div className="muted small">{cap(r.mode)} · {r.term} installments</div></>], ['EMI', (r) => inr(r.emi), true], ...extra,
];
COLS.due = borrowerCols([['Due today', (r) => inr(r.due), true], ['Outstanding', (r) => inr(r.outstanding), true]]);
COLS.overdue = borrowerCols([['Overdue amount', (r) => inr(r.due), true], ['Installments', (r) => r.dueCount, true], ['Oldest due', (r) => dmy(r.firstDue)], ['Days overdue', (r) => <span className="badge danger">{r.overdueDays}</span>], ['Outstanding', (r) => inr(r.outstanding), true]]);
COLS.outstanding = borrowerCols([['Loan amount', (r) => inr(r.loanAmount), true], ['Total payable', (r) => inr(r.scheduled), true], ['Paid', (r) => inr(r.paid), true], ['Outstanding', (r) => <strong>{inr(r.outstanding)}</strong>, true], ['Due now', (r) => inr(r.due), true]]);
COLS.npa = borrowerCols([['Loan amount', (r) => inr(r.loanAmount), true], ['Last installment', (r) => dmy(r.lastInstallment)], ['Days after term', (r) => <span className="badge danger">{r.daysPastEnd}</span>], ['Outstanding', (r) => <strong>{inr(r.outstanding)}</strong>, true]]);

const REPORTS = {
  requisition: { title: 'Loan Requisition Report', description: 'Every loan requisition with its status, by the loan date.', range: true, status: ['pending', 'approved', 'rejected', 'cancelled'], from: monthStart },
  approval: { title: 'Loan Approval Report', description: 'Loans that were approved or rejected, by the date of the decision.', range: true, status: ['approved', 'rejected'], from: monthStart },
  disbursement: { title: 'Loan Disbursement Report', description: 'Loans paid out, by the payment date.', range: true, from: monthStart },
  due: { title: 'Loan Due Report', description: 'Borrowers whose EMI falls due on the chosen date and is not paid yet.', asOf: true },
  overdue: { title: 'Loan Over Due Report', description: 'Borrowers with an EMI that was due before the chosen date and is still not paid, the oldest first.', asOf: true },
  outstanding: { title: 'Loan Outstanding Report', description: 'What every running borrower still has to pay as on the chosen date.', asOf: true },
  'emi-collection': { title: 'Loan EMI Collection Report', description: 'EMI received, by the date it was paid.', range: true, from: today },
  'member-joining': { title: 'Member Joining Report', description: 'Members who joined, by the joining date.', range: true, from: monthStart },
  npa: { title: 'NPA Report', description: 'Borrowers of a 120-day loan who still owe after the 121st day: the last installment is behind them and the loan is not paid.', asOf: true },
};

/** "Call done": the borrower of the row was called. Shows who called last and when. */
function CallButton({ report, row, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function press() {
    setBusy(true);
    try {
      const r = await api.reports.callDone({ report, key: row.key });
      onDone(row.key, r.call);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  const c = row.call;
  return (
    <div>
      <button className={`btn sm ${c ? '' : 'primary'}`} onClick={press} disabled={busy} title={c ? 'Call again' : 'Mark the call as done'}>{busy ? '…' : c ? 'Call done ✓' : 'Call done'}</button>
      {c && <div className="muted small">{dmy(c.at)} · {c.by || '—'}{c.count > 1 ? ` · ${c.count}×` : ''}</div>}
    </div>
  );
}

function BranchSelect({ value, onChange }) {
  const [branches, setBranches] = useState([]);
  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  if (branches.length < 2) return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Branch">
      <option value="">All branches</option>
      {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
    </select>
  );
}

const SUMMARY_LABEL = { borrowers: 'Borrowers', due: 'Due', outstanding: 'Outstanding', loanAmount: 'Loan amount', paid: 'Paid', receipts: 'Receipts', amount: 'Amount', loans: 'Loans', cash: 'Cash paid', requisitions: 'Requisitions', decided: 'Decided', approved: 'Approved', rejected: 'Rejected', members: 'Members' };
const COUNT_KEYS = ['borrowers', 'receipts', 'loans', 'requisitions', 'decided', 'approved', 'rejected', 'members'];

export function ReportPage({ name }) {
  const cfg = REPORTS[name];
  const cols = COLS[name];
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(cfg.from ? cfg.from() : '');
  const [to, setTo] = useState(today());
  const [date, setDate] = useState(today());
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 350);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.reports.get(name, { branch, q, ...(cfg.range ? { from, to, status: status || undefined } : { date }) }));
      setPage(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [name, branch, q, from, to, date, status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const done = (key, call) => setData((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, call } : r)) }));
  const rows = data?.rows || [];
  const view = rows.slice((page - 1) * LIMIT, page * LIMIT);

  return (
    <>
      <PageHeader title={cfg.title} description={cfg.description} />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          {cfg.range ? (
            <>
              <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
              <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
            </>
          ) : (
            <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>As on <input type="date" value={date} onChange={(e) => setDate(e.target.value || today())} aria-label="As on date" /></label>
          )}
          {cfg.status && (
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              {cfg.status.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
            </select>
          )}
          <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" style={{ minWidth: 180 }} />
          <button className="btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : !data || rows.length === 0 ? (
          <EmptyState title="Nothing to show" description="No record for these filters." />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '8px 0' }}>
              {Object.entries(data.summary).map(([k, v]) => <span key={k}>{SUMMARY_LABEL[k] || k} <strong>{COUNT_KEYS.includes(k) ? v : inr(v)}</strong></span>)}
            </div>
            {data.truncated && <div className="notice">Showing the first {rows.length} of {data.total}. Narrow the dates or the branch to see the rest.</div>}
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr>{cols.map(([l, , n]) => <th key={l} className={n ? 'num' : ''}>{l}</th>)}<th>Call</th></tr></thead>
                <tbody>
                  {view.map((r) => (
                    <tr key={r.key}>
                      {cols.map(([l, f, n]) => <td key={l} data-label={l} className={n ? 'num' : ''}>{f(r)}</td>)}
                      <td data-label="Call"><CallButton report={name} row={r} onDone={done} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={Math.max(1, Math.ceil(rows.length / LIMIT))} total={rows.length} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}

/** Loan account ledger: a Loan ID shows the loan, every borrower's installments and every receipt. */
export function LoanLedger() {
  const [loanId, setLoanId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(0);

  async function find(e) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      setData(await api.reports.get('loan-ledger', { loanId: loanId.trim() }));
      setOpen(0);
    } catch (err) {
      setData(null);
      setError(err.errors?.loanId || err.message);
    } finally {
      setBusy(false);
    }
  }
  const L = data?.loan;
  const b = data?.borrowers?.[open];
  const STATUS = { paid: 'green', due: 'danger', upcoming: 'grey', settled: 'grey' };
  return (
    <>
      <PageHeader title="Loan Account Ledger" description="Enter the Loan ID to see the loan, every installment with what was paid, and every receipt." />
      <div className="panel">
        <form className="toolbar" onSubmit={find} style={{ flexWrap: 'wrap' }}>
          <FormField id="lledger" label="Loan ID" error={error}><input id="lledger" value={loanId} onChange={(e) => setLoanId(e.target.value.toUpperCase())} placeholder="For example UDGRP647" style={{ minWidth: 220 }} /></FormField>
          <button className="btn primary" type="submit" disabled={busy || loanId.trim().length < 3}>{busy ? 'Searching…' : 'Show ledger'}</button>
        </form>
        {data && (
          <>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data-table">
                <tbody>
                  <tr><td>Loan ID</td><td><strong>{L.loanId}</strong> · {L.formId}</td><td>Branch</td><td>{L.branch}</td></tr>
                  <tr><td>Type</td><td>{cap(L.kind)}{L.group ? ` · ${L.group}` : ''}</td><td>Scheme</td><td>{L.schemeName} · {L.modeLabel} · {L.installments} installments · {L.rate}%</td></tr>
                  <tr><td>Paid out on</td><td>{dmy(L.paidOn)} (receipt {L.receiptNo})</td><td>Installments</td><td>{dmy(L.emiStartDate)} to {dmy(L.emiEndDate)}</td></tr>
                </tbody>
              </table>
            </div>
            {data.borrowers.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
                {data.borrowers.map((x, i) => <button key={x.code} className={`btn sm ${i === open ? 'primary' : ''}`} onClick={() => setOpen(i)}>{x.code} {x.name}</button>)}
              </div>
            )}
            {b && (
              <>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '10px 0' }}>
                  <span>Borrower <strong>{b.code} {b.name}</strong></span><span>EMI <strong>{inr(b.emi)}</strong></span><span>Paid <strong>{inr(b.paidAmount)}</strong> ({b.paidCount})</span>
                  <span>Due now <strong>{inr(b.dueAmount)}</strong></span><span>Outstanding <strong>{inr(b.outstanding)}</strong></span>
                  {b.settled && <span className="badge green">Settled ({b.settled.kind}, {b.settled.receiptNo})</span>}
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>No.</th><th>Due date</th><th className="num">EMI</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th>Paid on · receipt</th></tr></thead>
                    <tbody>
                      {b.schedule.map((s) => (
                        <tr key={s.no}>
                          <td data-label="No.">{s.no}</td><td data-label="Due date">{dmy(s.dueDate)}</td><td data-label="EMI" className="num">{inr(s.amount)}</td><td data-label="Paid" className="num">{inr(s.paid)}</td><td data-label="Balance" className="num">{inr(s.remaining)}</td>
                          <td data-label="Status"><span className={`badge ${STATUS[s.status] || 'grey'}`}>{s.partial ? 'Part paid' : cap(s.status)}</span>{s.overdueDays > 0 && <span className="muted small"> {s.overdueDays}d late</span>}</td>
                          <td data-label="Paid on">{s.paidOn ? `${dmy(s.paidOn)} · ${s.receiptNo}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <h3 className="section-title" style={{ marginTop: 16 }}>Receipts</h3>
            {data.receipts.length === 0 ? <div className="muted">No EMI has been received yet.</div> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Receipt</th><th>Date</th><th>Borrower</th><th>Installments</th><th className="num">Amount</th><th>By</th></tr></thead>
                  <tbody>
                    {data.receipts.map((r) => (
                      <tr key={r.receiptNo}>
                        <td data-label="Receipt"><strong>{r.receiptNo}</strong></td><td data-label="Date">{dmy(r.date)}</td><td data-label="Borrower">{r.memberCode} {r.memberName}</td><td data-label="Installments">{r.installments}</td>
                        <td data-label="Amount" className="num">{inr(r.amount)}</td><td data-label="By">{MODE_LABEL[r.payMode] || r.payMode} · {r.by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.settlements.length > 0 && <div className="muted small" style={{ marginTop: 8 }}>Settled: {data.settlements.map((s) => `${s.memberCode} (${s.kind}, ${s.receiptNo}, ${dmy(s.date)}${s.waiver ? `, waived ${inr(s.waiver)}` : ''})`).join('; ')}</div>}
          </>
        )}
      </div>
    </>
  );
}

export const RequisitionReport = () => <ReportPage name="requisition" />;
export const ApprovalReport = () => <ReportPage name="approval" />;
export const DisbursementReport = () => <ReportPage name="disbursement" />;
export const DueReport = () => <ReportPage name="due" />;
export const OverdueReport = () => <ReportPage name="overdue" />;
export const OutstandingReport = () => <ReportPage name="outstanding" />;
export const EmiCollectionReport = () => <ReportPage name="emi-collection" />;
export const MemberJoiningReport = () => <ReportPage name="member-joining" />;
export const NpaReport = () => <ReportPage name="npa" />;

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';

const MODE_LABEL = { cash: 'Cash', bank: 'Bank', upi: 'UPI', cheque: 'Cheque', security: 'Security' };
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const amt = (n) => (n ? inr(n) : '—');
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');
const today = () => {
  const d = new Date();
  const localStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  try {
    const istStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    return istStr > localStr ? istStr : localStr;
  } catch {
    return localStr;
  }
};
const monthStart = () => `${today().slice(0, 7)}-01`;

// the branch filter and a loader shared by the books
function useBook(fetcher, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await fetcher()); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, load };
}

function BranchSelect({ value, onChange }) {
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [branches, setBranches] = useState([]);
  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  if (!(branches.length > 1 || isAdmin)) return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Branch">
      <option value="">{isAdmin ? 'All branches and head office' : 'All my branches'}</option>
      {isAdmin && <option value="ho">Head office</option>}
      {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
    </select>
  );
}

const Dates = ({ from, setFrom, to, setTo }) => (
  <>
    <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
    <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
  </>
);
const Refresh = ({ b }) => <button className="btn" onClick={b.load} disabled={b.loading}>{b.loading ? 'Refreshing…' : 'Refresh'}</button>;
const Body = ({ b, children, empty }) => (b.loading && !b.data ? <Spinner label="Loading…" /> : b.error ? <ErrorState message={b.error} onRetry={b.load} /> : !b.data ? <EmptyState title="No data" /> : empty ? <EmptyState title={empty} /> : children);

export function TrialBalance() {
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const b = useBook(() => api.accounts.trialBalance({ branch, from, to }), [branch, from, to]);
  const d = b.data;
  return (
    <>
      <PageHeader title="Trial Balance" description="Every account with its opening balance, what was debited and credited in the period, and the closing balance. Receipts credit their account and debit cash or bank; payments do the opposite." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <Dates from={from} setFrom={setFrom} to={to} setTo={setTo} />
          <Refresh b={b} />
        </div>
        <Body b={b} empty={d && d.rows.length === 0 ? 'No accounts have any balance or entry for this period' : ''}>
          {d && (
            <div className="table-wrap">
              <table className="data-table grid-table">
                <thead>
                  <tr>
                    <th rowSpan={2} className="col-divider">Account</th>
                    <th colSpan={2} className="col-divider" style={{ textAlign: 'center' }}>Opening</th>
                    <th colSpan={2} className="col-divider" style={{ textAlign: 'center' }}>Period</th>
                    <th colSpan={2} style={{ textAlign: 'center' }}>Closing</th>
                  </tr>
                  <tr>
                    <th className="num">Debit</th>
                    <th className="num col-divider">Credit</th>
                    <th className="num">Debit</th>
                    <th className="num col-divider">Credit</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={`${r.group}|${r.name}`}>
                      <td data-label="Account" className="col-divider">
                        <strong>{r.name}</strong>
                        <div className="muted small">{r.group === 'Account' ? 'Cashbook line' : r.group}</div>
                      </td>
                      <td data-label="Opening debit" className="num">{amt(r.open.dr)}</td>
                      <td data-label="Opening credit" className="num col-divider">{amt(r.open.cr)}</td>
                      <td data-label="Debit" className="num">{amt(r.debit)}</td>
                      <td data-label="Credit" className="num col-divider">{amt(r.credit)}</td>
                      <td data-label="Closing debit" className="num">{amt(r.close.dr)}</td>
                      <td data-label="Closing credit" className="num">{amt(r.close.cr)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--text, #111)', background: 'var(--bg-subtle, #f9fafb)', fontWeight: 'bold' }}>
                    <td className="col-divider"><strong>Total</strong></td>
                    <td className="num"><strong>{inr(d.totals.openDr)}</strong></td>
                    <td className="num col-divider"><strong>{inr(d.totals.openCr)}</strong></td>
                    <td className="num"><strong>{inr(d.totals.debit)}</strong></td>
                    <td className="num col-divider"><strong>{inr(d.totals.credit)}</strong></td>
                    <td className="num"><strong>{inr(d.totals.closeDr)}</strong></td>
                    <td className="num"><strong>{inr(d.totals.closeCr)}</strong></td>
                  </tr>
                </tbody>
              </table>
              <div className="muted small" style={{ marginTop: 6 }}>
                Cash in hand and the bank accounts come from the Cashbook lines; ledgers carry the opening balance of the Ledger master. "Today due" is not a transaction and is left out.
                {d.rows.some((r) => r.group === 'Difference') && ' The difference row is there because the opening balances of the Ledger master and the bank accounts do not balance by themselves.'}
              </div>
            </div>
          )}
        </Body>
      </div>
    </>
  );
}

export function BankBook() {
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [account, setAccount] = useState('');
  const b = useBook(() => api.accounts.bankBook({ branch, from, to, bankAccount: account }), [branch, from, to, account]);
  const d = b.data;
  return (
    <>
      <PageHeader title="Bank Book" description="Every bank transaction: EMI, payments and entries made by bank, UPI or cheque, and the bank deposits and withdrawals, with the running balance." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Bank account">
            <option value="">All bank accounts</option>
            {(d?.accounts || []).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <Dates from={from} setFrom={setFrom} to={to} setTo={setTo} />
          <Refresh b={b} />
        </div>
        <Body b={b}>
          {d && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Particulars</th><th>Bank account</th><th>By</th><th className="num">Deposit</th><th className="num">Withdrawal</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  <tr><td colSpan={6}><strong>Opening balance</strong></td><td className="num"><strong>{inr(d.opening)}</strong></td></tr>
                  {d.lines.length === 0 && <tr><td colSpan={7} className="muted">No bank transaction in this period.</td></tr>}
                  {d.lines.map((l, i) => (
                    <tr key={i}>
                      <td data-label="Date">{dmy(l.date)}</td>
                      <td data-label="Particulars">{l.particulars || '—'}<div className="muted small">{l.branch}{l.ref ? ` · ${l.ref}` : ''}</div></td>
                      <td data-label="Bank account">{l.account}</td>
                      <td data-label="By">{MODE_LABEL[l.mode] || l.mode || 'Bank'}</td>
                      <td data-label="Deposit" className="num">{amt(l.deposit)}</td>
                      <td data-label="Withdrawal" className="num">{amt(l.withdrawal)}</td>
                      <td data-label="Balance" className="num">{inr(l.balance)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid currentColor' }}>
                    <td colSpan={4}><strong>Total / closing balance</strong></td>
                    <td className="num"><strong>{inr(d.totals.deposits)}</strong></td><td className="num"><strong>{inr(d.totals.withdrawals)}</strong></td><td className="num"><strong>{inr(d.closing)}</strong></td>
                  </tr>
                </tbody>
              </table>
              <div className="muted small" style={{ marginTop: 6 }}>The opening balance includes the opening amount of the bank accounts (Bank Account Master). Older records made before the bank account was asked for show "Not specified".</div>
            </div>
          )}
        </Body>
      </div>
    </>
  );
}

export function DayBook() {
  const [branch, setBranch] = useState('');
  const [date, setDate] = useState(today());
  const b = useBook(() => api.accounts.dayBook({ branch, date }), [branch, date]);
  const d = b.data;
  const rows = (side) => (d ? d.lines.filter((l) => l.side === side) : []);
  const Side = ({ title, side, total, tone }) => (
    <div className="panel" style={{ padding: 14, flex: '1 1 420px', minWidth: 0 }}>
      <h3 className="section-title">{title}</h3>
      <div className="table-wrap">
        <table className="data-table">
          <tbody>
            {rows(side).length === 0 && <tr><td className="muted">Nothing.</td></tr>}
            {rows(side).map((l, i) => (
              <tr key={i}>
                <td data-label="Particulars">{l.head}<div className="muted small">{l.particulars !== l.head ? `${l.particulars} · ` : ''}{l.branch}{l.ref ? ` · ${l.ref}` : ''}{l.mode ? ` · ${MODE_LABEL[l.mode] || l.mode}` : ''}{l.account ? ` · ${l.account}` : ''}</div></td>
                <td data-label="Amount" className="num">{inr(side === 'receive' ? l.receive : l.payment)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid currentColor' }}><td><strong>Total</strong></td><td className="num"><span className={`badge ${tone}`}><strong>{inr(total)}</strong></span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <>
      <PageHeader title="Day Book" description="Everything received and paid on one day, with the opening and closing balance of that day." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Date <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} aria-label="Date" /></label>
          <Refresh b={b} />
        </div>
        <Body b={b}>
          {d && (
            <>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '4px 0 8px' }}>
                <span>Opening balance <strong>{inr(d.opening)}</strong></span>
                <span>Closing balance <strong>{inr(d.closing)}</strong></span>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Side title="Received" side="receive" total={d.totals.receipts} tone="green" />
                <Side title="Paid" side="payment" total={d.totals.payments} tone="danger" />
              </div>
            </>
          )}
        </Body>
      </div>
    </>
  );
}

export function ProductBranchDue() {
  const b = useBook(() => api.accounts.productBranchDue(), []);
  const d = b.data;
  const [search, setSearch] = useState('');
  const [showZero, setShowZero] = useState(false);
  // a branch with nothing due is left out (tick the box to see it); the search looks at the branch code and name
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (d?.rows || []).filter((r) => (showZero || r.balance > 0) && (!q || `${r.branch?.code || ''} ${r.branch?.name || ''}`.toLowerCase().includes(q)));
  }, [d, search, showZero]);
  const total = useMemo(() => {
    const t = { purchased: 0, transferredIn: 0, transferredOut: 0, paid: 0, waiting: 0, balance: 0 };
    rows.forEach((r) => Object.keys(t).forEach((k) => { t[k] += r[k] || 0; }));
    return t;
  }, [rows]);
  const hidden = (d?.rows || []).filter((r) => r.balance <= 0).length;
  return (
    <>
      <PageHeader title="Product Branch Due Balance" description="What each branch still owes head office for the products it bought: purchases and transfers less the payments received. Branches with nothing due are not listed." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <input type="search" placeholder="Search branch" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search branch" style={{ minWidth: 200 }} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} /> Show branches with nothing due{hidden ? ` (${hidden})` : ''}</label>
          <Refresh b={b} />
        </div>
        <Body b={b} empty={d && d.rows.length === 0 ? 'No branch has bought products yet' : ''}>
          {d && (rows.length === 0 ? <EmptyState title="Nothing to show" description={search ? 'No branch matches the search.' : 'No branch has anything due. Tick "Show branches with nothing due" to see all.'} /> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Branch</th><th className="num">Purchased</th><th className="num">Transferred in</th><th className="num">Transferred out</th><th className="num">Net</th><th className="num">Paid (received)</th><th className="num">Paid, waiting</th><th className="num">Due balance</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.branchId}>
                      <td data-label="Branch">{r.branch ? `${r.branch.code} — ${r.branch.name}` : '—'}</td>
                      <td data-label="Purchased" className="num">{inr(r.purchased)}</td><td data-label="Transferred in" className="num">{inr(r.transferredIn)}</td><td data-label="Transferred out" className="num">{inr(r.transferredOut)}</td>
                      <td data-label="Net" className="num">{inr(r.net)}</td><td data-label="Paid" className="num">{inr(r.paid)}</td><td data-label="Waiting" className="num">{inr(r.waiting)}</td>
                      <td data-label="Due balance" className="num"><strong>{inr(r.balance)}</strong></td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid currentColor' }}>
                    <td><strong>Total</strong></td>
                    <td className="num"><strong>{inr(total.purchased)}</strong></td><td className="num"><strong>{inr(total.transferredIn)}</strong></td><td className="num"><strong>{inr(total.transferredOut)}</strong></td>
                    <td className="num"><strong>{inr(total.purchased + total.transferredIn - total.transferredOut)}</strong></td><td className="num"><strong>{inr(total.paid)}</strong></td><td className="num"><strong>{inr(total.waiting)}</strong></td><td className="num"><strong>{inr(total.balance)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </Body>
      </div>
    </>
  );
}

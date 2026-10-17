import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';

const MODE_LABEL = { cash: 'Cash', bank: 'Bank', upi: 'UPI', cheque: 'Cheque', security: 'Security' };
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
const today = () => new Date().toISOString().slice(0, 10);

function Side({ title, rows, total, tone }) {
  return (
    <div className="panel" style={{ padding: 14, flex: '1 1 420px', minWidth: 0 }}>
      <h3 className="section-title">{title}</h3>
      {rows.length === 0 ? <span className="muted">Nothing in this period</span> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Particulars</th><th>Mode</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td data-label="Date">{dmy(r.date)}</td>
                  <td data-label="Particulars">{r.particulars}<div className="muted small">{r.branch}{r.ref ? ` · ${r.ref}` : ''}</div></td>
                  <td data-label="Mode">{MODE_LABEL[r.mode] || r.mode || '—'}</td>
                  <td data-label="Amount" className="num">{inr(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 8, textAlign: 'right' }}><span className={`badge ${tone}`}>Total {inr(total)}</span></div>
    </div>
  );
}

// Cashbook: receipts on one side, payments on the other, with the opening and closing balance.
export default function Cashbook() {
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [mode, setMode] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  return (
    <>
      <PageHeader title="Cashbook" description="Money received on the receipts side and money paid on the payments side. A product payment a branch makes shows on its payments side." />
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
        </div>
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : !data ? <EmptyState title="No data" /> : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '6px 0 12px' }}>
              <span className="badge grey">Opening balance {inr(data.opening)}</span>
              <span className="badge green">Receipts {inr(data.totals.receipts)}</span>
              <span className="badge danger">Payments {inr(data.totals.payments)}</span>
              <span className="badge grey"><strong>Closing balance {inr(data.closing)}</strong></span>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Side title="Receipts" rows={data.receipts} total={data.totals.receipts} tone="green" />
              <Side title="Payments" rows={data.payments} total={data.totals.payments} tone="danger" />
            </div>
          </>
        )}
      </div>
    </>
  );
}

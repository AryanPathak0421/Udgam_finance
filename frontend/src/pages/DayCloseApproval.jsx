import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { StatusBadge } from './DayClose.jsx';

const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');

/** Denomination & Cashbook Approval: the Cashbook and the denomination of every branch and day side by side; the admin approves or sends back. */
export default function DayCloseApproval() {
  const toast = useToast();
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('submitted');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.dayClose.list({ branch, status, from, to }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [branch, status, from, to]);
  useEffect(() => { load(); }, [load]);

  const shownItems = (data?.items || []).filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    const branchCode = (c.branch?.code || '').toLowerCase();
    const branchName = (c.branch?.name || '').toLowerCase();
    const submittedBy = (c.submittedBy || '').toLowerCase();
    const dateStr = (c.date || '').toLowerCase();
    const dmyStr = dmy(c.date).toLowerCase();
    const statusStr = (c.status || '').toLowerCase();
    return (
      branchCode.includes(q) ||
      branchName.includes(q) ||
      submittedBy.includes(q) ||
      dateStr.includes(q) ||
      dmyStr.includes(q) ||
      statusStr.includes(q)
    );
  });

  async function approve(c) {
    setBusy(c.id);
    try {
      const r = await api.dayClose.approve(c.id);
      toast.success(`${c.branch.code} ${dmy(c.date)} approved. The branch moves to ${dmy(r.nextDate)}.`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  }
  async function reject() {
    setBusy(rejecting.id);
    setReasonError('');
    try {
      await api.dayClose.reject(rejecting.id, reason);
      toast.success('Sent back to the branch');
      setRejecting(null);
      setReason('');
      load();
    } catch (err) {
      setReasonError(err.errors?.reason || err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader title="Denomination & Cashbook Approval" description="The Cashbook closing and the denomination of every branch and day, side by side. Approve to let the branch move to the next date; it can only be approved when the two match." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <input
            type="search"
            className="toolbar-search"
            placeholder="Search branch, employee, date…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search day closes"
            style={{ minWidth: 230 }}
          />
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="submitted">Waiting for approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
          <button className="btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : !data || data.items.length === 0 ? (
          <EmptyState title="Nothing here" description="No day close for these filters." />
        ) : shownItems.length === 0 ? (
          <EmptyState title="No matching records" description={`Nothing matches “${search}”.`} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Branch</th><th>Day</th><th className="num">Cashbook closing</th><th className="num">Denomination</th><th className="num">Difference</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shownItems.map((c) => (
                  <Fragment key={c.id}>
                    <tr>
                      <td data-label="Branch">{c.branch ? `${c.branch.code} — ${c.branch.name}` : '—'}<div className="muted small">{c.submittedBy ? `by ${c.submittedBy}` : ''}</div></td>
                      <td data-label="Day"><button type="button" className="link-btn" onClick={() => setOpen(open === c.id ? '' : c.id)}>{open === c.id ? '▾' : '▸'} {dmy(c.date)}</button></td>
                      <td data-label="Cashbook closing" className="num">{inr(c.cashbook.closing)}</td>
                      <td data-label="Denomination" className="num">{inr(c.denomination)}</td>
                      <td data-label="Difference" className="num"><span className={`badge ${c.match ? 'green' : 'danger'}`}>{c.match ? 'Matches' : inr(c.difference)}</span></td>
                      <td data-label="Status"><StatusBadge s={c.status} />{c.status === 'rejected' && c.rejectReason && <div className="muted small">{c.rejectReason}</div>}</td>
                      <td>
                        {c.status === 'submitted' && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn sm primary" disabled={!c.match || busy === c.id} title={c.match ? '' : 'The denomination does not match the cashbook closing'} onClick={() => approve(c)}>Approve</button>
                            <button className="btn sm danger-outline" disabled={busy === c.id} onClick={() => { setRejecting(c); setReason(''); setReasonError(''); }}>Send back</button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {open === c.id && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--surface-2, #f6f8f8)' }}>
                          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                            <table className="data-table" style={{ margin: 0, maxWidth: 360 }}>
                              <thead><tr><th>Cashbook (cash)</th><th className="num">Amount</th></tr></thead>
                              <tbody>
                                <tr><td>Opening</td><td className="num">{inr(c.cashbook.opening)}</td></tr>
                                <tr><td>Received</td><td className="num">{inr(c.cashbook.receipts)}</td></tr>
                                <tr><td>Paid</td><td className="num">{inr(c.cashbook.payments)}</td></tr>
                                <tr><td><strong>Closing</strong></td><td className="num"><strong>{inr(c.cashbook.closing)}</strong></td></tr>
                              </tbody>
                            </table>
                            <table className="data-table" style={{ margin: 0, maxWidth: 420 }}>
                              <thead><tr><th>Denomination</th><th className="num">Count</th><th className="num">Amount</th></tr></thead>
                              <tbody>
                                {data.denominations.filter((d) => c.counts[d.key]).map((d) => (
                                  <tr key={d.key}><td>{d.label}</td><td className="num">{c.counts[d.key]}</td><td className="num">{inr(c.counts[d.key] * d.value)}</td></tr>
                                ))}
                                <tr><td colSpan={2}><strong>Total</strong></td><td className="num"><strong>{inr(c.denomination)}</strong></td></tr>
                              </tbody>
                            </table>
                          </div>
                          {c.remark && <div className="muted small" style={{ marginTop: 6 }}>Remark: {c.remark}</div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={Boolean(rejecting)} title="Send the day back to the branch" onClose={() => setRejecting(null)} busy={Boolean(busy)}
        footer={<><button className="btn" onClick={() => setRejecting(null)}>Cancel</button><button className="btn danger" onClick={reject} disabled={Boolean(busy)}>Send back</button></>}>
        <p className="muted">{rejecting ? `${rejecting.branch?.code} · ${dmy(rejecting.date)}: the day opens again and the branch makes the denomination again.` : ''}</p>
        <FormField id="dcreason" label="Reason" required error={reasonError}><input id="dcreason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></FormField>
      </Modal>
    </>
  );
}

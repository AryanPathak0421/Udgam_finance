import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';

const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');
const STATUS = { submitted: ['Waiting for admin', 'amber'], approved: ['Approved', 'green'], rejected: ['Cancelled', 'danger'], revoked: ['Revoked', 'danger'] };
export const StatusBadge = ({ s }) => <span className={`badge ${STATUS[s]?.[1] || 'grey'}`}>{STATUS[s]?.[0] || s}</span>;

/** Denomination: the branch counts its notes and coins against the cash closing of its Cashbook. Making it closes the day. */
export default function DayClose() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState({});
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.groups.branchOptions().then((r) => {
      setBranches(r.items);
      if (r.items.length === 1) setBranch(r.items[0].id);
    }).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    if (!branch) { setLoading(false); setData(null); return; }
    setLoading(true);
    setError('');
    try {
      setData(await api.dayClose.status({ branch, date: date || undefined }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [branch, date]);
  useEffect(() => { load(); }, [load]);

  const dens = data?.denominations || [];
  const total = useMemo(() => dens.reduce((s, d) => s + (Number(counts[d.key]) || 0) * d.value, 0), [dens, counts]);
  const closing = data?.cashbook.closing ?? 0;
  const diff = Math.round((total - closing) * 100) / 100;

  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      await api.dayClose.submit({ branch, date: data.date, counts, remark });
      toast.success(diff === 0 ? 'Day closed. It waits for the admin\'s approval.' : 'Day closed, but the denomination does not match the cashbook closing: the admin cannot approve it until it does.');
      setCounts({});
      setRemark('');
      load();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Denomination" description="Count the notes and coins in hand against the cash closing of the Cashbook. Once the denomination is made the day of the branch is closed; the branch moves to the next date only after the admin approves it." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          {(branches.length > 1 || isAdmin) && (
            <select value={branch} onChange={(e) => { setBranch(e.target.value); setDate(''); }} aria-label="Branch">
              <option value="">Select the branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          )}
          <button className="btn" onClick={load} disabled={loading || !branch}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        {!branch ? <EmptyState title="Select the branch" description="Choose the branch whose day you are closing." /> : loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : data && (
          <>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '8px 0' }}>
              <span>Branch <strong>{data.branch.code} — {data.branch.name}</strong></span>
              <span>Day to close <strong>{dmy(data.date)}</strong></span>
              <span>Last approved day <strong>{data.lastClosed ? dmy(data.lastClosed) : 'none yet'}</strong></span>
            </div>
            {!data.dateFixed && (
              <FormField id="dcdate" label="Date to close" hint="Only for the very first close. After that the branch goes date by date.">
                <input id="dcdate" type="date" value={date || data.date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
              </FormField>
            )}
            {data.reason && <div className="notice" style={{ margin: '8px 0' }}>{data.reason}</div>}
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead><tr><th>Cashbook (cash) of {dmy(data.date)}</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  <tr><td>Opening balance</td><td className="num">{inr(data.cashbook.opening)}</td></tr>
                  <tr><td>Cash received</td><td className="num">{inr(data.cashbook.receipts)}</td></tr>
                  <tr><td>Cash paid</td><td className="num">{inr(data.cashbook.payments)}</td></tr>
                  <tr style={{ borderTop: '2px solid currentColor' }}><td><strong>Closing balance (cash in hand)</strong></td><td className="num"><strong>{inr(data.cashbook.closing)}</strong></td></tr>
                </tbody>
              </table>
            </div>
            {data.canClose ? (
              <>
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="data-table">
                    <thead><tr><th>Note / coin</th><th>Count</th><th className="num">Amount</th></tr></thead>
                    <tbody>
                      {dens.map((d) => (
                        <tr key={d.key}>
                          <td data-label="Note / coin">{d.label}</td>
                          <td data-label="Count">
                            <input aria-label={`${d.label} count`} inputMode="numeric" style={{ width: 100 }} value={counts[d.key] ?? ''} onChange={(e) => { setCounts((c) => ({ ...c, [d.key]: e.target.value.replace(/\D/g, '').slice(0, 7) })); setErrors((x) => ({ ...x, [d.key]: undefined })); }} />
                            {errors[d.key] && <div className="field-error small">{errors[d.key]}</div>}
                          </td>
                          <td data-label="Amount" className="num">{inr((Number(counts[d.key]) || 0) * d.value)}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid currentColor' }}><td colSpan={2}><strong>Denomination total</strong></td><td className="num"><strong>{inr(total)}</strong></td></tr>
                      <tr><td colSpan={2}>Cashbook closing</td><td className="num">{inr(closing)}</td></tr>
                      <tr><td colSpan={2}><strong>Difference</strong></td><td className="num"><span className={`badge ${diff === 0 ? 'green' : 'danger'}`}><strong>{diff === 0 ? 'Matches' : inr(diff)}</strong></span></td></tr>
                    </tbody>
                  </table>
                </div>
                {errors.counts && <div className="field-error">{errors.counts}</div>}
                <FormField id="dcremark" label="Remark" hint="Optional"><input id="dcremark" value={remark} maxLength={200} onChange={(e) => setRemark(e.target.value)} /></FormField>
                <button className="btn primary" onClick={submit} disabled={busy || total <= 0}>{busy ? 'Saving…' : 'Make the denomination and close the day'}</button>
                {diff !== 0 && total > 0 && <div className="muted small" style={{ marginTop: 6 }}>The denomination does not match the closing. It can be saved, but the admin cannot approve it and the branch stays on {dmy(data.date)} until it matches.</div>}
              </>
            ) : data.waiting && (
              <div className="notice" style={{ marginTop: 12 }}>
                Denomination of {dmy(data.waiting.date)}: {inr(data.waiting.denomination)} against the closing {inr(data.waiting.cashbook.closing)} ({data.waiting.match ? 'matches' : `difference ${inr(data.waiting.difference)}`}). It waits for the admin.
              </div>
            )}
            {data.recent.length > 0 && (
              <>
                <h3 className="section-title" style={{ marginTop: 16 }}>Recent days</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Date</th><th className="num">Cashbook closing</th><th className="num">Denomination</th><th className="num">Difference</th><th>Status</th></tr></thead>
                    <tbody>
                      {data.recent.map((c) => (
                        <tr key={c.id}>
                          <td data-label="Date">{dmy(c.date)}</td><td data-label="Closing" className="num">{inr(c.cashbook.closing)}</td><td data-label="Denomination" className="num">{inr(c.denomination)}</td>
                          <td data-label="Difference" className="num">{c.match ? '—' : inr(c.difference)}</td>
                          <td data-label="Status"><StatusBadge s={c.status} />{c.status === 'rejected' && c.rejectReason && <div className="muted small">{c.rejectReason}</div>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

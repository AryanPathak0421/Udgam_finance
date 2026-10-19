import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import FormField from '../components/ui/FormField.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const fmtTime = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const TYPE_LABEL = { group: 'Group', loan: 'Loan', member: 'Member' };
// what can be transferred: the groups of an employee, or all his running loans, or only one kind of loan
const KINDS = [
  { value: 'group', label: 'Group', type: 'group' },
  { value: 'loan', label: 'Loan (all kinds)', type: 'loan' },
  { value: 'loan:personal', label: 'Personal loan', type: 'loan', loanType: 'personal' },
  { value: 'loan:business', label: 'Business loan', type: 'loan', loanType: 'business' },
  { value: 'loan:msme', label: 'MSME loan', type: 'loan', loanType: 'msme' },
  { value: 'loan:product', label: 'Product loan', type: 'loan', loanType: 'product' },
  { value: 'loan:group', label: 'Group loan', type: 'loan', loanType: 'group' },
];

export function TransferHistory({ type, refreshKey }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.groupTransfer.history({ type }).then((r) => setRows(r.items)).catch(() => setRows([]));
  }, [type, refreshKey]);
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3 className="section-title" style={{ margin: '0 0 8px' }}>Earlier transfers</h3>
      {rows === null ? <Spinner label="Loading…" /> : !rows.length ? <div className="muted">Nothing has been transferred yet.</div> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>When</th><th>Type</th><th>From</th><th>To</th><th className="num">Moved</th><th>What</th><th>By</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td data-label="When">{fmtTime(t.at)}</td>
                  <td data-label="Type">{TYPE_LABEL[t.type]}</td>
                  <td data-label="From">{t.from}</td>
                  <td data-label="To">{t.to}</td>
                  <td data-label="Moved" className="num">{t.count}{t.type === 'group' && t.loansMoved > 0 ? ` (+${t.loansMoved} loans)` : ''}</td>
                  <td data-label="What" className="small">{t.items.slice(0, 4).join(', ')}{t.count > 4 ? ` … +${t.count - 4}` : ''}</td>
                  <td data-label="By">{t.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Group Master → Group Transfer: choose Group or Loan, the employee they are with now, tick them, choose the employee who takes over, transfer.
export default function GroupTransfer() {
  const toast = useToast();
  const [employees, setEmployees] = useState([]);
  const [kindKey, setKindKey] = useState('group');
  const kindInfo = KINDS.find((k) => k.value === kindKey) || KINDS[0];
  const type = kindInfo.type;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [withLoans, setWithLoans] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const q = useDebounce(search);

  useEffect(() => {
    api.groupTransfer.employees().then((r) => setEmployees(r.items)).catch((err) => setError(err.message));
  }, []);

  const load = useCallback(async () => {
    if (!from) { setData(null); return; }
    setLoading(true);
    setError('');
    try {
      setData(await api.groupTransfer.items({ type, employee: from, q, loanType: kindInfo.loanType, all: showClosed && type === 'loan' ? '1' : undefined }));
      setPicked(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [type, kindInfo.loanType, from, q, showClosed]);
  useEffect(() => {
    load();
  }, [load]);

  const items = data?.items || [];
  const allPicked = items.length > 0 && picked.size === items.length;
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const target = employees.find((e) => e.code === to);
  const runningLoansPicked = useMemo(() => (type === 'group' ? items.filter((g) => picked.has(g.id)).reduce((s, g) => s + g.runningLoans, 0) : 0), [type, items, picked]);

  async function submit() {
    setBusy(true);
    setFormError('');
    try {
      const r = await api.groupTransfer.transfer({ type, from, to, ids: [...picked], withLoans });
      toast.success(`${r.moved} ${type === 'group' ? `group${r.moved === 1 ? '' : 's'}` : `loan${r.moved === 1 ? '' : 's'}`} transferred to ${r.to}${type === 'group' && r.loansMoved ? ` (with ${r.loansMoved} running loan${r.loansMoved === 1 ? '' : 's'})` : ''}`);
      setConfirm(false);
      setRefreshKey((k) => k + 1);
      load();
    } catch (err) {
      setConfirm(false);
      setFormError(err.errors?.to || err.errors?.ids || err.message);
    } finally {
      setBusy(false);
    }
  }

  function start() {
    setFormError('');
    if (!picked.size) return setFormError(`Select the ${type === 'group' ? 'groups' : 'loans'} to transfer`);
    if (!to) return setFormError('Select the employee who takes over');
    setConfirm(true);
  }

  return (
    <>
      <PageHeader title="Group Transfer" description="Hand the groups or the loans of one employee to another. Choose the type and the employee they are with now, tick what to move, choose the employee who takes over and transfer in one go." />
      <div className="panel">
        <div className="form-grid">
          <FormField id="ttype" label="Transfer type" required>
            <select id="ttype" value={kindKey} onChange={(e) => { setKindKey(e.target.value); setPicked(new Set()); setFormError(''); }}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </FormField>
          <FormField id="tfrom" label="From employee" required>
            <select id="tfrom" value={from} onChange={(e) => { setFrom(e.target.value); setTo((t) => (t === e.target.value ? '' : t)); setFormError(''); }}>
              <option value="">Select employee</option>
              {employees.map((e) => <option key={e.code} value={e.code}>{e.code} — {e.name}{e.isActive ? '' : ' (not active)'}</option>)}
            </select>
          </FormField>
        </div>

        {from && (
          <>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <input type="search" className="toolbar-search" placeholder={type === 'group' ? 'Search group code or name' : 'Search Loan ID, form ID, group or borrower'} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
              {type === 'loan' && <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Also show closed loans</label>}
              {data && <span className="muted small">{data.total} {type === 'group' ? 'group' : `${kindInfo.label.replace(' (all kinds)', '').toLowerCase()}`}{data.total === 1 ? '' : 's'}{type === 'loan' && !showClosed ? ' running' : ''}{data.capped ? ' (first 1,000)' : ''}</span>}
            </div>

            {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : !items.length ? (
              <EmptyState title={type === 'group' ? 'No group with this employee' : 'No running loan with this employee'} description={type === 'loan' ? 'Tick "Also show closed loans" to see the finished ones too.' : undefined} />
            ) : type === 'group' ? (
              <div className={`table-wrap${loading ? ' dim' : ''}`}>
                <table className="data-table">
                  <thead><tr><th style={{ width: 40 }}><input type="checkbox" aria-label="Select all" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} /></th><th>Group</th><th>Branch</th><th className="num">Members</th><th className="num">Running loans</th><th>Status</th></tr></thead>
                  <tbody>
                    {items.map((g) => (
                      <tr key={g.id}>
                        <td><input type="checkbox" aria-label={`Select ${g.code}`} checked={picked.has(g.id)} onChange={() => toggle(g.id)} /></td>
                        <td data-label="Group"><strong>{g.code}</strong> {g.name}</td>
                        <td data-label="Branch">{g.branch?.name || '—'}</td>
                        <td data-label="Members" className="num">{g.members}</td>
                        <td data-label="Running loans" className="num">{g.runningLoans}</td>
                        <td data-label="Status"><span className={`badge ${g.isActive ? 'green' : 'grey'}`}>{g.isActive ? 'Active' : 'Inactive'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={`table-wrap${loading ? ' dim' : ''}`}>
                <table className="data-table">
                  <thead><tr><th style={{ width: 40 }}><input type="checkbox" aria-label="Select all" checked={allPicked} onChange={(e) => setPicked(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} /></th><th>Loan ID</th><th>Type</th><th>Group / borrower</th><th>Branch</th><th>Paid out</th><th className="num">Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {items.map((l) => (
                      <tr key={l.id}>
                        <td><input type="checkbox" aria-label={`Select ${l.loanId || l.formId}`} checked={picked.has(l.id)} onChange={() => toggle(l.id)} /></td>
                        <td data-label="Loan ID"><strong>{l.loanId || l.formId}</strong>{l.loanId && l.formId && l.formId !== l.loanId && <div className="muted small">Form {l.formId}</div>}</td>
                        <td data-label="Type">{l.type}</td>
                        <td data-label="Group / borrower">{l.group ? <div>{l.group}</div> : null}<div className="muted small">{l.borrowers}</div></td>
                        <td data-label="Branch">{l.branch}</td>
                        <td data-label="Paid out">{fmtDate(l.paidOn)}</td>
                        <td data-label="Amount" className="num">{inr(l.amount)}</td>
                        <td data-label="Status"><span className={`badge ${l.running ? 'green' : 'grey'}`}>{l.running ? 'Running' : 'Closed'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {items.length > 0 && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
                <FormField id="tto" label="Transfer to employee" required>
                  <select id="tto" value={to} onChange={(e) => { setTo(e.target.value); setFormError(''); }}>
                    <option value="">Select employee</option>
                    {employees.filter((e) => e.isActive && e.code !== from).map((e) => <option key={e.code} value={e.code}>{e.code} — {e.name}</option>)}
                  </select>
                </FormField>
                {type === 'group' && <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 10 }}><input type="checkbox" checked={withLoans} onChange={(e) => setWithLoans(e.target.checked)} /> Also move the running loans of these groups</label>}
                <button className="btn primary" onClick={start} disabled={busy}>Transfer{picked.size ? ` ${picked.size} ${type === 'group' ? 'group' : 'loan'}${picked.size === 1 ? '' : 's'}` : ''}</button>
              </div>
            )}
            {formError && <div className="field-error" role="alert" style={{ marginTop: 8 }}>{formError}</div>}
          </>
        )}
        {!from && <div className="muted" style={{ marginTop: 8 }}>Select the employee whose {type === 'group' ? 'groups' : 'loans'} are to be transferred.</div>}
      </div>

      <TransferHistory type={undefined} refreshKey={refreshKey} />

      <ConfirmDialog
        open={confirm}
        title="Transfer to another employee?"
        message={`${picked.size} ${type === 'group' ? 'group' : 'loan'}${picked.size === 1 ? '' : 's'} of ${from} will be handed to ${target ? `${target.code} — ${target.name}` : to}${type === 'group' && withLoans && runningLoansPicked ? `, together with ${runningLoansPicked} running loan${runningLoansPicked === 1 ? '' : 's'}` : ''}. EMI collection of these follows the new employee.`}
        confirmLabel="Transfer"
        loading={busy}
        onConfirm={submit}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}

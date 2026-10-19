import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const FINANCE = ['super_admin', 'admin', 'accountant'];
const thisMonth = () => new Date().toISOString().slice(0, 7);
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (m) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const SCOPE = { own: 'own activity', branch: 'whole branch', supervised: 'supervised branches' };
const UNIT_WORD = { loans: 'loans', members: 'members', groups: 'groups', products: 'products' };

function Card({ title, children, footer }) {
  return (
    <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 className="section-title" style={{ margin: 0 }}>{title}</h3>
      {children}
      {footer && <div style={{ marginTop: 'auto' }}>{footer}</div>}
    </div>
  );
}

export default function CommissionGenerate() {
  const toast = useToast();
  const { user } = useAuth();
  const canGenerate = FINANCE.includes(user?.role);
  const [month, setMonth] = useState(thisMonth());
  const [info, setInfo] = useState(null);
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [search, setSearch] = useState('');
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [o, l] = await Promise.all([api.commissionGenerate.overview(month), api.commissionGenerate.employees({ month, q })]);
      setInfo(o);
      setList(l);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [month, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setResult(null), [month]);

  async function generate(kind) {
    setBusy(kind);
    try {
      const r = await api.commissionGenerate.run({ month, kind });
      setResult(r);
      const parts = [];
      if (r.groupLeader) parts.push(`group leader: ${r.groupLeader.created} new, ${r.groupLeader.updated} changed`);
      if (r.employee) parts.push(`employee: ${r.employee.entries} commission${r.employee.entries === 1 ? '' : 's'}, ${inr(r.employee.total)}`);
      toast.success(`Generated for ${monthLabel(month)} — ${parts.join(' · ')}`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  }

  const gl = info?.groupLeader;
  const em = info?.employee;
  const notes = [
    ...(result?.groupLeader && !result.groupLeader.hasRule ? ['Group leader: no active Group Leader commission rule in Commission Master.'] : []),
    ...(result?.groupLeader?.skippedNoRule ? [`Group leader: ${result.groupLeader.skippedNoRule} month(s) of loans fall in a financial year that has no Group Leader rule.`] : []),
    ...(result?.employee?.notes || []).map((n) => `Employee: ${n}`),
  ];

  return (
    <>
      <PageHeader
        title="Commission Generate"
        description="Works out the commission of the group leaders and of the employees for a month, from the loans, collections and new members of the app and the rules of Commission Master. Generating again replaces the earlier result of the month (what is already paid to a group leader stays paid)."
        actions={canGenerate && <button className="btn primary" onClick={() => generate('both')} disabled={Boolean(busy)}>{busy === 'both' ? 'Generating…' : 'Generate both'}</button>}
      />

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="toolbar">
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Month
            <input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
          </label>
          {info && <span className="muted small">{info.financialYear ? `Financial year ${info.financialYear.name}` : 'No financial year covers this month (Admin Master → Financial Year)'}</span>}
        </div>
      </div>

      {notes.length > 0 && <div className="notice warn" style={{ marginBottom: 12 }}>{notes.map((n) => <div key={n}>{n}</div>)}</div>}

      {loading && !info ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 12 }}>
            <Card
              title="Group leader commission"
              footer={canGenerate && <button className="btn primary" onClick={() => generate('group_leader')} disabled={Boolean(busy)}>{busy === 'group_leader' ? 'Generating…' : 'Generate group leader commission'}</button>}
            >
              <p className="muted small" style={{ margin: 0 }}>A fixed amount per loan paid out to the group, every month for some months after the loan, as the rule says. The month the loan is paid out earns nothing.</p>
              {!gl?.hasRule && <div className="notice warn">No active Group Leader rule for this financial year. Add it in Commission Master.</div>}
              <dl className="detail-list">
                <div><dt>Groups with commission</dt><dd>{gl?.groups ?? 0}</dd></div>
                <div><dt>Loans earning it</dt><dd>{gl?.loans ?? 0}</dd></div>
                <div><dt>Commission of {monthLabel(month)}</dt><dd><strong>{inr(gl?.amount)}</strong></dd></div>
                <div><dt>Pending / paid</dt><dd>{inr(gl?.pendingAmount)} / {inr(gl?.depositedAmount)}</dd></div>
              </dl>
              <Link to="/group-leader-commission" className="small">Pay the due commission →</Link>
            </Card>
            <Card
              title="Employee commission"
              footer={canGenerate && <button className="btn primary" onClick={() => generate('employee')} disabled={Boolean(busy)}>{busy === 'employee' ? 'Generating…' : 'Generate employee commission'}</button>}
            >
              <p className="muted small" style={{ margin: 0 }}>Worked out for every employee from collections, loans paid out, new groups, new members and product sales, under the slabs of Commission Master for the employee's rank.</p>
              {!em?.hasRule && <div className="notice warn">No active employee commission rule for this financial year. Add the rules in Commission Master.</div>}
              <dl className="detail-list">
                <div><dt>Employees</dt><dd>{em?.employees ?? 0}</dd></div>
                <div><dt>Commissions</dt><dd>{em?.entries ?? 0}</dd></div>
                <div><dt>Total for {monthLabel(month)}</dt><dd><strong>{inr(em?.amount)}</strong></dd></div>
              </dl>
            </Card>
          </div>

          <div className="panel">
            <div className="toolbar">
              <h3 className="section-title" style={{ margin: 0 }}>Employee commission — {monthLabel(month)}</h3>
              <input type="search" className="toolbar-search" placeholder="Search employee ID or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
            </div>
            {!list?.employees.length ? (
              <EmptyState title="No employee commission for this month" description={canGenerate ? 'Press "Generate employee commission" after the rules are set in Commission Master.' : 'It is shown here once it has been generated.'} />
            ) : (
              <div className={`table-wrap${loading ? ' dim' : ''}`}>
                <table className="data-table">
                  <thead><tr><th>Employee</th><th>Commission for</th><th>Period</th><th>Whose activity</th><th className="num">Achieved</th><th className="num">Commission</th></tr></thead>
                  <tbody>
                    {list.employees.map((e) => e.items.map((it, i) => (
                      <tr key={it.id}>
                        <td data-label="Employee">{i === 0 ? <><strong>{e.employeeCode}</strong> {e.employeeName}</> : ''}</td>
                        <td data-label="For">{it.commissionLabel}</td>
                        <td data-label="Period">{it.periodLabel}</td>
                        <td data-label="Scope">{SCOPE[it.scope] || it.scope}</td>
                        <td data-label="Achieved" className="num">{it.unit === 'amount' ? inr(it.measure) : `${it.measure} ${UNIT_WORD[it.unit] || ''}`}</td>
                        <td data-label="Commission" className="num"><strong>{inr(it.amount)}</strong>{it.capped && <div className="muted small">capped</div>}</td>
                      </tr>
                    )).concat(
                      <tr key={`${e.employeeCode}-total`} style={{ background: 'var(--surface-2, rgba(0,0,0,.03))' }}>
                        <td colSpan={5} className="num"><strong>{e.employeeCode} total</strong></td>
                        <td className="num"><strong>{inr(e.total)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={5} className="num"><strong>All employees</strong></td><td className="num"><strong>{inr(list.total)}</strong></td></tr></tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

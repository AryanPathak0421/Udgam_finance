import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { todayIso } from '../utils/format.js';

const FINANCE = ['super_admin', 'admin', 'accountant'];
const thisMonth = () => todayIso().slice(0, 7);
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (m) => {
  if (!m || m === 'all') return 'All Months (Complete History)';
  const [y, mm] = m.split('-').map(Number);
  if (!y || !mm) return m;
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
  const [availableMonths, setAvailableMonths] = useState([]);
  const [info, setInfo] = useState(null);
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [search, setSearch] = useState('');
  const q = useDebounce(search);

  const fetchMonths = useCallback(async () => {
    try {
      const res = await api.commissionGenerate.months();
      if (res?.months && Array.isArray(res.months)) {
        setAvailableMonths(res.months);
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    fetchMonths();
  }, [fetchMonths]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [o, l] = await Promise.all([
        api.commissionGenerate.overview(month),
        api.commissionGenerate.employees({ month, q }),
      ]);
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
      if (r.groupLeader) parts.push(`group leader: ${r.groupLeader.created ?? 0} new, ${r.groupLeader.updated ?? 0} changed`);
      if (r.employee) parts.push(`employee: ${r.employee.entries ?? 0} commission${r.employee.entries === 1 ? '' : 's'}, ${inr(r.employee.total)}`);
      toast.success(`Generated for ${monthLabel(month)} — ${parts.join(' · ')}`);
      fetchMonths();
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

  const isAll = month === 'all';

  return (
    <>
      <PageHeader
        title="Commission Generate"
        description="Works out the commission of the group leaders and of the employees for a month or all past/current months, from the loans, collections, groups, and members of the app and the rules of Commission Master. Generating again updates the result."
        actions={canGenerate && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={() => setMonth(isAll ? thisMonth() : 'all')}
              title={isAll ? 'Switch to current month' : 'View all historical and current data across all months'}
            >
              {isAll ? 'View Current Month' : 'View All Months'}
            </button>
            <button
              className="btn primary"
              onClick={() => generate('both')}
              disabled={Boolean(busy)}
            >
              {busy === 'both' ? 'Generating…' : isAll ? 'Generate All Months (Old & Current Dates)' : 'Generate both'}
            </button>
          </div>
        )}
      />

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Select Month
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ minWidth: 220, padding: '6px 10px', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--border-color, #ccc)' }}
              aria-label="Select Activity Month"
            >
              <option value="all">★ All Months (Complete History)</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)} ({m})
                </option>
              ))}
            </select>
          </label>

          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Custom Month
            <input
              type="month"
              value={month === 'all' ? '' : month}
              max={thisMonth()}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              aria-label="Custom Month"
            />
          </label>

          {info && (
            <span className="muted small" style={{ marginLeft: 'auto' }}>
              {info.financialYear ? `Financial year: ${info.financialYear.name}` : 'No financial year covers this month'}
            </span>
          )}
        </div>
      </div>

      {notes.length > 0 && <div className="notice warn" style={{ marginBottom: 12 }}>{notes.map((n) => <div key={n}>{n}</div>)}</div>}

      {loading && !info ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 12 }}>
            <Card
              title="Group leader commission"
              footer={canGenerate && (
                <button className="btn primary" onClick={() => generate('group_leader')} disabled={Boolean(busy)}>
                  {busy === 'group_leader' ? 'Generating…' : isAll ? 'Generate all group leader commissions' : 'Generate group leader commission'}
                </button>
              )}
            >
              <p className="muted small" style={{ margin: 0 }}>A fixed amount per loan paid out to the group, every month for some months after the loan, as the rule says. The month the loan is paid out earns nothing.</p>
              {!gl?.hasRule && <div className="notice warn">No active Group Leader rule in Commission Master.</div>}
              <dl className="detail-list">
                <div><dt>Groups with commission</dt><dd>{gl?.groups ?? 0}</dd></div>
                <div><dt>Loans earning it</dt><dd>{gl?.loans ?? 0}</dd></div>
                <div><dt>Commission ({isAll ? 'All History' : monthLabel(month)})</dt><dd><strong>{inr(gl?.amount)}</strong></dd></div>
                <div><dt>Pending / paid</dt><dd>{inr(gl?.pendingAmount)} / {inr(gl?.depositedAmount)}</dd></div>
              </dl>
              <Link to="/group-leader-commission" className="small">Pay the due commission →</Link>
            </Card>

            <Card
              title="Employee commission"
              footer={canGenerate && (
                <button className="btn primary" onClick={() => generate('employee')} disabled={Boolean(busy)}>
                  {busy === 'employee' ? 'Generating…' : isAll ? 'Generate all employee commissions' : 'Generate employee commission'}
                </button>
              )}
            >
              <p className="muted small" style={{ margin: 0 }}>Worked out for all past and current employees from collections, loans paid out, new groups, new members and product sales, under the slabs of Commission Master.</p>
              {!em?.hasRule && <div className="notice warn">No active employee commission rule in Commission Master.</div>}
              <dl className="detail-list">
                <div><dt>Employees</dt><dd>{em?.employees ?? 0}</dd></div>
                <div><dt>Commissions</dt><dd>{em?.entries ?? 0}</dd></div>
                <div><dt>Total ({isAll ? 'All History' : monthLabel(month)})</dt><dd><strong>{inr(em?.amount)}</strong></dd></div>
              </dl>
            </Card>
          </div>

          <div className="panel">
            <div className="toolbar" style={{ flexWrap: 'wrap', gap: 10 }}>
              <h3 className="section-title" style={{ margin: 0 }}>Employee commission — {monthLabel(month)}</h3>
              <input type="search" className="toolbar-search" placeholder="Search employee ID or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
            </div>
            {!list?.employees?.length ? (
              <EmptyState
                title={`No employee commission for ${isAll ? 'any month' : 'this month'}`}
                description={canGenerate ? `Press "Generate employee commission" to process all past and current staff activity.` : 'It is shown here once it has been generated.'}
              />
            ) : (
              <div className={`table-wrap${loading ? ' dim' : ''}`}>
                <table className="data-table">
                  <thead>
                    <tr>
                      {isAll && <th>Month</th>}
                      <th>Employee</th>
                      <th>Commission for</th>
                      <th>Period</th>
                      <th>Whose activity</th>
                      <th className="num">Achieved</th>
                      <th className="num">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.employees.map((e) => e.items.map((it, i) => (
                      <tr key={it.id || `${e.employeeCode}-${i}`}>
                        {isAll && (
                          <td data-label="Month">
                            <span className="badge muted small" style={{ fontWeight: 600 }}>{it.month}</span>
                          </td>
                        )}
                        <td data-label="Employee">{i === 0 ? <><strong>{e.employeeCode}</strong> {e.employeeName}</> : ''}</td>
                        <td data-label="For">{it.commissionLabel}</td>
                        <td data-label="Period">{it.periodLabel}</td>
                        <td data-label="Scope">{SCOPE[it.scope] || it.scope}</td>
                        <td data-label="Achieved" className="num">{it.unit === 'amount' ? inr(it.measure) : `${it.measure} ${UNIT_WORD[it.unit] || ''}`}</td>
                        <td data-label="Commission" className="num"><strong>{inr(it.amount)}</strong>{it.capped && <div className="muted small">capped</div>}</td>
                      </tr>
                    )).concat(
                      <tr key={`${e.employeeCode}-total`} style={{ background: 'var(--surface-2, rgba(0,0,0,.03))' }}>
                        <td colSpan={isAll ? 6 : 5} className="num"><strong>{e.employeeCode} total</strong></td>
                        <td className="num"><strong>{inr(e.total)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={isAll ? 6 : 5} className="num"><strong>All employees</strong></td>
                      <td className="num"><strong>{inr(list.total)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

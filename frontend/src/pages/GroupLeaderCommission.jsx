import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { todayIso } from '../utils/format.js';

const FINANCE = ['super_admin', 'admin', 'accountant'];
const thisMonth = () => todayIso().slice(0, 7);
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (m) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

// Pay everything that is due to a group: the leader's OTP is sent to the leader's registered mobile and checked, then the commission is paid.
function PayDialog({ group, onClose, onDone }) {
  const toast = useToast();
  const [sent, setSent] = useState(null);
  const [verified, setVerified] = useState(false);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const r = await api.groupCommission.sendDueOtp(group.groupId);
      setSent(r);
      setOtp('');
      setVerified(false);
      toast.success(`OTP sent to ${r.sentTo}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit OTP');
    setBusy(true);
    setError('');
    try {
      await api.groupCommission.verifyDueOtp(sent.challengeId, otp);
      setVerified(true);
      toast.success('OTP verified');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    setBusy(true);
    setError('');
    try {
      const r = await api.groupCommission.payDue(group.groupId, sent.challengeId);
      toast.success(`${inr(r.amount)} paid to ${group.leaderName} (${r.paid} month${r.paid === 1 ? '' : 's'})`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Pay commission — ${group.groupCode}`} onClose={onClose} busy={busy} size="lg" footer={<button className="btn" onClick={onClose} disabled={busy}>Cancel</button>}>
      <dl className="detail-list">
        <div><dt>Group</dt><dd>{group.groupCode} — {group.groupName}</dd></div>
        <div><dt>Leader</dt><dd>{group.leaderName} ({group.leaderMobile || 'no mobile number'})</dd></div>
        <div><dt>Due</dt><dd><strong>{inr(group.totalDue)}</strong> for {group.entries.length} month{group.entries.length === 1 ? '' : 's'}</dd></div>
      </dl>
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table className="data-table">
          <thead><tr><th>Month</th><th className="num">Loans</th><th className="num">Per loan</th><th className="num">Commission</th></tr></thead>
          <tbody>
            {group.entries.map((e) => (
              <tr key={e.id}>
                <td data-label="Month">{monthLabel(e.month)}</td>
                <td data-label="Loans" className="num">{e.loans}</td>
                <td data-label="Per loan" className="num">{e.perLoan === null ? 'Mixed' : inr(e.perLoan)}</td>
                <td data-label="Commission" className="num">{inr(e.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3} className="num"><strong>Total due</strong></td><td className="num"><strong>{inr(group.totalDue)}</strong></td></tr></tfoot>
        </table>
      </div>

      {!group.hasMobile ? (
        <div className="notice warn">The group leader has no registered mobile number, so the OTP cannot be sent. An admin adds it in Group Master.</div>
      ) : !sent ? (
        <>
          <p className="muted">An OTP goes to the group leader's registered mobile number. The commission is paid only after the leader shares it.</p>
          {error && <div className="field-error" role="alert">{error}</div>}
          <button className="btn primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send OTP'}</button>
        </>
      ) : !verified ? (
        <form onSubmit={verify} noValidate>
          <p className="muted">OTP sent to <strong>{sent.sentTo}</strong>. Valid for 5 minutes.</p>
          {sent.devOtp && <div className="notice warn" style={{ marginBottom: 12 }}>Development mode — no SMS was sent. OTP: <strong>{sent.devOtp}</strong></div>}
          <FormField id="gotp" label="Enter OTP" required error={error}>
            <input id="gotp" value={otp} inputMode="numeric" maxLength={6} autoFocus autoComplete="one-time-code" onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '')); setError(''); }} />
          </FormField>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify OTP'}</button>
            <button className="btn" type="button" onClick={send} disabled={busy}>Resend OTP</button>
          </div>
        </form>
      ) : (
        <>
          <div className="notice" style={{ marginBottom: 12 }}>✓ OTP verified. Pay {inr(group.totalDue)} to {group.leaderName} now.</div>
          {error && <div className="field-error" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
          <button className="btn primary" onClick={pay} disabled={busy}>{busy ? 'Paying…' : `Pay ${inr(group.totalDue)}`}</button>
        </>
      )}
    </Modal>
  );
}

function DueTab({ canPay }) {
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pay, setPay] = useState(null);
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.groupCommission.due({ q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [q]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="panel">
      <div className="toolbar">
        <input type="search" className="toolbar-search" placeholder="Search by group code, group name or leader" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search group" />
        {data && <span className="muted small">{data.total} group{data.total === 1 ? '' : 's'} with commission due · total due {inr(data.totalDue)}</span>}
      </div>
      {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : !data?.items.length ? (
        <EmptyState title={q ? 'No due commission for this group' : 'No group leader commission is due'} description="Commission is due from the month after loans are paid out. Generate it under Commission → Commission Generate." />
      ) : (
        <div className={`table-wrap${loading ? ' dim' : ''}`}>
          <table className="data-table">
            <thead><tr><th>Group code</th><th>Group name</th><th>Leader</th><th>Mobile</th><th className="num">Months due</th><th className="num">Loans</th><th className="num">Due commission</th>{canPay && <th className="actions-col">Actions</th>}</tr></thead>
            <tbody>
              {data.items.map((g) => (
                <tr key={g.groupId}>
                  <td data-label="Group code"><strong>{g.groupCode}</strong></td>
                  <td data-label="Group">{g.groupName}</td>
                  <td data-label="Leader">{g.leaderName}</td>
                  <td data-label="Mobile">{g.leaderMobile || '—'}</td>
                  <td data-label="Months" className="num">{g.entries.length}</td>
                  <td data-label="Loans" className="num">{g.loans}</td>
                  <td data-label="Due" className="num"><strong>{inr(g.totalDue)}</strong></td>
                  {canPay && <td data-label="Actions" className="actions-col"><button className="btn sm primary" onClick={() => setPay(g)}>Pay</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pay && <PayDialog group={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); load(); }} />}
    </div>
  );
}

function ReportTab() {
  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.groupCommission.report({ month, status, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [month, status, q]);
  useEffect(() => {
    load();
  }, [load]);
  const t = data?.totals;

  return (
    <>
      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div className="panel" style={{ padding: 14 }}><div className="muted small">Groups</div><strong style={{ fontSize: 22 }}>{t.groups}</strong></div>
          <div className="panel" style={{ padding: 14 }}><div className="muted small">Eligible loans</div><strong style={{ fontSize: 22 }}>{t.loans}</strong></div>
          <div className="panel" style={{ padding: 14 }}><div className="muted small">Pending ({t.pendingCount})</div><strong style={{ fontSize: 22 }}>{inr(t.pendingAmount)}</strong></div>
          <div className="panel" style={{ padding: 14 }}><div className="muted small">Paid ({t.depositedCount})</div><strong style={{ fontSize: 22 }}>{inr(t.depositedAmount)}</strong></div>
        </div>
      )}
      <div className="panel">
        <div className="toolbar">
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
          <input type="search" className="toolbar-search" placeholder="Search group or leader" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="pending">Pending</option>
            <option value="deposited">Paid</option>
          </select>
        </div>
        {loading && !data ? <Spinner label="Loading report…" /> : error ? <ErrorState message={error} onRetry={load} /> : !data?.items.length ? (
          <EmptyState title={`No commission for ${monthLabel(month)}`} description="Commission appears from the month after loans are paid out, once it has been generated." />
        ) : (
          <div className={`table-wrap${loading ? ' dim' : ''}`}>
            <table className="data-table">
              <thead><tr><th>Group code</th><th>Group name</th><th>Leader</th><th>Mobile</th><th className="num">Loans</th><th className="num">Per loan</th><th className="num">Commission</th><th>Status</th></tr></thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Group code"><strong>{e.groupCode}</strong></td>
                    <td data-label="Group">{e.groupName}</td>
                    <td data-label="Leader">{e.leaderName}</td>
                    <td data-label="Mobile">{e.leaderMobile}</td>
                    <td data-label="Loans" className="num">{e.loans}</td>
                    <td data-label="Per loan" className="num">{e.perLoan === null ? 'Mixed' : inr(e.perLoan)}</td>
                    <td data-label="Commission" className="num"><strong>{inr(e.amount)}</strong></td>
                    <td data-label="Status"><span className={`badge ${e.status === 'deposited' ? 'green' : 'grey'}`}>{e.status === 'deposited' ? `Paid ${e.depositedAt ? new Date(e.depositedAt).toLocaleDateString('en-IN') : ''}` : 'Pending'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default function GroupLeaderCommission() {
  const { user } = useAuth();
  const canPay = FINANCE.includes(user?.role);
  const [tab, setTab] = useState('due');

  return (
    <>
      <PageHeader
        title="Group Leader Commission Payment"
        description="Find the group by its code, see the commission that is due and pay it. The group leader's OTP is needed to pay."
        actions={<Link to="/commission/generate" className="btn">Commission Generate</Link>}
      />
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <button className={`btn${tab === 'due' ? ' primary' : ''}`} onClick={() => setTab('due')}>Due commission</button>
        <button className={`btn${tab === 'report' ? ' primary' : ''}`} onClick={() => setTab('report')}>Monthly report</button>
      </div>
      {tab === 'due' ? <DueTab canPay={canPay} /> : <ReportTab />}
    </>
  );
}

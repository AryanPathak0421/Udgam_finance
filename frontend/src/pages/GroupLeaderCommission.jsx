import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const FINANCE = ['super_admin', 'admin', 'accountant'];
const thisMonth = () => new Date().toISOString().slice(0, 7);
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (m) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

// Deposit flow: send OTP to the leader's registered mobile, then verify it.
function DepositDialog({ entry, onClose, onDone }) {
  const toast = useToast();
  const [sent, setSent] = useState(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const r = await api.groupCommission.sendOtp(entry.id);
      setSent(r);
      setOtp('');
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
      await api.groupCommission.verifyOtp(entry.id, otp);
      toast.success('Commission deposited');
      onDone();
    } catch (err) {
      setError(err.errors?.otp ? err.message : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Deposit group leader commission" onClose={onClose} busy={busy} footer={<button className="btn" onClick={onClose} disabled={busy}>Cancel</button>}>
      <dl className="detail-list">
        <div><dt>Group</dt><dd>{entry.groupCode} — {entry.groupName}</dd></div>
        <div><dt>Leader</dt><dd>{entry.leaderName} ({entry.leaderMobile})</dd></div>
        <div><dt>Month</dt><dd>{monthLabel(entry.month)}</dd></div>
        <div><dt>Amount</dt><dd><strong>{inr(entry.amount)}</strong> ({entry.loans} loans)</dd></div>
      </dl>

      {!sent ? (
        <>
          <p className="muted">An OTP will be sent to the group leader's registered mobile number. The commission is deposited only after the leader shares the OTP.</p>
          {error && <div className="field-error" role="alert">{error}</div>}
          <button className="btn primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send OTP'}</button>
        </>
      ) : (
        <form onSubmit={verify} noValidate>
          <p className="muted">OTP sent to <strong>{sent.sentTo}</strong>. Valid for 5 minutes.</p>
          {sent.devOtp && <div className="notice warn" style={{ marginBottom: 12 }}>Development mode — no SMS was sent. OTP: <strong>{sent.devOtp}</strong></div>}
          <FormField id="otp" label="Enter OTP" required error={error}>
            <input id="otp" value={otp} inputMode="numeric" maxLength={6} autoFocus autoComplete="one-time-code"
              onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '')); setError(''); }} />
          </FormField>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify & Deposit'}</button>
            <button className="btn" type="button" onClick={send} disabled={busy}>Resend OTP</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function GroupLeaderCommission() {
  const toast = useToast();
  const { user } = useAuth();
  const canDeposit = FINANCE.includes(user?.role);

  const [month, setMonth] = useState(thisMonth());
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [deposit, setDeposit] = useState(null);
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

  async function generate() {
    setGenerating(true);
    try {
      const r = await api.groupCommission.generate();
      if (!r.hasRule) toast.error('No active Group Leader commission rule found in Commission Master.');
      else toast.success(`Updated: ${r.created} new, ${r.updated} changed, ${r.removed} removed`);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  }

  const t = data?.totals;

  return (
    <>
      <PageHeader
        title="Group Leader Commission"
        description="Monthly, group-wise commission for group leaders. Commission starts the month after disbursement; deposit needs an OTP from the leader."
        actions={canDeposit && <button className="btn primary" onClick={generate} disabled={generating}>{generating ? 'Generating…' : 'Generate commission'}</button>}
      />

      {t && (
        <div className="stat-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 12 }}>
          <div className="panel" style={{ padding: 14 }}><div className="muted small">Groups</div><strong style={{ fontSize: 22 }}>{t.groups}</strong></div>
          <div className="panel" style={{ padding: 14 }}><div className="muted small">Eligible loans</div><strong style={{ fontSize: 22 }}>{t.loans}</strong></div>
          <div className="panel" style={{ padding: 14 }}><div className="muted small">Pending ({t.pendingCount})</div><strong style={{ fontSize: 22 }}>{inr(t.pendingAmount)}</strong></div>
          <div className="panel" style={{ padding: 14 }}><div className="muted small">Deposited ({t.depositedCount})</div><strong style={{ fontSize: 22 }}>{inr(t.depositedAmount)}</strong></div>
        </div>
      )}

      <div className="panel">
        <div className="toolbar">
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
          <input type="search" className="toolbar-search" placeholder="Search group or leader" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="pending">Pending</option>
            <option value="deposited">Deposited</option>
          </select>
        </div>

        {loading && !data ? (
          <Spinner label="Loading report…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !data?.items.length ? (
          <EmptyState
            title={`No commission for ${monthLabel(month)}`}
            description="Commission appears from the month after loans are disbursed (enter them under Centers & Groups → Disbursements, then Generate)."
          />
        ) : (
          <div className={`table-wrap${loading ? ' dim' : ''}`}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Group code</th>
                  <th>Group name</th>
                  <th>Leader</th>
                  <th>Mobile</th>
                  <th>Month & year</th>
                  <th className="num">Loans disbursed</th>
                  <th className="num">Per loan</th>
                  <th className="num">Monthly commission</th>
                  <th>Status</th>
                  {canDeposit && <th className="actions-col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Group code"><strong>{e.groupCode}</strong></td>
                    <td data-label="Group">{e.groupName}</td>
                    <td data-label="Leader">{e.leaderName}</td>
                    <td data-label="Mobile">{e.leaderMobile}</td>
                    <td data-label="Month">{monthLabel(e.month)}</td>
                    <td data-label="Loans" className="num">{e.loans}</td>
                    <td data-label="Per loan" className="num">{e.perLoan === null ? 'Mixed' : inr(e.perLoan)}</td>
                    <td data-label="Commission" className="num"><strong>{inr(e.amount)}</strong></td>
                    <td data-label="Status"><span className={`badge ${e.status === 'deposited' ? 'green' : 'grey'}`}>{e.status === 'deposited' ? 'Deposited' : 'Pending'}</span></td>
                    {canDeposit && (
                      <td data-label="Actions" className="actions-col">
                        {e.status === 'pending' ? (
                          <button className="btn sm primary" onClick={() => setDeposit(e)}>Deposit</button>
                        ) : (
                          <span className="muted small">{e.depositedAt ? new Date(e.depositedAt).toLocaleDateString('en-IN') : ''}</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deposit && <DepositDialog entry={deposit} onClose={() => setDeposit(null)} onDone={() => { setDeposit(null); load(); }} />}
    </>
  );
}

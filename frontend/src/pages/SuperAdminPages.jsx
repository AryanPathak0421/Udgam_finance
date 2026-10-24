import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { BranchSelect, Refresh, Summary, useLoad, inr, dmy, today } from './HrPages.jsx';

const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, ' ') : '—');
const Dates = ({ from, setFrom, to, setTo }) => (
  <>
    <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
    <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
  </>
);
const State = ({ list, empty, children }) => (list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : !list.data ? <EmptyState title="No data" /> : empty ? <EmptyState title={empty} /> : children());
const ROLE_OPTIONS = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];

// ---------------------------------------------------------------------------------------------------------------------------
// Bulk notification
const AUDIENCE = [['all_staff', 'All staff'], ['branch_staff', 'Staff of a branch'], ['role_staff', 'Staff of a role'], ['all_members', 'All members (SMS)'], ['branch_members', 'Members of a branch (SMS)']];

export function BulkNotification() {
  const toast = useToast();
  const [f, setF] = useState({ audience: 'all_staff', branch: '', role: '', title: '', message: '', inApp: true, sms: false });
  const [branches, setBranches] = useState([]);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const history = useLoad(() => api.superAdmin.notifications(), []);
  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  const staff = f.audience.endsWith('_staff');
  const needsBranch = f.audience.startsWith('branch');
  useEffect(() => {
    setPreview(null);
    if ((needsBranch && !f.branch) || (f.audience === 'role_staff' && !f.role)) return;
    api.superAdmin.notificationPreview({ audience: f.audience, branch: f.branch, role: f.role }).then(setPreview).catch(() => {});
  }, [f.audience, f.branch, f.role]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  async function send() {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.superAdmin.sendNotification({ ...f, inApp: staff ? f.inApp : false });
      toast.success(`Sent to ${r.recipients}${r.appCount ? ` · ${r.appCount} in the app` : ''}${f.sms ? ` · SMS ${r.smsSent} sent${r.smsFailed ? `, ${r.smsFailed} failed` : ''}` : ''}`);
      setF((x) => ({ ...x, title: '', message: '' }));
      history.load();
    } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); setConfirm(false); }
  }
  const items = history.data?.items || [];
  return (
    <>
      <PageHeader title="Bulk Notification" description="Send one message to many people: to the staff in the app (they see it in the bell) and / or by SMS, or by SMS to the members." />
      <div className="panel" style={{ padding: 16 }}>
        <div className="form-grid">
          <FormField id="bnaud" label="Send to" required error={errors.audience}><select id="bnaud" value={f.audience} onChange={(e) => { const a = e.target.value; setF((x) => ({ ...x, audience: a, inApp: a.endsWith('_staff'), sms: a.endsWith('members') ? true : x.sms })); }}>{AUDIENCE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></FormField>
          {needsBranch && <FormField id="bnbr" label="Branch" required error={errors.branch}><select id="bnbr" value={f.branch} onChange={set('branch')}><option value="">Select</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></FormField>}
          {f.audience === 'role_staff' && <FormField id="bnrole" label="Role" required error={errors.role}><select id="bnrole" value={f.role} onChange={set('role')}><option value="">Select</option>{ROLE_OPTIONS.map((r) => <option key={r} value={r}>{cap(r)}</option>)}</select></FormField>}
          <FormField id="bntitle" label="Title" required className="span-2" error={errors.title}><input id="bntitle" value={f.title} maxLength={80} onChange={set('title')} /></FormField>
          <FormField id="bnmsg" label="Message" required className="span-2" error={errors.message} hint={`${f.message.length}/300`}><input id="bnmsg" value={f.message} maxLength={300} onChange={set('message')} /></FormField>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '4px 0 8px' }}>
          {staff && <label><input type="checkbox" checked={f.inApp} onChange={(e) => setF((x) => ({ ...x, inApp: e.target.checked }))} /> In the app (bell)</label>}
          <label><input type="checkbox" checked={f.sms} onChange={(e) => setF((x) => ({ ...x, sms: e.target.checked }))} /> By SMS</label>
        </div>
        {errors.channels && <div className="field-error">{errors.channels}</div>}
        <div className="muted small" style={{ marginBottom: 8 }}>
          {preview ? `${preview.people} ${staff ? 'staff' : 'members'} will get it${f.sms ? `; ${preview.withMobile} have a mobile number for the SMS${preview.withMobile > preview.smsLimit ? ` (more than ${preview.smsLimit}: choose a branch or a role)` : ''}` : ''}.` : 'Choose who gets it to see how many people that is.'}
        </div>
        <button className="btn primary" disabled={busy || !f.title || !f.message || !preview} onClick={() => setConfirm(true)}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
      <div className="panel">
        <h3 className="section-title">Sent so far</h3>
        <State list={history} empty={items.length === 0 ? 'Nothing sent yet' : ''}>{() => (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Sent</th><th>Message</th><th>To</th><th className="num">People</th><th>Channels</th></tr></thead>
              <tbody>
                {items.map((n) => (
                  <tr key={n.id}>
                    <td data-label="Sent">{dmy(n.at)}<div className="muted small">{n.by}</div></td>
                    <td data-label="Message"><strong>{n.title}</strong><div className="muted small">{n.message}</div></td>
                    <td data-label="To">{AUDIENCE.find(([k]) => k === n.audience)?.[1]}{n.branch ? ` · ${n.branch}` : ''}{n.role ? ` · ${cap(n.role)}` : ''}</td>
                    <td data-label="People" className="num">{n.recipients}</td>
                    <td data-label="Channels">{n.inApp ? `App ${n.appCount}` : ''}{n.inApp && n.sms ? ' · ' : ''}{n.sms ? `SMS ${n.smsSent}${n.smsFailed ? ` (${n.smsFailed} failed)` : ''}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}</State>
      </div>
      <ConfirmDialog open={confirm} title="Send the notification?" confirmLabel="Send" loading={busy} onCancel={() => setConfirm(false)} onConfirm={send}
        message={preview ? `"${f.title}" goes to ${preview.people} ${staff ? 'staff' : 'members'}${f.sms ? ' by SMS' : ''}${staff && f.inApp ? ' and in the app' : ''}. It cannot be taken back.` : ''} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Holiday master
export function HolidayMaster() {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [search, setSearch] = useState('');
  const list = useLoad(() => api.superAdmin.holidays({ year }), [year]);
  const [edit, setEdit] = useState(null);
  const [f, setF] = useState({ date: '', name: '', branch: '' });
  const [branches, setBranches] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  const open = (h) => { setEdit(h || {}); setF({ date: h?.date || '', name: h?.name || '', branch: h?.branch?.id || '' }); setErrors({}); };
  async function save() {
    setBusy(true);
    setErrors({});
    try { if (edit.id) await api.superAdmin.updateHoliday(edit.id, f); else await api.superAdmin.createHoliday(f); toast.success('Saved. The due dates of the daily loans are moved off this day in a moment.'); setEdit(null); list.load(); } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.superAdmin.removeHoliday(removing.id); toast.success('Deleted. The due dates of the daily loans are counted again.'); setRemoving(null); list.load(); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  }
  const q = search.trim().toLowerCase();
  const items = (list.data?.items || []).filter((h) => !q || [h.name, h.day, dmy(h.date), h.date, h.branch?.code, h.branch?.name].some((v) => String(v || '').toLowerCase().includes(q)));
  return (
    <>
      <PageHeader title="Holiday Master" description="The days the company is closed (Diwali, Holi ...), for every branch or for one branch. A holiday is paid in the salary even when the attendance is not marked, and the daily loans have no installment on it (like Sunday, the weekly off)." />
      <div className="panel">
        <div className="toolbar">
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Year <input type="number" value={year} min={2020} max={2100} onChange={(e) => setYear(Number(e.target.value) || year)} style={{ width: 90 }} aria-label="Year" /></label>
          <input type="search" placeholder="Search holiday, date, branch" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" style={{ minWidth: 220 }} />
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn primary" onClick={() => open(null)}>Add a holiday</button>
        </div>
        <State list={list} empty={items.length === 0 ? (search ? 'No holiday matches the search' : `No holiday is entered for ${year}`) : ''}>{() => (
          <>
            <Summary items={[['Holidays', items.length]]} />
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th>For</th><th /></tr></thead>
                <tbody>
                  {items.map((h) => (
                    <tr key={h.id}>
                      <td data-label="Date"><strong>{dmy(h.date)}</strong></td><td data-label="Day">{h.day}</td><td data-label="Holiday">{h.name}</td>
                      <td data-label="For">{h.branch ? `${h.branch.code} — ${h.branch.name}` : 'Every branch'}</td>
                      <td><div style={{ display: 'flex', gap: 6 }}><button className="btn sm" onClick={() => open(h)}>Edit</button><button className="btn sm danger-outline" onClick={() => setRemoving(h)}>Delete</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}</State>
      </div>
      <Modal open={Boolean(edit)} title={edit?.id ? 'Edit the holiday' : 'Add a holiday'} onClose={() => setEdit(null)} busy={busy}
        footer={<><button className="btn" onClick={() => setEdit(null)} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
        <FormField id="hdate" label="Date" required error={errors.date}><input id="hdate" type="date" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} /></FormField>
        <FormField id="hname" label="Holiday" required error={errors.name}><input id="hname" value={f.name} maxLength={60} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></FormField>
        <FormField id="hbr" label="For" error={errors.branch}><select id="hbr" value={f.branch} onChange={(e) => setF((x) => ({ ...x, branch: e.target.value }))}><option value="">Every branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></FormField>
      </Modal>
      <ConfirmDialog open={Boolean(removing)} title="Delete the holiday?" tone="danger" confirmLabel="Delete" loading={busy} onCancel={() => setRemoving(null)} onConfirm={remove} message={removing ? `${removing.name} on ${dmy(removing.date)} is deleted.` : ''} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Profit and loss
export function ProfitLoss() {
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const list = useLoad(() => api.superAdmin.profitLoss({ branch, from, to }), [branch, from, to]);
  const d = list.data;
  const Side = ({ title, lines, total, tone }) => (
    <div className="panel" style={{ padding: 14, flex: '1 1 380px', minWidth: 0 }}>
      <h3 className="section-title">{title}</h3>
      <div className="table-wrap">
        <table className="data-table">
          <tbody>
            {lines.length === 0 && <tr><td className="muted">Nothing in this period.</td></tr>}
            {lines.map((l) => <tr key={l.key}><td data-label="Particulars">{l.label}</td><td data-label="Amount" className="num">{inr(l.amount)}</td></tr>)}
            <tr style={{ borderTop: '2px solid currentColor' }}><td><strong>Total</strong></td><td className="num"><span className={`badge ${tone}`}><strong>{inr(total)}</strong></span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <>
      <PageHeader title="Profit & Loss" description="What came in and what went out in the period, on what was actually received and paid: the interest part of the EMI collected, the fees, the Cashbook payments (salary, rent, commission, other) and the income / expense ledgers of the Ledger master." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <Dates from={from} setFrom={setFrom} to={to} setTo={setTo} />
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        <State list={list}>{() => (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Side title="Income" lines={d.income} total={d.totalIncome} tone="green" />
              <Side title="Expense" lines={d.expense} total={d.totalExpense} tone="danger" />
            </div>
            <div className="panel" style={{ padding: 14, marginTop: 12 }}>
              <span style={{ fontSize: 18 }}>{d.profit >= 0 ? 'Net profit' : 'Net loss'} <span className={`badge ${d.profit >= 0 ? 'green' : 'danger'}`}><strong>{inr(Math.abs(d.profit))}</strong></span></span>
              <div className="muted small" style={{ marginTop: 6 }}>Principal collected in the period (not income): {inr(d.principalCollected)}. Interest is the share of every EMI received that the loan schedule marks as interest. EMI from the old system that was assumed paid is not counted.</div>
            </div>
          </>
        )}</State>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Complaints of the whole company
export function ComplaintOverview() {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [next, setNext] = useState({ status: '', resolution: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.superAdmin.complaints({ branch, status, q }), [branch, status, q]);
  const d = list.data;
  // the status of a complaint is updated here: a toll free one (open, in progress, resolved) or a product one (resolve, then delivered)
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      if (editing.source === 'toll_free') await api.hr.setComplaintStatus(editing.id, { status: next.status, resolution: next.resolution });
      else if (next.status === 'delivered') await api.productComplaints.deliver(editing.id);
      else await api.productComplaints.resolve(editing.id, next.resolution);
      toast.success('Status updated');
      setEditing(null);
      list.load();
    } catch (err) { setErrors(err.errors || { status: err.message }); toast.error(err.message); } finally { setBusy(false); }
  }
  const choices = editing ? (editing.source === 'toll_free' ? [['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved']].filter(([k]) => k !== editing.statusLabel) : editing.statusLabel === 'submitted' ? [['resolved', 'Resolved']] : editing.statusLabel === 'resolved' ? [['delivered', 'Delivered to the member']] : []) : [];
  return (
    <>
      <PageHeader title="Complaint" description="Every complaint of the company in one place: the toll free ones and the product complaints, how old the open ones are and in which branch they are. They are looked into under HR Department → Toll Free Complaint Entry and Stock → Product Orders." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="open">Open</option><option value="closed">Closed</option><option value="">All</option></select>
          <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        <State list={list} empty={d && d.items.length === 0 ? 'No complaint for this filter' : ''}>{() => (
          <>
            <Summary items={[['Complaints', d.summary.total], ['Open', d.summary.open], ['Toll free open', d.summary.tollFreeOpen], ['Product open', d.summary.productOpen], ['Open over 7 days', d.summary.over7]]} />
            {d.openByBranch.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 10px' }}>{d.openByBranch.map((b) => <span key={b.branch} className="badge grey">{b.branch}: {b.open} open</span>)}</div>}
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Complaint</th><th>From</th><th>About</th><th>Branch</th><th>Handled by</th><th>Status</th><th className="num">Open since</th><th /></tr></thead>
                <tbody>
                  {d.items.map((c) => (
                    <tr key={`${c.source}-${c.id}`}>
                      <td data-label="Complaint"><strong>{c.no}</strong><div className="muted small">{c.source === 'toll_free' ? 'Toll free' : 'Product'} · {dmy(c.date)}</div></td>
                      <td data-label="From">{c.who}</td><td data-label="About">{c.about}</td><td data-label="Branch">{c.branch}</td><td data-label="Handled by">{c.handledBy || '—'}</td>
                      <td data-label="Status"><span className={`badge ${c.status === 'open' ? 'amber' : 'green'}`}>{cap(c.statusLabel)}</span></td>
                      <td data-label="Open since" className="num">{c.status === 'open' ? <span className={`badge ${c.ageDays > 7 ? 'danger' : 'grey'}`}>{c.ageDays} d</span> : '—'}</td>
                      <td>{(c.status === 'open' || (c.source === 'toll_free' && c.statusLabel === 'resolved')) && <button className="btn sm" onClick={() => { setEditing(c); setNext({ status: '', resolution: '' }); setErrors({}); }}>Update status</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}</State>
      </div>
      {editing && (
        <Modal open title={`${editing.no} — update the status`} onClose={() => setEditing(null)} busy={busy}
          footer={<><button className="btn" onClick={() => setEditing(null)} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy || !next.status}>{busy ? 'Saving…' : 'Update'}</button></>}>
          <p className="muted">{editing.who} · {editing.about}<br />Now: <strong>{cap(editing.statusLabel)}</strong></p>
          <FormField id="cpst" label="New status" required error={errors.status}>
            <select id="cpst" value={next.status} onChange={(e) => setNext((x) => ({ ...x, status: e.target.value }))}><option value="">Select</option>{choices.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </FormField>
          {next.status !== 'delivered' && <FormField id="cpres" label="What was done" error={errors.resolution} hint="Required when resolving"><input id="cpres" value={next.resolution} maxLength={500} onChange={(e) => setNext((x) => ({ ...x, resolution: e.target.value }))} /></FormField>}
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Company summary (the columns of the old software's summary report)
const SUMMARY_COLUMNS = [
  ['New member', 'joined'], ['Total branch member', 'members'], ['Actual loan member', 'loanMembers'], ['Dual loan member', 'dualMembers'], ['Number of disbursement', 'loans'],
  ['Processing amount', 'processing', true], ['Insurance', 'insurance', true], ['Security deposit', 'securityDeposit', true], ['Security withdrawal', 'securityWithdrawal', true], ['Security interest withdrawal', 'securityInterestWithdrawal', true],
  ['Portfolio', 'portfolio', true], ['Due principal', 'duePrincipal', true], ['Due interest', 'dueInterest', true], ['Interest collection', 'interestCollection', true], ['Penalty receive', 'penalty', true],
  ['NPA member', 'npa'], ['NPA amount', 'npaOutstanding', true], ['Settlement account', 'settlements'], ['Auto settle', 'autoSettle'], ['Settlement amount', 'settlementAmount', true],
  ['Death settle', 'deathSettle'], ['Death settle amount', 'deathSettleAmount', true], ['Write-off member', 'writeOff'], ['Write-off member amount', 'writeOffAmount', true], ['Block member', 'blocked'],
  ['New group open', 'newGroups'], ['Group leader commission', 'commission', true], ['Product qty sell', 'productQty'], ['Product amount', 'productAmount', true],
];
export function CompanySummary() {
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const list = useLoad(() => api.superAdmin.companySummary({ branch, from, to }), [branch, from, to]);
  const d = list.data;
  const T = d?.totals;
  const cell = (v, money) => (money ? inr(v) : v);
  return (
    <>
      <PageHeader title="Company Summary Report" description="The whole company branch by branch for the period (members, disbursement, fees, security, due, collection, NPA, settlements, write-off, groups, commission and products). Portfolio and due are as on the last date."
        actions={<button type="button" className="btn no-print" onClick={() => window.print()} disabled={!d}>Print / PDF</button>} />
      <div className="panel">
        <style>{'@media print { @page { size: A3 landscape; margin: 8mm; } .summary-wide { font-size: 9px; } .summary-wide th, .summary-wide td { padding: 2px 4px !important; } .table-wrap { overflow: visible !important; } }'}</style>
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <Dates from={from} setFrom={setFrom} to={to} setTo={setTo} />
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        <State list={list}>{() => (
          <>
            <p className="muted small" style={{ margin: '4px 0 8px' }}>Company Summary Report: {d.from} to {d.to}</p>
            <div className="table-wrap">
              <table className="data-table summary-wide grid-lines">
                <thead><tr><th>Branch name</th>{SUMMARY_COLUMNS.map(([label, key]) => <th key={key} className="num">{label}</th>)}</tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.branchId}>
                      <td data-label="Branch name"><strong>{r.branch}</strong></td>
                      {SUMMARY_COLUMNS.map(([label, key, money]) => <td key={key} data-label={label} className="num">{cell(r[key], money)}</td>)}
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid currentColor' }}>
                    <td><strong>Total</strong></td>
                    {SUMMARY_COLUMNS.map(([label, key, money]) => <td key={key} className="num"><strong>{cell(T[key], money)}</strong></td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}</State>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Monitoring
const CLOSE = { not_closed: ['Not closed', 'danger'], submitted: ['Waiting', 'amber'], approved: ['Closed', 'green'], rejected: ['Sent back', 'danger'] };
export function Monitoring() {
  const [branch, setBranch] = useState('');
  const [date, setDate] = useState(today());
  const list = useLoad(() => api.superAdmin.monitoring({ branch, date }), [branch, date]);
  const d = list.data;
  const T = d?.totals;
  const time = (s) => (s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  return (
    <>
      <PageHeader title="Monitoring Report" description="How every branch is doing on a day: EMI due and collected, day close, who is at work, what is waiting for approval, open complaints and tasks that are late." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Date <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} aria-label="Date" /></label>
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        <State list={list}>{() => (
          <>
            <Summary items={[['EMI due', inr(T.due)], ['Collected', inr(T.collected)], ['Staff present', `${T.present}/${T.employees}`], ['Loans waiting', T.pendingLoans], ['App EMI waiting', T.pendingAppEmi], ['Leaves waiting', T.pendingLeaves], ['Open complaints', T.openComplaints], ['Late tasks', T.overdueTasks], ['Day not closed', T.notClosed]]} />
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Branch</th><th className="num">EMI due</th><th className="num">Collected</th><th className="num">%</th><th>Day close</th><th className="num">Present</th><th className="num">Loans waiting</th><th className="num">App EMI</th><th className="num">Leaves</th><th className="num">Complaints</th><th className="num">Late tasks</th><th>Last EMI received</th></tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.branchId}>
                      <td data-label="Branch"><strong>{r.branch}</strong></td><td data-label="EMI due" className="num">{inr(r.due)}</td><td data-label="Collected" className="num">{inr(r.collected)}</td>
                      <td data-label="%" className="num">{r.collectionPercent === null ? '—' : <span className={`badge ${r.collectionPercent >= 90 ? 'green' : r.collectionPercent >= 60 ? 'amber' : 'danger'}`}>{r.collectionPercent}%</span>}</td>
                      <td data-label="Day close"><span className={`badge ${CLOSE[r.dayClose]?.[1]}`}>{CLOSE[r.dayClose]?.[0]}</span>{r.lastClosed && <div className="muted small">last {dmy(r.lastClosed)}</div>}</td>
                      <td data-label="Present" className="num">{r.present}/{r.employees}</td><td data-label="Loans waiting" className="num">{r.pendingLoans || '—'}</td><td data-label="App EMI" className="num">{r.pendingAppEmi || '—'}</td>
                      <td data-label="Leaves" className="num">{r.pendingLeaves || '—'}</td><td data-label="Complaints" className="num">{r.openComplaints || '—'}</td><td data-label="Late tasks" className="num">{r.overdueTasks ? <span className="badge danger">{r.overdueTasks}</span> : '—'}</td>
                      <td data-label="Last EMI received">{time(r.lastReceipt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>EMI due is everything due up to the date and not yet paid; % is what was collected on the date against it.</div>
          </>
        )}</State>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Company graph: plain SVG charts
const short = (n) => (n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(Math.round(n)));
const monthShort = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

function GroupedBars({ data, series, height = 240 }) {
  const W = 760; const padL = 52; const padB = 34; const padT = 12; const H = height;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key])));
  const step = (W - padL) / data.length;
  const bw = Math.min(26, (step - 8) / series.length);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ width: '100%', maxWidth: W, height: 'auto' }}>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={padL} x2={W} y1={y(max * t)} y2={y(max * t)} stroke="currentColor" opacity="0.12" /><text x={padL - 6} y={y(max * t) + 4} fontSize="10" textAnchor="end" fill="currentColor" opacity="0.7">{short(max * t)}</text></g>)}
      {data.map((d, i) => (
        <g key={d.month}>
          {series.map((s, j) => <rect key={s.key} x={padL + i * step + (step - bw * series.length) / 2 + j * bw} y={y(d[s.key])} width={bw - 2} height={Math.max(H - padB - y(d[s.key]), 0)} fill={s.color} rx="2"><title>{`${monthShort(d.month)} — ${s.label}: ${s.money ? inr(d[s.key]) : d[s.key]}`}</title></rect>)}
          <text x={padL + i * step + step / 2} y={H - padB + 14} fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.8">{monthShort(d.month)}</text>
        </g>
      ))}
    </svg>
  );
}
const Legend = ({ series }) => <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '4px 0 6px' }}>{series.map((s) => <span key={s.key} className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: s.color, borderRadius: 3, display: 'inline-block' }} />{s.label}</span>)}</div>;

function HBars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.outstanding));
  return (
    <div>
      {data.map((d) => (
        <div key={d.branch} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 110px', gap: 8, alignItems: 'center', margin: '6px 0' }}>
          <span className="small">{d.branch}</span>
          <div style={{ position: 'relative', height: 16, background: 'rgba(120,130,140,.12)', borderRadius: 4 }} title={`Outstanding ${inr(d.outstanding)} · overdue ${inr(d.overdue)} · NPA ${inr(d.npa)}`}>
            <div style={{ position: 'absolute', inset: 0, width: `${(d.outstanding / max) * 100}%`, background: '#2a9d8f', borderRadius: 4 }} />
            <div style={{ position: 'absolute', inset: 0, width: `${(d.overdue / max) * 100}%`, background: '#e9a23b', borderRadius: 4 }} />
            <div style={{ position: 'absolute', inset: 0, width: `${(d.npa / max) * 100}%`, background: '#d1495b', borderRadius: 4 }} />
          </div>
          <span className="small num">{inr(d.outstanding)}</span>
        </div>
      ))}
    </div>
  );
}

export function CompanyGraph() {
  const [months, setMonths] = useState(12);
  const [branch, setBranch] = useState('');
  const list = useLoad(() => api.superAdmin.graph({ months, branch }), [months, branch]);
  const d = list.data;
  const money = [{ key: 'disbursed', label: 'Loans paid out', color: '#264653', money: true }, { key: 'collected', label: 'EMI collected', color: '#2a9d8f', money: true }];
  const people = [{ key: 'members', label: 'New members', color: '#e9a23b' }, { key: 'loans', label: 'Loans paid out (number)', color: '#6a4c93' }];
  return (
    <>
      <PageHeader title="Company Graph" description="The company month by month: loans paid out against EMI collected, new members, and how the outstanding is split branch by branch." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Months"><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option><option value={24}>Last 24 months</option></select>
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        <State list={list}>{() => (
          <>
            <h3 className="section-title">Loans paid out and EMI collected</h3>
            <Legend series={money} />
            <GroupedBars data={d.series} series={money} />
            <h3 className="section-title" style={{ marginTop: 18 }}>New members and loans</h3>
            <Legend series={people} />
            <GroupedBars data={d.series} series={people} />
            <h3 className="section-title" style={{ marginTop: 18 }}>Outstanding by branch (as on today)</h3>
            <div className="small muted" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}><span><span style={{ background: '#2a9d8f', width: 12, height: 12, display: 'inline-block', borderRadius: 3 }} /> Outstanding</span><span><span style={{ background: '#e9a23b', width: 12, height: 12, display: 'inline-block', borderRadius: 3 }} /> of it overdue</span><span><span style={{ background: '#d1495b', width: 12, height: 12, display: 'inline-block', borderRadius: 3 }} /> of it NPA</span></div>
            {d.branches.length ? <HBars data={d.branches} /> : <div className="muted">No running loan.</div>}
          </>
        )}</State>
      </div>
    </>
  );
}

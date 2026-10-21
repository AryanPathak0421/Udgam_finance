import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import BankAccountSelect from '../components/BankAccountSelect.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN') : '—');
const today = () => new Date().toISOString().slice(0, 10);
const time = (s) => (s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const MODE_LABEL = { cash: 'Cash', bank: 'Bank', upi: 'UPI', cheque: 'Cheque' };

function BranchSelect({ value, onChange, all = 'All branches' }) {
  const [branches, setBranches] = useState([]);
  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  if (branches.length < 2) return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Branch">
      <option value="">{all}</option>
      {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
    </select>
  );
}
const Refresh = ({ onClick, loading }) => <button className="btn" onClick={onClick} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>;
const Summary = ({ items }) => <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '8px 0' }}>{items.map(([l, v]) => <span key={l}>{l} <strong>{v}</strong></span>)}</div>;

function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await fn()); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { data, setData, loading, error, load };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Department master and Designation master
function MasterPage({ kind }) {
  const isDes = kind === 'designation';
  const title = isDes ? 'Designation Master' : 'Department Master';
  const toast = useToast();
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => (isDes ? api.hr.designations({ q }) : api.hr.departments({ q })), [kind, q]);
  const [deps, setDeps] = useState([]);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ name: '', department: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  useEffect(() => { if (isDes) api.hr.departments({}).then((r) => setDeps(r.items.filter((d) => d.isActive))).catch(() => {}); }, [isDes]);
  const api2 = isDes ? { create: api.hr.createDesignation, update: api.hr.updateDesignation, status: api.hr.setDesignationStatus, remove: api.hr.removeDesignation } : { create: api.hr.createDepartment, update: api.hr.updateDepartment, status: api.hr.setDepartmentStatus, remove: api.hr.removeDepartment };

  const open = (x) => { setEdit(x || {}); setForm({ name: x?.name || '', department: x?.department?.id || '' }); setErrors({}); };
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      if (edit.id) await api2.update(edit.id, form); else await api2.create(form);
      toast.success('Saved');
      setEdit(null);
      list.load();
    } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  async function toggle(x) { try { await api2.status(x.id, !x.isActive); list.load(); } catch (err) { toast.error(err.message); } }
  async function remove() {
    setBusy(true);
    try { await api2.remove(removing.id); toast.success('Deleted'); setRemoving(null); list.load(); } catch (err) { toast.error(err.message); setRemoving(null); } finally { setBusy(false); }
  }
  const items = list.data?.items || [];
  return (
    <>
      <PageHeader title={title} description={isDes ? 'The designations of the employees (for example Field Officer, Branch Manager), each under a department.' : 'The departments of the company (for example Operations, Accounts, HR).'} />
      <div className="panel">
        <div className="toolbar">
          <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn primary" onClick={() => open(null)}>{isDes ? 'Add designation' : 'Add department'}</button>
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="Nothing yet" description={`Add the first ${isDes ? 'designation' : 'department'}.`} /> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Name</th>{isDes && <th>Department</th>}<th className="num">Employees</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.id}>
                    <td data-label="Name"><strong>{x.name}</strong></td>
                    {isDes && <td data-label="Department">{x.department?.name || '—'}</td>}
                    <td data-label="Employees" className="num">{x.employees}</td>
                    <td data-label="Status"><span className={`badge ${x.isActive ? 'green' : 'grey'}`}>{x.isActive ? 'Active' : 'Stopped'}</span></td>
                    <td><div style={{ display: 'flex', gap: 6 }}><button className="btn sm" onClick={() => open(x)}>Edit</button><button className="btn sm" onClick={() => toggle(x)}>{x.isActive ? 'Stop' : 'Allow'}</button><button className="btn sm danger-outline" onClick={() => setRemoving(x)}>Delete</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={Boolean(edit)} title={edit?.id ? `Edit ${isDes ? 'designation' : 'department'}` : `New ${isDes ? 'designation' : 'department'}`} onClose={() => setEdit(null)} busy={busy}
        footer={<><button className="btn" onClick={() => setEdit(null)} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
        <FormField id="mname" label="Name" required error={errors.name}><input id="mname" value={form.name} maxLength={60} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></FormField>
        {isDes && (
          <FormField id="mdep" label="Department" error={errors.department}>
            <select id="mdep" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}><option value="">None</option>{deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </FormField>
        )}
      </Modal>
      <ConfirmDialog open={Boolean(removing)} title="Delete?" tone="danger" confirmLabel="Delete" loading={busy} onCancel={() => setRemoving(null)} onConfirm={remove} message={removing ? `${removing.name} will be deleted.` : ''} />
    </>
  );
}
export const DepartmentMaster = () => <MasterPage kind="department" />;
export const DesignationMaster = () => <MasterPage kind="designation" />;

// ---------------------------------------------------------------------------------------------------------------------------
// Employee registration
function EmployeeForm({ item, onClose, onSaved }) {
  const toast = useToast();
  const [opts, setOpts] = useState({ departments: [], designations: [] });
  const [branches, setBranches] = useState([]);
  const [staff, setStaff] = useState([]);
  const [f, setF] = useState({
    user: '', name: item?.name || '', mobile: item?.mobile?.startsWith('X') ? '' : item?.mobile || '', email: item?.email || '', address: item?.address || '', department: item?.department?.id || '', designation: item?.designation?.id || '',
    branch: item?.branch?.id || '', joiningDate: item?.joiningDate || today(), monthlySalary: item ? String(item.monthlySalary || '') : '', bankName: item?.bankName || '', ifsc: item?.ifsc || '', accountNumber: item?.accountNumber?.startsWith('X') ? '' : item?.accountNumber || '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.hr.options().then(setOpts).catch(() => {});
    api.groups.branchOptions().then((r) => { setBranches(r.items); if (!item && r.items.length === 1) setF((x) => ({ ...x, branch: r.items[0].id })); }).catch(() => {});
    if (!item) api.hr.staffOptions().then((r) => setStaff(r.items)).catch(() => {});
  }, [item]);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const pickUser = (id) => {
    const u = staff.find((s) => s.id === id);
    setF((x) => ({ ...x, user: id, ...(u ? { name: u.name, mobile: /^[6-9]\d{9}$/.test(u.mobile) ? u.mobile : x.mobile } : {}) }));
  };
  const desigs = opts.designations.filter((d) => !f.department || !d.department || d.department === f.department);
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      if (item) await api.hr.updateEmployee(item.id, f); else await api.hr.createEmployee(f);
      toast.success(item ? 'Employee updated' : 'Employee registered');
      onSaved();
    } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  return (
    <Modal open title={item ? `Edit ${item.employeeCode}` : 'Register an employee'} onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-grid">
        {!item && (
          <FormField id="eluser" label="Staff login" className="span-2" error={errors.user} hint="Optional. Link the employee to an existing staff login (User Master): the employee code is taken from it, and the attendance is marked automatically from the work done in the system.">
            <select id="eluser" value={f.user} onChange={(e) => pickUser(e.target.value)}><option value="">No login (new employee code)</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.employeeCode} — {s.name} ({s.role.replace(/_/g, ' ')}{s.branches ? `, ${s.branches}` : ''})</option>)}</select>
          </FormField>
        )}
        <FormField id="enname" label="Name" required error={errors.name}><input id="enname" value={f.name} maxLength={80} onChange={set('name')} /></FormField>
        <FormField id="enmob" label="Mobile" error={errors.mobile}><input id="enmob" inputMode="numeric" value={f.mobile} onChange={(e) => { setF((x) => ({ ...x, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })); setErrors((x) => ({ ...x, mobile: undefined })); }} /></FormField>
        <FormField id="enmail" label="Email" error={errors.email}><input id="enmail" value={f.email} onChange={set('email')} /></FormField>
        <FormField id="enbranch" label="Branch" required error={errors.branch}><select id="enbranch" value={f.branch} onChange={set('branch')}><option value="">Select</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></FormField>
        <FormField id="endep" label="Department" error={errors.department}><select id="endep" value={f.department} onChange={(e) => { setF((x) => ({ ...x, department: e.target.value, designation: '' })); }}><option value="">None</option>{opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
        <FormField id="endes" label="Designation" error={errors.designation}><select id="endes" value={f.designation} onChange={set('designation')}><option value="">None</option>{desigs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
        <FormField id="enjoin" label="Joining date" error={errors.joiningDate}><input id="enjoin" type="date" value={f.joiningDate} onChange={set('joiningDate')} /></FormField>
        <FormField id="ensal" label="Monthly salary (₹)" error={errors.monthlySalary}><input id="ensal" inputMode="decimal" value={f.monthlySalary} onChange={(e) => { setF((x) => ({ ...x, monthlySalary: e.target.value.replace(/[^\d.]/g, '') })); setErrors((x) => ({ ...x, monthlySalary: undefined })); }} /></FormField>
        <FormField id="enbank" label="Bank" error={errors.bankName}><input id="enbank" value={f.bankName} maxLength={80} onChange={set('bankName')} /></FormField>
        <FormField id="enifsc" label="IFSC" error={errors.ifsc}><input id="enifsc" value={f.ifsc} maxLength={11} onChange={(e) => { setF((x) => ({ ...x, ifsc: e.target.value.toUpperCase() })); setErrors((x) => ({ ...x, ifsc: undefined })); }} /></FormField>
        <FormField id="enacc" label="Account number" error={errors.accountNumber}><input id="enacc" inputMode="numeric" value={f.accountNumber} onChange={(e) => { setF((x) => ({ ...x, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 18) })); setErrors((x) => ({ ...x, accountNumber: undefined })); }} /></FormField>
        <FormField id="enaddr" label="Address" className="span-2" error={errors.address}><input id="enaddr" value={f.address} maxLength={300} onChange={set('address')} /></FormField>
      </div>
    </Modal>
  );
}

export function EmployeeRegistration() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.hr.employees({ branch, status, q }), [branch, status, q]);
  const [form, setForm] = useState(null);
  const [syncing, setSyncing] = useState(false);
  async function sync() {
    setSyncing(true);
    try { const r = await api.hr.syncFromUsers(); toast.success(`${r.made} staff login${r.made === 1 ? '' : 's'} added as employees`); list.load(); } catch (err) { toast.error(err.message); } finally { setSyncing(false); }
  }
  async function toggle(e) {
    try { await api.hr.setEmployeeStatus(e.id, e.status === 'active' ? 'left' : 'active'); toast.success(e.status === 'active' ? 'Marked as left' : 'Back on the roll'); list.load(); } catch (err) { toast.error(err.message); }
  }
  const items = list.data?.items || [];
  return (
    <>
      <PageHeader title="Employee Registration" description="The employees of the company with their department, designation, branch, monthly salary and bank. An employee linked to a staff login gets attendance automatically." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="active">Working</option><option value="left">Left</option><option value="">All</option></select>
          <input type="search" placeholder="Search name, code, mobile" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" style={{ minWidth: 200 }} />
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn" onClick={sync} disabled={syncing} title="Makes an employee record of every staff login that has none">{syncing ? 'Adding…' : 'Add all staff logins'}</button>
          <button className="btn primary" onClick={() => setForm({})}>Register employee</button>
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="No employee" description="Register an employee, or use Add all staff logins." /> : (
          <>
            <Summary items={[['Employees', list.data.summary.employees], ['Working', list.data.summary.active], ['Monthly salary (working)', inr(list.data.summary.monthlySalary)]]} />
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Employee</th><th>Department · Designation</th><th>Branch</th><th>Joined</th><th className="num">Monthly salary</th><th>Bank</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td data-label="Employee"><strong>{e.employeeCode}</strong> {e.name}<div className="muted small">{e.mobile || '—'}{e.hasLogin ? ' · has login' : ''}</div></td>
                      <td data-label="Department">{e.department?.name || '—'}<div className="muted small">{e.designation?.name || '—'}</div></td>
                      <td data-label="Branch">{e.branch?.code || '—'}</td>
                      <td data-label="Joined">{dmy(e.joiningDate)}</td>
                      <td data-label="Monthly salary" className="num">{e.monthlySalary ? inr(e.monthlySalary) : <span className="muted">not set</span>}</td>
                      <td data-label="Bank">{e.bankName || '—'}<div className="muted small">{e.accountNumber}</div></td>
                      <td data-label="Status"><span className={`badge ${e.status === 'active' ? 'green' : 'grey'}`}>{e.status === 'active' ? 'Working' : `Left ${dmy(e.leftOn)}`}</span></td>
                      <td><div style={{ display: 'flex', gap: 6 }}><button className="btn sm" onClick={() => setForm(e)}>Edit</button><button className="btn sm" onClick={() => toggle(e)}>{e.status === 'active' ? 'Left' : 'Rejoin'}</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {form && <EmployeeForm item={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); list.load(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Attendance: automatic (from the work done in the system) and manual
const ATT = [['', 'Not marked'], ['present', 'Present'], ['half_day', 'Half day'], ['leave', 'Leave'], ['holiday', 'Holiday'], ['absent', 'Absent']];
const ATT_BADGE = { present: 'green', half_day: 'amber', leave: 'grey', holiday: 'grey', absent: 'danger' };

export function Attendance() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [date, setDate] = useState(today());
  const list = useLoad(() => api.hr.attendance({ branch, date }), [branch, date]);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState('');
  useEffect(() => { setEdits({}); }, [list.data]);
  const items = list.data?.items || [];
  const changed = Object.keys(edits).length;
  async function save() {
    setBusy('save');
    try {
      const r = await api.hr.markAttendance({ date, items: Object.entries(edits).map(([employee, v]) => ({ employee, status: v.status, remark: v.remark })) });
      toast.success(`${r.saved} saved`);
      list.load();
    } catch (err) { toast.error(err.errors?.date || err.errors?.items || err.message); } finally { setBusy(''); }
  }
  async function auto() {
    setBusy('auto');
    try { const r = await api.hr.autoAttendance({ date, branch }); toast.success(`${r.marked} employee${r.marked === 1 ? '' : 's'} marked present from their work in the system`); list.load(); } catch (err) { toast.error(err.errors?.date || err.message); } finally { setBusy(''); }
  }
  const setRow = (id, patch) => setEdits((e) => ({ ...e, [id]: { status: e[id]?.status ?? items.find((i) => i.id === id)?.status ?? '', remark: e[id]?.remark ?? items.find((i) => i.id === id)?.remark ?? '', ...patch } }));
  const s = list.data?.summary;
  return (
    <>
      <PageHeader title="Attendance" description="Present is marked automatically for employees with a staff login who worked in the system that day. Mark the others by hand; what you mark replaces the automatic mark. Sunday is the weekly off and is paid." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Date <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} aria-label="Date" /></label>
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn" onClick={auto} disabled={busy === 'auto'}>{busy === 'auto' ? 'Marking…' : 'Auto attendance'}</button>
          <button className="btn primary" onClick={save} disabled={!changed || busy === 'save'}>{busy === 'save' ? 'Saving…' : `Save${changed ? ` (${changed})` : ''}`}</button>
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="No employee" description="No employee on the roll for this date and branch." /> : (
          <>
            <Summary items={[['Employees', s.employees], ['Present', s.present], ['Half day', s.half_day], ['Leave', s.leave], ['Holiday', s.holiday], ['Absent', s.absent], ['Not marked', s.notMarked]]} />
            {list.data.sunday && <div className="notice">Sunday: the weekly off. It is paid even when nobody is marked.</div>}
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Employee</th><th>Branch</th><th>Attendance</th><th>Marked</th><th>Remark</th></tr></thead>
                <tbody>
                  {items.map((i) => {
                    const cur = edits[i.id]?.status ?? i.status;
                    return (
                      <tr key={i.id} style={edits[i.id] ? { background: 'var(--surface-2, #f6f8f8)' } : undefined}>
                        <td data-label="Employee"><strong>{i.employeeCode}</strong> {i.name}<div className="muted small">{i.designation || '—'}</div></td>
                        <td data-label="Branch">{i.branch || '—'}</td>
                        <td data-label="Attendance"><select aria-label={`Attendance of ${i.employeeCode}`} value={cur} onChange={(e) => setRow(i.id, { status: e.target.value })}>{ATT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                        <td data-label="Marked">{i.status ? <><span className={`badge ${ATT_BADGE[i.status] || 'grey'}`}>{i.source === 'auto' ? 'Auto' : 'Manual'}</span>{i.source === 'auto' && i.firstActivity && <div className="muted small">{time(i.firstActivity)} – {time(i.lastActivity)}</div>}</> : '—'}</td>
                        <td data-label="Remark"><input aria-label={`Remark of ${i.employeeCode}`} value={edits[i.id]?.remark ?? i.remark} maxLength={100} onChange={(e) => setRow(i.id, { remark: e.target.value })} style={{ minWidth: 140 }} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Salary: generate and send, pay, branch wise
const SAL_BADGE = { generated: ['Generated', 'grey'], sent: ['Sent', 'amber'], paid: ['Paid', 'green'] };
const SalBadge = ({ s }) => <span className={`badge ${SAL_BADGE[s]?.[1] || 'grey'}`}>{SAL_BADGE[s]?.[0] || s}</span>;

function SlipDialog({ slip, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ bonus: String(slip.bonus || ''), otherDeduction: String(slip.otherDeduction || ''), remark: slip.remark || '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const paid = slip.status === 'paid';
  const net = Math.max(slip.earned + (Number(f.bonus) || 0) - (Number(f.otherDeduction) || 0), 0);
  async function save() {
    setBusy(true);
    setErrors({});
    try { await api.hr.adjustSalary(slip.id, f); toast.success('Salary updated'); onSaved(); } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  const row = (l, v) => <tr><td>{l}</td><td className="num">{v}</td></tr>;
  return (
    <Modal open title={`Salary slip — ${slip.employeeCode} ${slip.name}`} onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={() => window.print()}>Print</button><button className="btn" onClick={onClose} disabled={busy}>Close</button>{!paid && <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save adjustment'}</button>}</>}>
      <p className="muted">{monthLabel(slip.month)} · {slip.branch?.code} · {slip.designation || slip.department || ''}</p>
      <div className="table-wrap">
        <table className="data-table">
          <tbody>
            {row('Days in the month', slip.daysInMonth)}{row('Present', slip.presentDays)}{row('Half days', slip.halfDays)}{row('Leave (paid)', slip.leaveDays)}{row('Holiday', slip.holidayDays)}{row('Sundays (weekly off)', slip.sundays)}
            {row('Absent', `${slip.absentDays}${slip.unmarkedDays ? ` (${slip.unmarkedDays} not marked)` : ''}`)}{row('Payable days', slip.payableDays)}
            {row('Monthly salary', inr(slip.gross))}{row('Salary for the payable days', inr(slip.earned))}
            {row('Bonus / addition', inr(Number(f.bonus) || 0))}{row('Other deduction', inr(Number(f.otherDeduction) || 0))}
            <tr style={{ borderTop: '2px solid currentColor' }}><td><strong>Net salary</strong></td><td className="num"><strong>{inr(net)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      {slip.unmarkedDays > 0 && <div className="notice" style={{ marginTop: 8 }}>{slip.unmarkedDays} day{slip.unmarkedDays === 1 ? ' was' : 's were'} not marked and counted as absent. Mark the attendance and generate the salary again to correct it.</div>}
      {!paid && (
        <div className="form-grid" style={{ marginTop: 8 }}>
          <FormField id="slbonus" label="Bonus / addition (₹)" error={errors.bonus}><input id="slbonus" inputMode="decimal" value={f.bonus} onChange={(e) => setF((x) => ({ ...x, bonus: e.target.value.replace(/[^\d.]/g, '') }))} /></FormField>
          <FormField id="sldeduct" label="Other deduction (₹)" error={errors.otherDeduction}><input id="sldeduct" inputMode="decimal" value={f.otherDeduction} onChange={(e) => setF((x) => ({ ...x, otherDeduction: e.target.value.replace(/[^\d.]/g, '') }))} /></FormField>
          <FormField id="slrem" label="Remark" className="span-2"><input id="slrem" value={f.remark} maxLength={200} onChange={(e) => setF((x) => ({ ...x, remark: e.target.value }))} /></FormField>
        </div>
      )}
      {paid && <div className="muted small" style={{ marginTop: 8 }}>Paid on {dmy(slip.paidOn)} by {MODE_LABEL[slip.payMode] || slip.payMode}.</div>}
    </Modal>
  );
}

function SalaryTable({ items, picked, setPicked, onOpen, selectable }) {
  const all = items.filter((s) => s.status !== 'paid').map((s) => s.id);
  const allOn = all.length > 0 && all.every((id) => picked.has(id));
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr>{selectable && <th><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(all))} /></th>}<th>Employee</th><th>Branch</th><th className="num">Payable days</th><th className="num">Salary</th><th className="num">Bonus</th><th className="num">Deduction</th><th className="num">Net</th><th>Status</th><th /></tr></thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              {selectable && <td><input type="checkbox" aria-label={`Select ${s.employeeCode}`} disabled={s.status === 'paid'} checked={picked.has(s.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} /></td>}
              <td data-label="Employee"><strong>{s.employeeCode}</strong> {s.name}<div className="muted small">{s.designation || s.department || ''}</div></td>
              <td data-label="Branch">{s.branch?.code || '—'}</td>
              <td data-label="Payable days" className="num">{s.payableDays}/{s.daysInMonth}{s.unmarkedDays > 0 && <div className="muted small">{s.unmarkedDays} not marked</div>}</td>
              <td data-label="Salary" className="num">{inr(s.earned)}</td><td data-label="Bonus" className="num">{s.bonus ? inr(s.bonus) : '—'}</td><td data-label="Deduction" className="num">{s.otherDeduction ? inr(s.otherDeduction) : '—'}</td>
              <td data-label="Net" className="num"><strong>{inr(s.net)}</strong></td>
              <td data-label="Status"><SalBadge s={s.status} />{s.sentAt && s.status !== 'paid' && <div className="muted small">sent {dmy(s.sentAt)}</div>}</td>
              <td><button className="btn sm" onClick={() => onOpen(s)}>Slip</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalaryGenerate() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [month, setMonth] = useState(lastMonth());
  const list = useLoad(() => api.hr.salary({ month, branch }), [month, branch]);
  const [picked, setPicked] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { setPicked(new Set()); }, [list.data]);
  async function generate() {
    setBusy('gen');
    try {
      const r = await api.hr.generateSalary({ month, branch });
      toast.success(`${r.made} generated, ${r.updated} worked out again${r.keptPaid ? `, ${r.keptPaid} already paid (left as they are)` : ''}${r.noSalary ? ` · ${r.noSalary} employee${r.noSalary === 1 ? ' has' : 's have'} no monthly salary set` : ''}`);
      list.load();
    } catch (err) { toast.error(err.errors?.month || err.message); } finally { setBusy(''); }
  }
  async function send() {
    setBusy('send');
    try {
      const r = await api.hr.sendSalary({ ids: [...picked] });
      toast.success(`${r.sent} sent${r.noMobile ? ` · ${r.noMobile} without a mobile number` : ''}${r.failed ? ` · ${r.failed} failed` : ''}`);
      list.load();
    } catch (err) { toast.error(err.message); } finally { setBusy(''); }
  }
  const items = list.data?.items || [];
  const s = list.data?.summary;
  return (
    <>
      <PageHeader title="Employee Salary Generate & Send" description="The salary of a month is worked out from the attendance (absent days and half days are cut, Sunday is paid) and sent to the employee as a salary slip by SMS. Add a bonus or a deduction on the slip." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Month <input type="month" value={month} max={lastMonth()} onChange={(e) => setMonth(e.target.value || lastMonth())} aria-label="Month" /></label>
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn primary" onClick={generate} disabled={busy === 'gen'}>{busy === 'gen' ? 'Generating…' : 'Generate salary'}</button>
          <button className="btn" onClick={send} disabled={!picked.size || busy === 'send'}>{busy === 'send' ? 'Sending…' : `Send salary slip${picked.size ? ` (${picked.size})` : ''}`}</button>
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="No salary generated" description={`Generate the salary of ${monthLabel(month)}.`} /> : (
          <>
            <Summary items={[['Slips', s.slips], ['Net salary', inr(s.net)], ['Paid', inr(s.paid)], ['To pay', inr(s.due)]]} />
            <SalaryTable items={items} picked={picked} setPicked={setPicked} onOpen={setOpen} selectable />
          </>
        )}
      </div>
      {open && <SlipDialog slip={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.load(); }} />}
    </>
  );
}

export function SalaryPayment() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [month, setMonth] = useState(lastMonth());
  const [status, setStatus] = useState('unpaid');
  const list = useLoad(() => api.hr.salary({ month, branch, status }), [month, branch, status]);
  const [picked, setPicked] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [payMode, setPayMode] = useState('cash');
  const [bankAccount, setBankAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => { setPicked(new Set()); }, [list.data]);
  const items = list.data?.items || [];
  const chosen = useMemo(() => items.filter((i) => picked.has(i.id)), [items, picked]);
  const total = chosen.reduce((t, i) => t + i.net, 0);
  async function pay() {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.hr.paySalary({ ids: [...picked], payMode, bankAccount: payMode === 'bank' ? bankAccount : undefined });
      toast.success(`${r.paid} salar${r.paid === 1 ? 'y' : 'ies'} paid (${inr(r.amount)}). They are in the Cashbook as Staff salary paid.`);
      if (r.failed.length) toast.error(`${r.failed.length} not paid: ${r.failed[0].message}`);
      list.load();
    } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  const s = list.data?.summary;
  return (
    <>
      <PageHeader title="Salary Payment" description="Pay the generated salaries, branch wise. Every payment is an entry of the branch Cashbook (Staff salary paid), by cash or bank." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Month <input type="month" value={month} max={lastMonth()} onChange={(e) => setMonth(e.target.value || lastMonth())} aria-label="Month" /></label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="unpaid">To pay</option><option value="paid">Paid</option><option value="">All</option></select>
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="Nothing to show" description="Generate the salary of the month first (Employee Salary Generate & Send)." /> : (
          <>
            <Summary items={[['Slips', s.slips], ['Net salary', inr(s.net)], ['Paid', inr(s.paid)], ['To pay', inr(s.due)]]} />
            <SalaryTable items={items} picked={picked} setPicked={setPicked} onOpen={setOpen} selectable />
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
              <FormField id="spmode" label="Pay by" error={errors.payMode}><select id="spmode" value={payMode} onChange={(e) => setPayMode(e.target.value)}>{Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
              <BankAccountSelect id="spbank" mode={payMode} value={bankAccount} onChange={setBankAccount} error={errors.bankAccount} />
              <button className="btn primary" onClick={pay} disabled={!picked.size || busy}>{busy ? 'Paying…' : `Pay ${picked.size ? `${picked.size} · ${inr(total)}` : 'selected'}`}</button>
            </div>
          </>
        )}
      </div>
      {open && <SlipDialog slip={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.load(); }} />}
    </>
  );
}

export function BranchSalary() {
  const [month, setMonth] = useState(lastMonth());
  const [branch, setBranch] = useState('');
  const list = useLoad(() => api.hr.branchSalary({ month, branch }), [month, branch]);
  const d = list.data;
  return (
    <>
      <PageHeader title="Branch wise Salary" description="The salary of a month for every branch: employees, salary earned, bonus and deduction, net, paid and still to pay." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Month <input type="month" value={month} max={lastMonth()} onChange={(e) => setMonth(e.target.value || lastMonth())} aria-label="Month" /></label>
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        {list.loading && !d ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : !d || d.rows.length === 0 ? <EmptyState title="No salary" description={`No salary is generated for ${monthLabel(month)}.`} /> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Branch</th><th className="num">Employees</th><th className="num">Monthly salary</th><th className="num">Earned</th><th className="num">Bonus</th><th className="num">Deduction</th><th className="num">Net</th><th className="num">Paid</th><th className="num">To pay</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={String(r.branchId)}>
                    <td data-label="Branch"><strong>{r.branch}</strong>{r.notGenerated > 0 && <div className="muted small">{r.notGenerated} employee{r.notGenerated === 1 ? '' : 's'} without salary</div>}</td>
                    <td data-label="Employees" className="num">{r.employees}</td><td data-label="Monthly salary" className="num">{inr(r.gross)}</td><td data-label="Earned" className="num">{inr(r.earned)}</td>
                    <td data-label="Bonus" className="num">{inr(r.bonus)}</td><td data-label="Deduction" className="num">{inr(r.deduction)}</td><td data-label="Net" className="num"><strong>{inr(r.net)}</strong></td>
                    <td data-label="Paid" className="num">{inr(r.paid)}<div className="muted small">{r.paidCount}/{r.employees}</div></td><td data-label="To pay" className="num">{r.due > 0 ? <span className="badge danger">{inr(r.due)}</span> : inr(0)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid currentColor' }}>
                  <td><strong>Total</strong></td><td className="num"><strong>{d.totals.employees}</strong></td><td className="num"><strong>{inr(d.totals.gross)}</strong></td><td className="num"><strong>{inr(d.totals.earned)}</strong></td>
                  <td className="num"><strong>{inr(d.totals.bonus)}</strong></td><td className="num"><strong>{inr(d.totals.deduction)}</strong></td><td className="num"><strong>{inr(d.totals.net)}</strong></td><td className="num"><strong>{inr(d.totals.paid)}</strong></td><td className="num"><strong>{inr(d.totals.due)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export { BranchSelect, Refresh, Summary, useLoad, inr, dmy, today, MODE_LABEL, monthLabel };

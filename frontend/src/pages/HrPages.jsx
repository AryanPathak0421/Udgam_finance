import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { staffLabel, branchLabel } from '../utils/staffLabel.js';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import BankAccountSelect from '../components/BankAccountSelect.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { PhotoField } from './NewBorrower.jsx';

const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN') : '—');
const today = () => new Date().toISOString().slice(0, 10);
const time = (s) => (s ? new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const MODE_LABEL = { cash: 'Cash', bank: 'Bank', upi: 'UPI', cheque: 'Cheque' };

function BranchSelect({ value, onChange, all = 'All branches' }) {
  const [branches, setBranches] = useState([]);
  useEffect(() => { api.hr.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
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
const MARITAL = [['single', 'Single'], ['married', 'Married'], ['divorced', 'Divorced'], ['widowed', 'Widowed']];
const YesNo = ({ id, label, value, onChange, error, hint, className }) => (
  <FormField id={id} label={label} error={error} hint={hint} className={className}>
    <select id={id} value={value ? 'yes' : 'no'} onChange={(e) => onChange(e.target.value === 'yes')}><option value="no">No</option><option value="yes">Yes</option></select>
  </FormField>
);

function EmployeeForm({ item, onClose, onSaved }) {
  const toast = useToast();
  const [opts, setOpts] = useState({ departments: [], designations: [] });
  const [branches, setBranches] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(Boolean(item));
  const [f, setF] = useState({
    user: '', name: item?.name || '', mobile: item?.mobile?.startsWith('X') ? '' : item?.mobile || '', email: item?.email || '', address: item?.address || '', department: item?.department?.id || '', designation: item?.designation?.id || '',
    branch: item?.branch?.id || '', supervisedBranches: (item?.supervisedBranches || []).map((b) => b.id), joiningDate: item?.joiningDate || today(), monthlySalary: item ? String(item.monthlySalary || '') : '', bankName: item?.bankName || '', ifsc: item?.ifsc || '', accountNumber: item?.accountNumber?.startsWith('X') ? '' : item?.accountNumber || '',
    photo: '', homeTown: '', originalMarksheet: false, supervisor: item?.supervisor?.id || '', pfDeduction: false, esiDeduction: false, pfNumber: item?.pfNumber || '', uanNumber: item?.uanNumber || '', esiNumber: item?.esiNumber || '',
    aadhaarNo: '', aadhaarCopy: '', panNo: '', panCopy: '', drivingLicenceNo: '', drivingLicenceCopy: '', voterIdNo: '', voterIdCopy: '',
    pincode: '', state: '', district: '', area: '', fatherName: '', fatherMobile: '', motherName: '', maritalStatus: '',
    hasExperience: false, previousCompany: '', previousPost: '', relievingLetter: '', salarySlipCopy: '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [areas, setAreas] = useState([]);
  const [pinNote, setPinNote] = useState('');
  const [supDept, setSupDept] = useState('');
  const [supDes, setSupDes] = useState('');
  const [supList, setSupList] = useState(item?.supervisor ? [{ id: item.supervisor.id, employeeCode: item.supervisor.code, name: item.supervisor.name }] : []);
  useEffect(() => {
    api.hr.options().then(setOpts).catch(() => {});
    api.groups.branchOptions().then((r) => { setBranches(r.items); if (!item && r.items.length === 1) setF((x) => ({ ...x, branch: r.items[0].id })); }).catch(() => {});
    if (!item) api.hr.staffOptions().then((r) => setStaff(r.items)).catch(() => {});
    if (item) {
      // the rest of the details and the copies are not part of the list
      api.hr.employee(item.id).then((r) => {
        const e = r.item;
        setF((x) => ({
          ...x, ...Object.fromEntries(['photo', 'homeTown', 'originalMarksheet', 'pfDeduction', 'esiDeduction', 'pfNumber', 'uanNumber', 'esiNumber', 'aadhaarNo', 'aadhaarCopy', 'panNo', 'panCopy', 'drivingLicenceNo', 'drivingLicenceCopy', 'voterIdNo', 'voterIdCopy', 'pincode', 'state', 'district', 'area', 'fatherName', 'fatherMobile', 'motherName', 'maritalStatus', 'hasExperience', 'previousCompany', 'previousPost', 'relievingLetter', 'salarySlipCopy'].map((k) => [k, e[k] ?? x[k]])),
          fatherMobile: e.fatherMobile?.startsWith('X') ? '' : e.fatherMobile || '',
        }));
        setLoadingDetail(false);
      }).catch(() => setLoadingDetail(false));
    }
  }, [item]);
  // the supervisors to choose from: the employees of the chosen department and designation
  useEffect(() => {
    if (!supDept && !supDes) return;
    api.hr.employees({ department: supDept, designation: supDes, status: 'active' }).then((r) => setSupList(r.items.filter((x) => x.id !== item?.id))).catch(() => {});
  }, [supDept, supDes, item]);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const setV = (k) => (v) => { setF((x) => ({ ...x, [k]: v })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const digits = (k, n) => (e) => setV(k)(e.target.value.replace(/\D/g, '').slice(0, n));
  const pickUser = (id) => {
    const u = staff.find((s) => s.id === id);
    setF((x) => ({ ...x, user: id, ...(u ? { name: u.name, mobile: /^[6-9]\d{9}$/.test(u.mobile) ? u.mobile : x.mobile } : {}) }));
  };
  const desigs = opts.designations.filter((d) => !f.department || !d.department || d.department === f.department);
  const supDesigs = opts.designations.filter((d) => !supDept || !d.department || d.department === supDept);
  const chosenSup = supList.find((x) => x.id === f.supervisor);
  async function fetchPin(pin) {
    setPinNote('');
    if (pin.length !== 6) return;
    try {
      const r = await api.hr.employeePincode(pin);
      if (r.status === 'ok') { setF((x) => ({ ...x, state: r.state || '', district: r.district || r.postalDistrict || '', area: x.area || (r.areas?.[0] || '').trim() })); setAreas((r.areas || []).map((a) => a.trim())); } else setPinNote(r.status === 'invalid' ? 'This pincode was not found' : 'The location could not be fetched now, enter it by hand');
    } catch (err) { setPinNote(err.message); }
  }
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      if (item) await api.hr.updateEmployee(item.id, f); else await api.hr.createEmployee(f);
      toast.success(item ? 'Employee updated' : 'Employee registered');
      onSaved();
    } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  const Sec = ({ children }) => <h4 className="span-2" style={{ margin: '10px 0 0', paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>{children}</h4>;
  return (
    <Modal open title={item ? `Edit ${item.employeeCode}` : 'Register an employee'} onClose={onClose} busy={busy} size="lg"
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy || loadingDetail}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-grid">
        {!item && (
          <FormField id="eluser" label="Staff login" className="span-2" error={errors.user} hint="Optional. Link the employee to an existing staff login (User Master): the employee code is taken from it, and the attendance is marked automatically from the work done in the system. Without a login the employee code is made automatically.">
            <select id="eluser" value={f.user} onChange={(e) => pickUser(e.target.value)}><option value="">No login (new employee code)</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.employeeCode} — {s.name} ({s.role.replace(/_/g, ' ')}{s.branches ? `, ${s.branches}` : ''})</option>)}</select>
          </FormField>
        )}
        {item && <FormField id="encode" label="Employee code"><input id="encode" value={item.employeeCode} readOnly /></FormField>}
        <FormField id="enname" label="Name" required error={errors.name}><input id="enname" value={f.name} maxLength={80} onChange={set('name')} /></FormField>
        <FormField id="enmail" label="Email" error={errors.email}><input id="enmail" value={f.email} onChange={set('email')} /></FormField>
        <FormField id="enbranch" label="Branch" required error={errors.branch}><select id="enbranch" value={f.branch} onChange={set('branch')}><option value="">Select</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></FormField>
        <FormField id="enmob" label="Phone no." error={errors.mobile}><input id="enmob" inputMode="numeric" value={f.mobile} onChange={digits('mobile', 10)} /></FormField>
        <FormField id="endep" label="Department" error={errors.department}><select id="endep" value={f.department} onChange={(e) => { setF((x) => ({ ...x, department: e.target.value, designation: '' })); }}><option value="">None</option>{opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
        <FormField id="endes" label="Designation" error={errors.designation}><select id="endes" value={f.designation} onChange={set('designation')}><option value="">None</option>{desigs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
        <FormField id="enjoin" label="Date of joining" error={errors.joiningDate}><input id="enjoin" type="date" value={f.joiningDate} onChange={set('joiningDate')} /></FormField>
        <FormField id="ensal" label="Monthly salary (₹)" error={errors.monthlySalary}><input id="ensal" inputMode="decimal" value={f.monthlySalary} onChange={(e) => setV('monthlySalary')(e.target.value.replace(/[^\d.]/g, ''))} /></FormField>
        <PhotoField id="enphoto" label="Photo" value={f.photo} error={errors.photo} onChange={setV('photo')} />
        <FormField id="enhome" label="Home town" error={errors.homeTown}><input id="enhome" value={f.homeTown} maxLength={80} onChange={set('homeTown')} /></FormField>
        <YesNo id="enmark" label="Original marksheet" value={f.originalMarksheet} onChange={setV('originalMarksheet')} hint="Yes when the original marksheet is kept with the company" />

        <Sec>Supervisor</Sec>
        <FormField id="ensdep" label="Supervisor's department"><select id="ensdep" value={supDept} onChange={(e) => { setSupDept(e.target.value); setSupDes(''); }}><option value="">Select department</option>{opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
        <FormField id="ensdes" label="Supervisor's designation"><select id="ensdes" value={supDes} onChange={(e) => setSupDes(e.target.value)}><option value="">Select designation</option>{supDesigs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
        <FormField id="ensup" label="Supervisor name" className="span-2" error={errors.supervisor} hint="Choose the department and designation first; the employees of it are listed. This employee's details then show with the supervisor (Team in the list).">
          <select id="ensup" value={f.supervisor} onChange={set('supervisor')}><option value="">No supervisor</option>{supList.map((x) => <option key={x.id} value={x.id}>{staffLabel(x)}{x.designation?.name ? ` · ${x.designation.name}` : ''}</option>)}</select>
        </FormField>
        <div className="span-2">
          <strong>Branches under this employee</strong> <span className="muted small">— tick the branches when the employee is a supervisor</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 6 }}>
            {branches.map((b) => <label key={b.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.supervisedBranches.includes(b.id)} onChange={(e) => setF((x) => ({ ...x, supervisedBranches: e.target.checked ? [...x.supervisedBranches, b.id] : x.supervisedBranches.filter((i) => i !== b.id) }))} /> {b.code} — {b.name}</label>)}
          </div>
          {errors.supervisedBranches && <div className="field-error small">{errors.supervisedBranches}</div>}
        </div>
        {chosenSup && chosenSup.branch && <p className="muted small span-2" style={{ margin: 0 }}>Supervisor: {chosenSup.name} · {chosenSup.department?.name || '—'} · {chosenSup.designation?.name || '—'} · {chosenSup.branch?.code || '—'}</p>}

        <Sec>Deductions</Sec>
        <YesNo id="enpf" label="PF deduction" value={f.pfDeduction} onChange={setV('pfDeduction')} />
        <YesNo id="enesi" label="ESI deduction" value={f.esiDeduction} onChange={setV('esiDeduction')} />
        <FormField id="enpfn" label="PF number" hint="Optional" error={errors.pfNumber}><input id="enpfn" value={f.pfNumber} maxLength={30} onChange={(e) => setV('pfNumber')(e.target.value.toUpperCase())} /></FormField>
        <FormField id="enuan" label="UAN number" hint="Optional, 12 digits" error={errors.uanNumber}><input id="enuan" inputMode="numeric" value={f.uanNumber} onChange={digits('uanNumber', 12)} /></FormField>
        <FormField id="enesin" label="ESI number" hint="Optional, 10 or 17 digits" error={errors.esiNumber}><input id="enesin" inputMode="numeric" value={f.esiNumber} onChange={digits('esiNumber', 17)} /></FormField>

        <Sec>Verification (all optional)</Sec>
        <FormField id="enaad" label="Aadhaar number" error={errors.aadhaarNo}><input id="enaad" inputMode="numeric" value={f.aadhaarNo} onChange={digits('aadhaarNo', 12)} /></FormField>
        <PhotoField id="enaadc" label="Aadhaar copy" value={f.aadhaarCopy} error={errors.aadhaarCopy} onChange={setV('aadhaarCopy')} />
        <FormField id="enpan" label="PAN" error={errors.panNo}><input id="enpan" value={f.panNo} maxLength={10} onChange={(e) => setV('panNo')(e.target.value.toUpperCase())} /></FormField>
        <PhotoField id="enpanc" label="PAN copy" value={f.panCopy} error={errors.panCopy} onChange={setV('panCopy')} />
        <FormField id="endl" label="Driving licence no." error={errors.drivingLicenceNo}><input id="endl" value={f.drivingLicenceNo} maxLength={20} onChange={(e) => setV('drivingLicenceNo')(e.target.value.toUpperCase())} /></FormField>
        <PhotoField id="endlc" label="Driving licence copy" value={f.drivingLicenceCopy} error={errors.drivingLicenceCopy} onChange={setV('drivingLicenceCopy')} />
        <FormField id="envoter" label="Voter ID no." error={errors.voterIdNo}><input id="envoter" value={f.voterIdNo} maxLength={20} onChange={(e) => setV('voterIdNo')(e.target.value.toUpperCase())} /></FormField>
        <PhotoField id="envoterc" label="Voter ID copy" value={f.voterIdCopy} error={errors.voterIdCopy} onChange={setV('voterIdCopy')} />

        <Sec>Address</Sec>
        <FormField id="enpin" label="Pincode" error={errors.pincode} hint={pinNote || 'The state, district and area are fetched from the pincode'}><input id="enpin" inputMode="numeric" value={f.pincode} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setV('pincode')(v); fetchPin(v); }} /></FormField>
        <FormField id="enstate" label="State"><input id="enstate" value={f.state} onChange={set('state')} /></FormField>
        <FormField id="endist" label="District"><input id="endist" value={f.district} onChange={set('district')} /></FormField>
        <FormField id="enarea" label="Area">{areas.length ? <select id="enarea" value={f.area} onChange={set('area')}>{areas.map((a) => <option key={a} value={a}>{a}</option>)}</select> : <input id="enarea" value={f.area} onChange={set('area')} />}</FormField>
        <FormField id="enaddr" label="Address" className="span-2" error={errors.address}><input id="enaddr" value={f.address} maxLength={300} onChange={set('address')} /></FormField>

        <Sec>Bank</Sec>
        <FormField id="enacc" label="Account number" error={errors.accountNumber}><input id="enacc" inputMode="numeric" value={f.accountNumber} onChange={digits('accountNumber', 18)} /></FormField>
        <FormField id="enbank" label="Bank name" error={errors.bankName}><input id="enbank" value={f.bankName} maxLength={80} onChange={set('bankName')} /></FormField>
        <FormField id="enifsc" label="IFSC" error={errors.ifsc}><input id="enifsc" value={f.ifsc} maxLength={11} onChange={(e) => setV('ifsc')(e.target.value.toUpperCase())} /></FormField>

        <Sec>Family</Sec>
        <FormField id="enfather" label="Father's name" error={errors.fatherName}><input id="enfather" value={f.fatherName} maxLength={80} onChange={set('fatherName')} /></FormField>
        <FormField id="enfmob" label="Father's number" error={errors.fatherMobile}><input id="enfmob" inputMode="numeric" value={f.fatherMobile} onChange={digits('fatherMobile', 10)} /></FormField>
        <FormField id="enmother" label="Mother's name" error={errors.motherName}><input id="enmother" value={f.motherName} maxLength={80} onChange={set('motherName')} /></FormField>
        <FormField id="enmar" label="Marital status" error={errors.maritalStatus}><select id="enmar" value={f.maritalStatus} onChange={set('maritalStatus')}><option value="">Select</option>{MARITAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></FormField>

        <Sec>Experience</Sec>
        <label className="span-2" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.hasExperience} onChange={(e) => setV('hasExperience')(e.target.checked)} /> Has experience (opens the previous company details)</label>
        {f.hasExperience && (
          <>
            <FormField id="enprev" label="Previous company name" error={errors.previousCompany}><input id="enprev" value={f.previousCompany} maxLength={100} onChange={set('previousCompany')} /></FormField>
            <FormField id="enpost" label="Post" error={errors.previousPost}><input id="enpost" value={f.previousPost} maxLength={80} onChange={set('previousPost')} /></FormField>
            <PhotoField id="enrelieve" label="Relieving letter" value={f.relievingLetter} error={errors.relievingLetter} onChange={setV('relievingLetter')} />
            <PhotoField id="enslip" label="Salary slip" value={f.salarySlipCopy} error={errors.salarySlipCopy} onChange={setV('salarySlipCopy')} />
          </>
        )}
      </div>
    </Modal>
  );
}

function TeamModal({ supervisor, onClose }) {
  const list = useLoad(() => api.hr.employees({ supervisor: supervisor.id, status: '' }), [supervisor.id]);
  const items = list.data?.items || [];
  return (
    <Modal open title={`Team of ${supervisor.employeeCode} ${supervisor.name}`} onClose={onClose} size="xl" footer={<button className="btn" onClick={onClose}>Close</button>}>
      {list.loading && !list.data ? <Spinner label="Loading…" /> : items.length === 0 ? <EmptyState title="No one reports to this supervisor" /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Department · Designation</th><th>Branch</th><th>Joined</th><th>Home town</th><th>Father</th><th>Marital</th><th>PF</th><th>ESI</th><th>Salary</th><th>Bank</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td data-label="Employee"><strong>{e.employeeCode}</strong> {e.name}<div className="muted small">{e.mobile || '—'}{e.email ? ` · ${e.email}` : ''}</div></td>
                  <td data-label="Department">{e.department?.name || '—'}<div className="muted small">{e.designation?.name || '—'}</div></td>
                  <td data-label="Branch">{branchLabel(e.branch)}</td><td data-label="Joined">{dmy(e.joiningDate)}</td><td data-label="Home town">{e.homeTown || '—'}<div className="muted small">{[e.area, e.district, e.state].filter(Boolean).join(', ')}</div></td>
                  <td data-label="Father">{e.fatherName || '—'}<div className="muted small">{e.fatherMobile}</div></td><td data-label="Marital">{e.maritalStatus ? e.maritalStatus[0].toUpperCase() + e.maritalStatus.slice(1) : '—'}</td>
                  <td data-label="PF">{e.pfDeduction ? 'Yes' : 'No'}</td><td data-label="ESI">{e.esiDeduction ? 'Yes' : 'No'}</td><td data-label="Salary" className="num">{e.monthlySalary ? inr(e.monthlySalary) : '—'}</td>
                  <td data-label="Bank">{e.bankName || '—'}<div className="muted small">{e.accountNumber}</div></td><td data-label="Status">{e.status === 'active' ? 'Working' : 'Left'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// One channel (mobile or email) of one employee: send the OTP, type it, verified.
function OtpCell({ emp, channel, onDone }) {
  const toast = useToast();
  const [step, setStep] = useState(null); // { challengeId, devOtp }
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const verified = channel === 'mobile' ? emp.mobileVerified : emp.emailVerified;
  const value = channel === 'mobile' ? emp.mobile : emp.email;
  if (!value) return <span className="muted small">None</span>;
  if (verified) return <span className="badge green">Verified</span>;
  async function send() {
    setBusy(true);
    try { const r = await api.hr.sendEmployeeOtp(emp.id, { channel }); setStep(r); setOtp(''); toast.success(`OTP sent to ${r.sentTo}`); } catch (err) { toast.error(err.errors?.channel || err.message); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true);
    try { await api.hr.verifyEmployeeOtp(emp.id, { channel, challengeId: step.challengeId, otp }); toast.success(channel === 'mobile' ? 'Mobile verified' : 'Email verified'); setStep(null); onDone(); } catch (err) { toast.error(err.errors?.otp || err.message); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="muted small">{value}</div>
      {!step ? <button className="btn sm" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send OTP'}</button> : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <input aria-label={`OTP for ${emp.employeeCode} ${channel}`} inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ width: 90 }} placeholder="OTP" />
          <button className="btn sm primary" onClick={verify} disabled={busy || otp.length !== 6}>Verify</button>
          <button className="btn sm" onClick={send} disabled={busy}>Resend</button>
          {step.devOtp && <span className="muted small">dev OTP {step.devOtp}</span>}
        </div>
      )}
    </div>
  );
}

function PendingVerification({ onClose }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [all, setAll] = useState(false);
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.hr.pendingVerification({ q, all: all ? 1 : '' }), [q, all]);
  const items = list.data?.items || [];
  const s = list.data?.summary;
  async function docs(e, verified) {
    try { await api.hr.verifyDocuments(e.id, { verified }); toast.success(verified ? 'Documents verified' : 'Verification taken back'); list.load(); } catch (err) { toast.error(err.errors?.documents || err.message); }
  }
  return (
    <Modal open title="Pending verification" onClose={onClose} size="xl" footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p className="muted small" style={{ marginTop: 0 }}>The mobile number and the email are verified by an OTP, the documents (photo and Aadhaar copy) by hand. Once all are done the security amount is cut from the salary, in 1 to 5 months as set in Set Salary.</p>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <input type="search" placeholder="Search name, code, mobile, email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" style={{ minWidth: 220 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show verified too</label>
        <Refresh onClick={list.load} loading={list.loading} />
      </div>
      {s && <Summary items={[['Pending', s.pending], ['Mobile OTP pending', s.mobile], ['Email OTP pending', s.email], ['Documents pending', s.documents]]} />}
      {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="Nothing pending" description="The verification of every employee is complete." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Employee</th><th>Branch</th><th>Mobile OTP</th><th>Email OTP</th><th>Documents</th><th className="num">Security</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td data-label="Employee"><strong>{e.employeeCode}</strong> {e.name}</td>
                  <td data-label="Branch">{branchLabel({ code: e.branch, name: e.branchName })}</td>
                  <td data-label="Mobile OTP"><OtpCell emp={e} channel="mobile" onDone={list.load} /></td>
                  <td data-label="Email OTP"><OtpCell emp={e} channel="email" onDone={list.load} /></td>
                  <td data-label="Documents">
                    {e.documentsVerified ? <><span className="badge green">Verified</span> <button className="btn sm" onClick={() => docs(e, false)}>Undo</button></> : (
                      <>
                        <div className="muted small">{['photo', 'aadhaar', 'pan'].map((k) => `${k === 'aadhaar' ? 'Aadhaar' : k === 'pan' ? 'PAN' : 'Photo'} ${e.has[k] ? '✓' : '✗'}`).join(' · ')}</div>
                        <button className="btn sm" onClick={() => docs(e, true)} disabled={!e.has.photo || !e.has.aadhaar} title={!e.has.photo || !e.has.aadhaar ? 'Upload the photo and the Aadhaar copy first (Edit)' : ''}>Mark verified</button>
                      </>
                    )}
                  </td>
                  <td data-label="Security" className="num">{e.securityAmount ? <>{inr(e.securityAmount)}<div className="muted small">in {e.securityMonths} month{e.securityMonths === 1 ? '' : 's'}</div></> : <span className="muted">not set</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// Moves the employees of supervisor 1 to supervisor 2 (all, or the ones ticked); their leaves that wait for approval go to supervisor 2 too.
function SupervisorTransfer({ onClose, onDone }) {
  const toast = useToast();
  const everyone = useLoad(() => api.hr.employees({ status: 'active' }), []);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [team, setTeam] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const all = everyone.data?.items || [];
  const supervisors = all.filter((e) => e.teamCount > 0);
  useEffect(() => {
    setTeam([]); setPicked(new Set());
    if (!from) return;
    api.hr.employees({ supervisor: from, status: 'active' }).then((r) => { setTeam(r.items); setPicked(new Set(r.items.map((x) => x.id))); }).catch(() => {});
  }, [from]);
  async function go() {
    setBusy(true); setErrors({});
    try {
      const r = await api.hr.supervisorTransfer({ from, to, employees: picked.size === team.length ? [] : [...picked] });
      toast.success(`${r.moved} employee${r.moved === 1 ? '' : 's'} moved to the new supervisor${r.leavesMoved ? ` · ${r.leavesMoved} waiting leave${r.leavesMoved === 1 ? '' : 's'} moved too` : ''}`);
      onDone();
    } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  return (
    <Modal open title="Transfer employees to another supervisor" onClose={onClose} busy={busy} size="lg"
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Close</button><button className="btn primary" onClick={go} disabled={busy || !from || !to || picked.size === 0}>{busy ? 'Moving…' : `Transfer ${picked.size || ''}`.trim()}</button></>}>
      <div className="form-grid">
        <FormField id="stfrom" label="Supervisor 1 (from)" required error={errors.from}><select id="stfrom" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Select</option>{supervisors.map((e) => <option key={e.id} value={e.id}>{staffLabel(e)} · team {e.teamCount}</option>)}</select></FormField>
        <FormField id="stto" label="Supervisor 2 (to)" required error={errors.to}><select id="stto" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select</option>{all.filter((e) => e.id !== from).map((e) => <option key={e.id} value={e.id}>{staffLabel(e)}</option>)}</select></FormField>
      </div>
      {from && (
        <>
          <div className="toolbar"><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={team.length > 0 && picked.size === team.length} onChange={(e) => setPicked(e.target.checked ? new Set(team.map((x) => x.id)) : new Set())} /> All of the team ({team.length})</label></div>
          {errors.employees && <div className="field-error small">{errors.employees}</div>}
          <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="data-table"><tbody>
              {team.map((x) => <tr key={x.id}><td><input type="checkbox" aria-label={`Move ${x.employeeCode}`} checked={picked.has(x.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} /></td><td><strong>{x.employeeCode}</strong> {x.name}</td><td>{x.branch?.code || '—'}</td><td>{x.designation?.name || '—'}</td></tr>)}
            </tbody></table>
          </div>
        </>
      )}
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
  const [team, setTeam] = useState(null);
  const [pending, setPending] = useState(false);
  const [transferring, setTransferring] = useState(false);
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
          <button className="btn" onClick={() => setPending(true)}>Pending verification</button>
          <button className="btn" onClick={() => setTransferring(true)}>Transfer supervisor</button>
          <button className="btn primary" onClick={() => setForm({})}>Register employee</button>
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="No employee" description="Register an employee, or use Add all staff logins." /> : (
          <>
            <Summary items={[['Employees', list.data.summary.employees], ['Working', list.data.summary.active], ['Monthly salary (working)', inr(list.data.summary.monthlySalary)]]} />
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Employee</th><th>Department · Designation</th><th>Branch</th><th>Supervisor</th><th>Joined</th><th className="num">Monthly salary</th><th>Bank</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td data-label="Employee"><strong>{e.employeeCode}</strong> {e.name}<div className="muted small">{e.mobile || '—'}{e.hasLogin ? ' · has login' : ''}</div>{e.supervisedBranches?.length > 0 && <div className="muted small">Supervises: {e.supervisedBranches.map((b) => b.code).join(', ')}</div>}</td>
                      <td data-label="Department">{e.department?.name || '—'}<div className="muted small">{e.designation?.name || '—'}</div></td>
                      <td data-label="Branch">{branchLabel(e.branch)}</td>
                      <td data-label="Supervisor">{e.supervisor ? `${e.supervisor.code} ${e.supervisor.name}` : '—'}</td>
                      <td data-label="Joined">{dmy(e.joiningDate)}</td>
                      <td data-label="Monthly salary" className="num">{e.monthlySalary ? inr(e.monthlySalary) : <span className="muted">not set</span>}</td>
                      <td data-label="Bank">{e.bankName || '—'}<div className="muted small">{e.accountNumber}</div></td>
                      <td data-label="Status"><span className={`badge ${e.status === 'active' ? 'green' : 'grey'}`}>{e.status === 'active' ? 'Working' : `Left ${dmy(e.leftOn)}`}</span></td>
                      <td><div style={{ display: 'flex', gap: 6 }}><button className="btn sm" onClick={() => setForm(e)}>Edit</button>{e.teamCount > 0 && <button className="btn sm" onClick={() => setTeam(e)}>Team ({e.teamCount})</button>}<button className="btn sm" onClick={() => toggle(e)}>{e.status === 'active' ? 'Left' : 'Rejoin'}</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {team && <TeamModal supervisor={team} onClose={() => setTeam(null)} />}
      {transferring && <SupervisorTransfer onClose={() => setTransferring(false)} onDone={() => { setTransferring(false); list.load(); }} />}
      {pending && <PendingVerification onClose={() => { setPending(false); list.load(); }} />}
      {form && <EmployeeForm item={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); list.load(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Set Salary: the fixed components, PF / ESI, professional tax, advance and security of one employee (saved as you type)
const SETUP_EARN = [['basic', 'Basic'], ['hra', 'HRA'], ['ta', 'TA'], ['allowance', 'Allowance'], ['da', 'DA'], ['fuel', 'Fuel'], ['transport', 'Transport allowance'], ['bike', 'Bike repair'], ['otherAllowance', 'Other allowance']];
const moneyField = (v) => v.replace(/[^\d.]/g, '');
const num = (v) => Number(v) || 0;

export function SetSalary() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.hr.employees({ q, status: 'active' }), [q]);
  const [picked, setPicked] = useState(null);
  const [f, setF] = useState(null);
  const [errors, setErrors] = useState({});
  const [state, setState] = useState(''); // '', saving, saved
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth); // the month the salary is set for: this month or an earlier one, it holds from that month on
  const first = useRef(true);
  const items = list.data?.items || [];
  // the set-up that holds in a month: the latest one made for that month or before it, else the current one
  const setupOf = (e, m) => [...(e.salaryHistory || [])].filter((h) => h.month <= m).pop() || e.salarySetup;
  function choose(e, m = month) {
    first.current = true;
    setPicked(e);
    setErrors({});
    setState('');
    const st = setupOf(e, m);
    setF({ ...Object.fromEntries(SETUP_EARN.map(([k]) => [k, st[k] ? String(st[k]) : ''])), pfPercent: String(st.pfPercent), esiPercent: String(st.esiPercent), professionalTax: st.professionalTax ? String(st.professionalTax) : '', advanceDeduction: st.advanceDeduction ? String(st.advanceDeduction) : '', securityAmount: st.securityAmount ? String(st.securityAmount) : '', securityMonths: st.securityNeverEnds ? 'never' : String(st.securityMonths || 1), pfDeduction: st.pfDeduction ?? e.pfDeduction, esiDeduction: st.esiDeduction ?? e.esiDeduction, pfNumber: e.pfNumber || '', uanNumber: e.uanNumber || '', esiNumber: e.esiNumber || '' });
  }
  // every change is saved by itself a moment after it was made; what is typed can be corrected by hand any time
  useEffect(() => {
    if (!picked || !f) return undefined;
    if (first.current) { first.current = false; return undefined; }
    setState('saving');
    const t = setTimeout(async () => {
      try { const r = await api.hr.saveSalarySetup(picked.id, { ...f, month }); setErrors({}); setState('saved'); setPicked(r.item); list.load(); } catch (err) { setErrors(err.errors || {}); setState(''); toast.error(err.message); }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  function changeMonth(m) {
    const v = m && m <= thisMonth ? m : thisMonth;
    setMonth(v);
    if (picked) choose(picked, v); // the set-up of that month is shown (nothing is saved by looking at it)
  }
  const set = (k) => (e) => { first.current = false; setF((x) => ({ ...x, [k]: e.target.value })); };
  const setMoney = (k) => (e) => { first.current = false; setF((x) => ({ ...x, [k]: moneyField(e.target.value) })); };
  const setFlag = (k) => (e) => { first.current = false; setF((x) => ({ ...x, [k]: e.target.checked })); };
  const gross = f ? SETUP_EARN.reduce((s, [k]) => s + num(f[k]), 0) : 0;
  const pf = f && f.pfDeduction ? Math.round((num(f.basic) * num(f.pfPercent))) / 100 : 0;
  const esi = f && f.esiDeduction ? Math.round((num(f.basic) * num(f.esiPercent))) / 100 : 0;
  const ded = f ? pf + esi + num(f.professionalTax) + num(f.advanceDeduction) : 0;
  const neverEnds = f?.securityMonths === 'never';
  const secCut = f && num(f.securityAmount) ? (neverEnds ? num(f.securityAmount) : Math.ceil(num(f.securityAmount) / Math.max(num(f.securityMonths), 1))) : 0;
  return (
    <>
      <PageHeader title="Set Salary" description="Search an employee and set the salary: the fixed components, PF / ESI, professional tax, advance and the security that is cut from the salary. Every change is saved by itself and can be edited by hand any time. Loan incentive, product sell incentive, GRT commission, senior commission (supervisors) and NPA recovery 10% come in automatically when the salary is generated." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <input type="search" placeholder="Search employee: name, code, mobile" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search employee" style={{ minWidth: 260 }} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Salary month <input type="month" value={month} max={thisMonth} onChange={(e) => changeMonth(e.target.value)} aria-label="Salary month" /></label>
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="No employee" description="Register the employee first (Employee Registration)." /> : (
          <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>Employee</th><th>Branch</th><th>Designation</th><th className="num">Monthly salary</th><th /></tr></thead>
              <tbody>
                {items.slice(0, 100).map((e) => (
                  <tr key={e.id} style={picked?.id === e.id ? { background: 'var(--surface-2, #f6f8f8)' } : undefined}>
                    <td data-label="Employee"><strong>{e.employeeCode}</strong> {e.name}</td><td data-label="Branch">{branchLabel(e.branch)}</td><td data-label="Designation">{e.designation?.name || '—'}</td>
                    <td data-label="Monthly salary" className="num">{e.monthlySalary ? inr(e.monthlySalary) : <span className="muted">not set</span>}</td>
                    <td><button className="btn sm" onClick={() => choose(e)}>{picked?.id === e.id ? 'Selected' : 'Set salary'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {picked && f && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3 className="section-title">{picked.employeeCode} — {picked.name} · salary of {monthLabel(month)} <span className="muted small" style={{ marginLeft: 8 }}>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}</span></h3>
          <div className="panel-grid" style={{ marginTop: 0 }}>
            <div>
              <h4>Receive side</h4>
              <div className="form-grid">
                {SETUP_EARN.map(([k, label], i) => <FormField key={k} id={`ss${k}`} label={`${i + 1}. ${label} (₹)`} error={errors[k]}><input id={`ss${k}`} inputMode="decimal" value={f[k]} onChange={setMoney(k)} /></FormField>)}
              </div>
              <p className="muted small">Automatic when the salary is generated: loan incentive, product sell incentive, GRT commission (a new group opened with 5 new members, in the employee's name), senior commission (only for a supervisor) and 10% of the NPA recovery.</p>
              <p style={{ margin: '8px 0 0' }}><strong>Total fixed salary: {inr(gross)}</strong></p>
            </div>
            <div>
              <h4>Payment side</h4>
              <div className="form-grid">
                <label className="span-2" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.pfDeduction} onChange={setFlag('pfDeduction')} /> PF deduction</label>
                <FormField id="sspf" label="PF % of basic" error={errors.pfPercent}><input id="sspf" inputMode="decimal" value={f.pfPercent} onChange={setMoney('pfPercent')} disabled={!f.pfDeduction} /></FormField>
                <label className="span-2" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.esiDeduction} onChange={setFlag('esiDeduction')} /> ESI deduction</label>
                <FormField id="ssesi" label="ESI % of basic" error={errors.esiPercent}><input id="ssesi" inputMode="decimal" value={f.esiPercent} onChange={setMoney('esiPercent')} disabled={!f.esiDeduction} /></FormField>
                <FormField id="sspfn" label="PF number" error={errors.pfNumber}><input id="sspfn" value={f.pfNumber} maxLength={30} onChange={(e) => { first.current = false; setF((x) => ({ ...x, pfNumber: e.target.value.toUpperCase() })); }} /></FormField>
                <FormField id="ssuan" label="UAN number" error={errors.uanNumber}><input id="ssuan" inputMode="numeric" value={f.uanNumber} onChange={(e) => { first.current = false; setF((x) => ({ ...x, uanNumber: e.target.value.replace(/\D/g, '').slice(0, 12) })); }} /></FormField>
                <FormField id="ssesin" label="ESI number" error={errors.esiNumber}><input id="ssesin" inputMode="numeric" value={f.esiNumber} onChange={(e) => { first.current = false; setF((x) => ({ ...x, esiNumber: e.target.value.replace(/\D/g, '').slice(0, 17) })); }} /></FormField>
                <FormField id="sspt" label="Professional tax (₹ a month)" error={errors.professionalTax}><input id="sspt" inputMode="decimal" value={f.professionalTax} onChange={setMoney('professionalTax')} /></FormField>
                <FormField id="ssadv" label="Advance deduction (₹ a month)" error={errors.advanceDeduction}><input id="ssadv" inputMode="decimal" value={f.advanceDeduction} onChange={setMoney('advanceDeduction')} /></FormField>
                <FormField id="sssec" label={neverEnds ? 'Security amount (₹ every month)' : 'Security amount (₹)'} error={errors.securityAmount} hint={neverEnds ? 'Cut every month, with no end, once the verification is complete' : 'Cut after the verification is complete'}><input id="sssec" inputMode="decimal" value={f.securityAmount} onChange={setMoney('securityAmount')} /></FormField>
                <FormField id="sssecm" label="Security cut in months" error={errors.securityMonths}><select id="sssecm" value={f.securityMonths} onChange={set('securityMonths')}>{[1, 2, 3, 4, 5].map((m) => <option key={m} value={m}>{m} month{m === 1 ? '' : 's'}</option>)}<option value="never">Never end</option></select></FormField>
              </div>
              <p className="muted small">Leave (the pay cut for days not worked), recovery amount and other deduction are worked out or entered on the salary slip.</p>
              <p style={{ margin: '8px 0 0' }}><strong>Fixed deductions a month: {inr(ded + secCut)}</strong> <span className="muted small">(PF {inr(pf)} · ESI {inr(esi)}{secCut ? ` · security ${inr(secCut)}${neverEnds ? ' every month' : ''}` : ''})</span></p>
            </div>
          </div>
          <p style={{ margin: '12px 0 0' }}><strong>Total − total deduction = {inr(gross - ded - secCut)}</strong> <span className="muted small">(before leave, incentives and recovery)</span></p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Attendance: automatic (from the work done in the system) and manual
const ATT = [['', 'Not marked'], ['present', 'Present'], ['half_day', 'Half day'], ['leave', 'Leave'], ['holiday', 'Holiday'], ['absent', 'Absent']];
const ATT_BADGE = { present: 'green', half_day: 'amber', leave: 'grey', holiday: 'grey', absent: 'danger' };

// The place an employee marks the attendance from: latitude, longitude and how many metres around it count. The attendance passes only from there.
function LocationDialog({ item, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ lat: item.location ? String(item.location.lat) : '', lng: item.location ? String(item.location.lng) : '', radius: String(item.location?.radius || 100) });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const decimal = (v) => v.replace(/[^\d.-]/g, '');
  function here() {
    if (!navigator.geolocation) { toast.error('This browser cannot read the location'); return; }
    navigator.geolocation.getCurrentPosition((p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })), () => toast.error('The location could not be read. Allow it in the browser or type it.'));
  }
  async function save(clear) {
    setBusy(true); setErrors({});
    try { await api.hr.setAttendanceLocation(item.id, clear ? { clear: true } : f); toast.success(clear ? 'Location removed' : 'Location saved'); onSaved(); } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  return (
    <Modal open title={`Attendance location — ${item.employeeCode} ${item.name}`} onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Close</button>{item.location && <button className="btn danger-outline" onClick={() => save(true)} disabled={busy}>Remove</button>}<button className="btn primary" onClick={() => save(false)} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <p className="muted small" style={{ marginTop: 0 }}>The employee's attendance in the app passes only when they are within this distance of this latitude and longitude.</p>
      <div className="form-grid">
        <FormField id="lclat" label="Latitude" required error={errors.lat}><input id="lclat" inputMode="decimal" value={f.lat} onChange={(e) => setF((x) => ({ ...x, lat: decimal(e.target.value) }))} /></FormField>
        <FormField id="lclng" label="Longitude" required error={errors.lng}><input id="lclng" inputMode="decimal" value={f.lng} onChange={(e) => setF((x) => ({ ...x, lng: decimal(e.target.value) }))} /></FormField>
        <FormField id="lcr" label="Allowed distance (metres)" error={errors.radius} hint="20 to 5000"><input id="lcr" inputMode="numeric" value={f.radius} onChange={(e) => setF((x) => ({ ...x, radius: e.target.value.replace(/\D/g, '').slice(0, 4) }))} /></FormField>
        <div style={{ alignSelf: 'end' }}><button type="button" className="btn" onClick={here}>Use my current location</button></div>
      </div>
    </Modal>
  );
}

export function Attendance() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [date, setDate] = useState(today());
  const list = useLoad(() => api.hr.attendance({ branch, date }), [branch, date]);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [bulk, setBulk] = useState('leave');
  const [locating, setLocating] = useState(null);
  useEffect(() => { setEdits({}); setPicked(new Set()); }, [list.data]);
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
  const statusOf = (i) => edits[i.id]?.status ?? i.status;
  const needle = search.trim().toLowerCase();
  const shown = items.filter((i) => (!filter || (filter === 'none' ? !statusOf(i) : statusOf(i) === filter)) && (!needle || [i.employeeCode, i.name, i.designation, i.branch].some((v) => String(v || '').toLowerCase().includes(needle))));
  const allPicked = shown.length > 0 && shown.every((i) => picked.has(i.id));
  const unmarked = shown.filter((i) => !statusOf(i));
  // one tick marks everyone shown who has no mark yet as present; ticking again takes those marks back
  const markAllPresent = (on) => setEdits((e) => {
    const n = { ...e };
    shown.forEach((i) => {
      if (on && !(n[i.id]?.status ?? i.status)) n[i.id] = { status: 'present', remark: n[i.id]?.remark ?? i.remark ?? '' };
      if (!on && !i.status && n[i.id]?.status === 'present') delete n[i.id];
    });
    return n;
  });
  const applyBulk = () => { picked.forEach((id) => setRow(id, { status: bulk })); toast.success(`${picked.size} employee${picked.size === 1 ? '' : 's'} set to ${(ATT.find(([k]) => k === bulk) || [])[1] || 'Not marked'}. Save to keep it.`); setPicked(new Set()); };
  return (
    <>
      <PageHeader title="Attendance" description="Present is marked automatically for employees with a staff login who worked in the system that day. Mark the others by hand; what you mark replaces the automatic mark. Sunday is the weekly off and is paid." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Date <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} aria-label="Date" /></label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show"><option value="">All</option><option value="present">Present</option><option value="absent">Absent</option><option value="half_day">Half day</option><option value="leave">Leave</option><option value="holiday">Holiday</option><option value="none">Not marked</option></select>
          <input type="search" placeholder="Search name, code, branch" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" style={{ minWidth: 180 }} />
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn" onClick={auto} disabled={busy === 'auto'}>{busy === 'auto' ? 'Marking…' : 'Auto attendance'}</button>
          <button className="btn primary" onClick={save} disabled={!changed || busy === 'save'}>{busy === 'save' ? 'Saving…' : `Save${changed ? ` (${changed})` : ''}`}</button>
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="No employee" description="No employee on the roll for this date and branch." /> : (
          <>
            <Summary items={[['Employees', s.employees], ['Present', s.present], ['Half day', s.half_day], ['Leave', s.leave], ['Holiday', s.holiday], ['Absent', s.absent], ['Not marked', s.notMarked]]} />
            {list.data.sunday && <div className="notice">Sunday: the weekly off. It is paid even when nobody is marked.</div>}
            {list.data.holidays?.length > 0 && <div className="notice">Holiday: {list.data.holidays.join(', ')}. It is paid even when nobody is marked.</div>}
            <div className="toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" disabled={!unmarked.length && !shown.some((i) => !i.status && edits[i.id]?.status === 'present')} checked={unmarked.length === 0 && shown.some((i) => !i.status && edits[i.id]?.status === 'present')} onChange={(e) => markAllPresent(e.target.checked)} /> Mark all not marked as present (one tick)</label>
              <span className="muted small">Selected: {picked.size}</span>
              <select value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="Mark selected as">{ATT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <button className="btn" onClick={applyBulk} disabled={!picked.size}>Mark selected</button>
            </div>
            {shown.length === 0 && <div className="muted" style={{ padding: 12 }}>No employee matches the filter.</div>}
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th><input type="checkbox" aria-label="Select all shown" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((i) => i.id)))} /></th><th>Employee</th><th>Branch</th><th>Location</th><th>Attendance</th><th>Marked</th><th>Remark</th></tr></thead>
                <tbody>
                  {shown.map((i) => {
                    const cur = edits[i.id]?.status ?? i.status;
                    return (
                      <tr key={i.id} style={edits[i.id] ? { background: 'var(--surface-2, #f6f8f8)' } : undefined}>
                        <td><input type="checkbox" aria-label={`Select ${i.employeeCode}`} checked={picked.has(i.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} /></td>
                        <td data-label="Employee"><strong>{i.employeeCode}</strong> {i.name}<div className="muted small">{i.designation || '—'}</div></td>
                        <td data-label="Branch">{branchLabel({ code: i.branch, name: i.branchName })}</td>
                        <td data-label="Location">{i.location ? <><div className="small">{i.location.lat.toFixed(5)}, {i.location.lng.toFixed(5)}</div><div className="muted small">within {i.location.radius} m</div></> : <span className="muted small">Not set</span>}<button className="btn sm" onClick={() => setLocating(i)}>{i.location ? 'Change' : 'Set'}</button></td>
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
      {locating && <LocationDialog item={locating} onClose={() => setLocating(null)} onSaved={() => { setLocating(null); list.load(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Salary: generate and send, pay, branch wise
const SAL_BADGE = { generated: ['Generated', 'grey'], sent: ['Sent', 'amber'], paid: ['Paid', 'green'] };
const SalBadge = ({ s }) => <span className={`badge ${SAL_BADGE[s]?.[1] || 'grey'}`}>{SAL_BADGE[s]?.[0] || s}</span>;

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The salary slip as a document: letterhead of the company (logo, name, address, PAN, CIN, contact), the employee, the days, receive side, payment side and the net salary. */
function printSlip(slip, company) {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) return false;
  const rows = (side) => slip.lines.filter((l) => l.side === side && (l.amount || (side === 'earn' && l.key === 'basic'))).map((l, i) => `<tr><td>${i + 1}. ${esc(l.label)}</td><td class="n">${money(l.amount)}</td></tr>`).join('');
  const c = company || {};
  const place = [c.address, [c.city, c.state].filter(Boolean).join(', '), c.pincode].filter(Boolean).join(' · ');
  const e = slip.employee || {};
  const head = company
    ? `<div class="head">${c.logo ? `<img class="logo" src="${c.logo}" alt="">` : ''}<div class="co"><div class="name">${esc(c.name)}</div><div>${esc(place)}</div><div>${esc([c.mobile && `Mobile ${c.mobile}`, c.email].filter(Boolean).join(' · '))}</div><div>${esc([c.pan && `PAN ${c.pan}`, c.cin && `CIN ${c.cin}`].filter(Boolean).join(' · '))}</div></div></div>`
    : '';
  const info = (k, v) => `<div><span>${k}</span><strong>${esc(v || '—')}</strong></div>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Salary slip ${esc(slip.employeeCode)} ${esc(slip.month)}</title><style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:24px;font-size:13px}
    .head{display:flex;gap:16px;align-items:center;border-bottom:3px solid #264653;padding-bottom:12px;margin-bottom:12px}
    .logo{height:72px;max-width:140px;object-fit:contain}.co{flex:1;line-height:1.5}.name{font-size:22px;font-weight:700;color:#264653}
    h1{font-size:16px;text-align:center;margin:10px 0;letter-spacing:1px;background:#264653;color:#fff;padding:6px}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 14px;border:1px solid #ccc;padding:10px;margin-bottom:10px}.grid span{display:block;color:#666;font-size:11px}
    table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#eef2f3}.n{text-align:right}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0}.tot td{font-weight:700;background:#f6f8f8}
    .net{border:2px solid #264653;padding:10px;text-align:center;font-size:16px;font-weight:700;margin-top:10px}
    .sign{display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px}.sign img{height:60px;max-width:180px;object-fit:contain}.sign div{text-align:center;min-width:180px;border-top:1px solid #888;padding-top:4px;font-size:12px}
    .foot{margin-top:18px;color:#777;font-size:11px;text-align:center}
    @media print{body{margin:10mm}}
  </style></head><body>
  ${head}
  <h1>SALARY SLIP — ${esc(monthLabel(slip.month).toUpperCase())}</h1>
  <div class="grid">${info('Employee code', slip.employeeCode)}${info('Name', slip.name)}${info('Designation', slip.designation)}${info('Department', slip.department)}${info('Branch', slip.branch ? `${slip.branch.code} — ${slip.branch.name}` : '')}${info('Date of joining', e.joiningDate ? dmy(e.joiningDate) : '')}${info('Bank', e.bankName)}${info('Account number', e.accountNumber)}${info('PAN', e.panNo)}${info('PF number', e.pfNumber)}${info('UAN', e.uanNumber)}${info('ESI number', e.esiNumber)}</div>
  <table><tr><th>Days in the month</th><th>Present</th><th>Half days</th><th>Leave</th><th>Holiday</th><th>Sundays</th><th>Absent</th><th>Payable days</th></tr>
  <tr><td>${slip.daysInMonth}</td><td>${slip.presentDays}</td><td>${slip.halfDays}</td><td>${slip.leaveDays}</td><td>${slip.holidayDays}</td><td>${slip.sundays}</td><td>${slip.absentDays}</td><td>${slip.payableDays}</td></tr></table>
  <div class="two">
    <table><tr><th colspan="2">Receive side</th></tr>${rows('earn')}<tr class="tot"><td>Total</td><td class="n">${money(slip.totalEarning)}</td></tr></table>
    <table><tr><th colspan="2">Payment side</th></tr>${rows('ded') || '<tr><td colspan="2">—</td></tr>'}<tr class="tot"><td>Total deduction</td><td class="n">${money(slip.totalDeduction)}</td></tr></table>
  </div>
  <div class="net">Net salary = Total − Total deduction = ₹ ${money(slip.net)}</div>
  ${slip.remark ? `<p>Remark: ${esc(slip.remark)}</p>` : ''}
  <div class="sign"><div>Employee signature</div><div>${c.stamp ? `<img src="${c.stamp}" alt=""><br>` : ''}${c.signature ? `<img src="${c.signature}" alt=""><br>` : ''}Authorised signatory</div></div>
  <div class="foot">This is a computer generated salary slip.</div>
  <script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
  return true;
}

function SlipDialog({ slip, onClose, onSaved }) {
  const toast = useToast();
  const [vals, setVals] = useState(() => Object.fromEntries(slip.lines.map((l) => [l.key, l.amount ? String(l.amount) : ''])));
  const [remark, setRemark] = useState(slip.remark || '');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const paid = slip.status === 'paid';
  const sumSide = (side) => slip.lines.filter((l) => l.side === side).reduce((s, l) => s + num(vals[l.key]), 0);
  const totalEarn = sumSide('earn');
  const totalDed = sumSide('ded');
  const net = Math.max(totalEarn - totalDed, 0);
  async function save() {
    setBusy(true);
    setErrors({});
    try { await api.hr.adjustSalary(slip.id, { lines: vals, remark }); toast.success('Salary updated'); onSaved(); } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  async function print() {
    let company = null;
    try { company = (await api.hr.letterhead()).company; } catch { /* printed without the letterhead */ }
    if (!printSlip(slip, company)) toast.error('Allow pop-ups to print the slip');
  }
  const row = (l, v) => <tr><td>{l}</td><td className="num">{v}</td></tr>;
  const side = (title, which) => (
    <div>
      <h4 style={{ margin: '8px 0 4px' }}>{title}</h4>
      <table className="data-table">
        <tbody>
          {slip.lines.filter((l) => l.side === which).map((l, i) => (
            <tr key={l.key}>
              <td>{i + 1}. {l.label}{l.manual && <span className="badge amber" style={{ marginLeft: 6 }}>edited</span>}</td>
              <td className="num">{paid ? inr(l.amount) : <input aria-label={l.label} inputMode="decimal" value={vals[l.key]} onChange={(e) => setVals((x) => ({ ...x, [l.key]: moneyField(e.target.value) }))} style={{ width: 110, textAlign: 'right' }} />}{errors[l.key] && <div className="field-error small">{errors[l.key]}</div>}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid currentColor' }}><td><strong>Total {which === 'earn' ? '' : 'deduction'}</strong></td><td className="num"><strong>{inr(which === 'earn' ? totalEarn : totalDed)}</strong></td></tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <Modal open title={`Salary slip — ${slip.employeeCode} ${slip.name}`} onClose={onClose} busy={busy} size="lg"
      footer={<><button className="btn" onClick={print}>Print</button><button className="btn" onClick={onClose} disabled={busy}>Close</button>{!paid && <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}</>}>
      <p className="muted">{monthLabel(slip.month)} · {branchLabel(slip.branch)} · {slip.designation || slip.department || ''}</p>
      <div className="table-wrap">
        <table className="data-table">
          <tbody>
            {row('Days in the month', slip.daysInMonth)}{row('Present', slip.presentDays)}{row('Half days', slip.halfDays)}{row('Leave (paid)', slip.leaveDays)}{row('Holiday', slip.holidayDays)}{row('Sundays (weekly off)', slip.sundays)}
            {row('Absent', `${slip.absentDays}${slip.unmarkedDays ? ` (${slip.unmarkedDays} not marked)` : ''}`)}{row('Payable days', slip.payableDays)}
          </tbody>
        </table>
      </div>
      <div className="panel-grid" style={{ marginTop: 8 }}>
        {side('Receive side', 'earn')}
        {side('Payment side', 'ded')}
      </div>
      <p style={{ margin: '12px 0 0' }}><strong>Net salary = total − total deduction = {inr(net)}</strong></p>
      <p className="muted small">A line you change by hand stays as you set it when the salary is generated again.</p>
      {slip.unmarkedDays > 0 && <div className="notice" style={{ marginTop: 8 }}>{slip.unmarkedDays} day{slip.unmarkedDays === 1 ? ' was' : 's were'} not marked and counted as absent. Mark the attendance and generate the salary again to correct it.</div>}
      {!paid && <FormField id="slrem" label="Remark" className="span-2"><input id="slrem" value={remark} maxLength={200} onChange={(e) => setRemark(e.target.value)} /></FormField>}
      {paid && <div className="muted small" style={{ marginTop: 8 }}>Paid on {dmy(slip.paidOn)} by {MODE_LABEL[slip.payMode] || slip.payMode}.</div>}
    </Modal>
  );
}

function SalaryTable({ items, picked, setPicked, onOpen, onPay, selectable }) {
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
              <td data-label="Branch">{branchLabel(s.branch)}</td>
              <td data-label="Payable days" className="num">{s.payableDays}/{s.daysInMonth}{s.unmarkedDays > 0 && <div className="muted small">{s.unmarkedDays} not marked</div>}</td>
              <td data-label="Salary" className="num">{inr(s.earned)}</td><td data-label="Bonus" className="num">{s.bonus ? inr(s.bonus) : '—'}</td><td data-label="Deduction" className="num">{s.otherDeduction ? inr(s.otherDeduction) : '—'}</td>
              <td data-label="Net" className="num"><strong>{inr(s.net)}</strong>{s.paid > 0 && s.status !== 'paid' && <div className="muted small">paid {inr(s.paid)} · balance {inr(s.balance)}</div>}</td>
              <td data-label="Status"><SalBadge s={s.status} />{s.paid > 0 && s.status !== 'paid' && <div><span className="badge amber">part paid</span></div>}{s.sentAt && s.status !== 'paid' && <div className="muted small">sent {dmy(s.sentAt)}</div>}</td>
              <td><div style={{ display: 'flex', gap: 6 }}><button className="btn sm" onClick={() => onOpen(s)}>Slip</button>{onPay && s.status === 'sent' && <button className="btn sm primary" onClick={() => onPay(s)}>Pay</button>}</div></td>
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
      toast.success(`${r.sent} slip${r.sent === 1 ? '' : 's'} sent (SMS, email and the employee's app)${r.mailed ? ` · ${r.mailed} by email` : ''}${r.noMobile ? ` · ${r.noMobile} without a mobile number` : ''}${r.failed ? ` · ${r.failed} failed` : ''}. They are in Salary Payment now.`);
      list.load();
    } catch (err) { toast.error(err.message); } finally { setBusy(''); }
  }
  const items = list.data?.items || [];
  const s = list.data?.summary;
  const pickedTotal = items.filter((i) => picked.has(i.id)).reduce((t, i) => t + i.net, 0);
  return (
    <>
      <PageHeader title="Employee Salary Generate & Send" description="The salary of a month is worked out month wise from the attendance and the Set Salary figures. The total payable amount is shown; tick the slips and send them: the employee gets the slip by SMS and email and sees it in the app, and the salary then goes to Salary Payment." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Month <input type="month" value={month} max={lastMonth()} onChange={(e) => setMonth(e.target.value || lastMonth())} aria-label="Month" /></label>
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn primary" onClick={generate} disabled={busy === 'gen'}>{busy === 'gen' ? 'Generating…' : 'Generate salary'}</button>
          <button className="btn" onClick={send} disabled={!picked.size || busy === 'send'}>{busy === 'send' ? 'Sending…' : `Send salary slip${picked.size ? ` (${picked.size} · ${inr(pickedTotal)})` : ''}`}</button>
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="No salary generated" description={`Generate the salary of ${monthLabel(month)}.`} /> : (
          <>
            <Summary items={[['Slips', s.slips], ['Total payable amount', inr(s.net)], ['Paid', inr(s.paid)], ['To pay', inr(s.due)]]} />
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
  const [status, setStatus] = useState('topay');
  const list = useLoad(() => api.hr.salary({ month, branch, status }), [month, branch, status]);
  const [picked, setPicked] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [payFor, setPayFor] = useState(null); // the slip a payment (the whole balance or a part) is made for
  const [payMode, setPayMode] = useState('cash');
  const [bankAccount, setBankAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => { setPicked(new Set()); }, [list.data]);
  const items = list.data?.items || [];
  const chosen = useMemo(() => items.filter((i) => picked.has(i.id)), [items, picked]);
  const total = chosen.reduce((t, i) => t + i.net, 0);
  // the slips to pay, branch by branch
  const byBranch = useMemo(() => {
    const m = new Map();
    items.filter((i) => i.status === 'sent').forEach((i) => { const k = i.branch?.code || '—'; const v = m.get(k) || { code: k, name: i.branch?.name || '', ids: [], total: 0 }; v.ids.push(i.id); v.total += i.net; m.set(k, v); });
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [items]);
  async function pay(only, amounts, mode = payMode, bank = bankAccount) {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.hr.paySalary({ ids: only || [...picked], amounts, payMode: mode, bankAccount: mode === 'bank' ? bank : undefined });
      toast.success(`${r.paid} salar${r.paid === 1 ? 'y' : 'ies'} paid (${inr(r.amount)}). It is in the Cashbook as Staff salary paid${r.dates?.length ? ` on ${r.dates.map(dmy).join(', ')}` : ''}.`);
      if (r.failed.length) toast.error(`${r.failed.length} not paid: ${r.failed[0].message}`);
      setPayFor(null);
      list.load();
    } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  const s = list.data?.summary;
  return (
    <>
      <PageHeader title="Salary Payment" description="The salary slips that were sent are paid here, branch wise: the name and a Pay button of every employee. Every payment is an entry of the branch Cashbook (Staff salary paid) on its own, by cash or bank. The month wise report is below." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Month <input type="month" value={month} max={lastMonth()} onChange={(e) => setMonth(e.target.value || lastMonth())} aria-label="Month" /></label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="topay">To pay (slip sent)</option><option value="generated">Not sent yet</option><option value="paid">Paid</option><option value="">All</option></select>
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="Nothing to show" description="Generate the salary of the month and send the slips first (Employee Salary Generate & Send): the sent slips come here to be paid." /> : (
          <>
            <Summary items={[['Slips', s.slips], ['Net salary', inr(s.net)], ['Paid', inr(s.paid)], ['To pay', inr(s.due)]]} />
            {byBranch.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
                {byBranch.map((b) => <button key={b.code} className="btn sm" onClick={() => setPicked(new Set(b.ids))} title={b.name}>{b.code}: {b.ids.length} to pay · {inr(b.total)} (select)</button>)}
              </div>
            )}
            <SalaryTable items={items} picked={picked} setPicked={setPicked} onOpen={setOpen} onPay={setPayFor} selectable />
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
              <FormField id="spmode" label="Pay by" error={errors.payMode}><select id="spmode" value={payMode} onChange={(e) => setPayMode(e.target.value)}>{Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
              <BankAccountSelect id="spbank" mode={payMode} value={bankAccount} onChange={setBankAccount} error={errors.bankAccount} />
              <button className="btn primary" onClick={() => pay()} disabled={!picked.size || busy}>{busy ? 'Paying…' : `Pay ${picked.size ? `${picked.size} · ${inr(total)}` : 'selected'}`}</button>
            </div>
          </>
        )}
      </div>
      <MonthWiseReport branch={branch} version={list.data} />
      {open && <SlipDialog slip={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.load(); }} />}
      {payFor && <PaySalaryDialog slip={payFor} busy={busy} errors={errors} defaultMode={payMode} onClose={() => setPayFor(null)} onPay={(amount, mode, bank) => pay([payFor.id], { [payFor.id]: amount }, mode, bank)} />}
    </>
  );
}

/** Pays a salary: the whole balance, or a part of it (the balance stays to be paid later). */
function PaySalaryDialog({ slip, busy, errors, defaultMode, onClose, onPay }) {
  const [amount, setAmount] = useState(String(slip.balance));
  const [mode, setMode] = useState(defaultMode);
  const [bank, setBank] = useState('');
  const entered = num(amount);
  const left = Math.round((slip.balance - entered) * 100) / 100;
  return (
    <Modal open title={`Pay salary — ${slip.employeeCode} ${slip.name}`} onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" onClick={() => onPay(amount, mode, bank)} disabled={busy || !(entered > 0) || entered > slip.balance}>{busy ? 'Paying…' : `Pay ${inr(entered || 0)}`}</button></>}>
      <p className="muted">{monthLabel(slip.month)} · {branchLabel(slip.branch)}</p>
      <div className="table-wrap"><table className="data-table"><tbody>
        <tr><td>Net salary</td><td className="num">{inr(slip.net)}</td></tr>
        <tr><td>Paid so far</td><td className="num">{inr(slip.paid)}</td></tr>
        <tr><td><strong>Balance to pay</strong></td><td className="num"><strong>{inr(slip.balance)}</strong></td></tr>
      </tbody></table></div>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <FormField id="pdamt" label="Amount to pay (₹)" error={errors.amounts || (entered > slip.balance ? `Only ${inr(slip.balance)} is left` : '')} hint="The whole balance, or a part of it"><input id="pdamt" inputMode="decimal" value={amount} onChange={(e) => setAmount(moneyField(e.target.value))} /></FormField>
        <FormField id="pdmode" label="Pay by" error={errors.payMode}><select id="pdmode" value={mode} onChange={(e) => setMode(e.target.value)}>{Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
        <BankAccountSelect id="pdbank" mode={mode} value={bank} onChange={setBank} error={errors.bankAccount} />
      </div>
      <p style={{ margin: '8px 0 0' }}>{entered > 0 && entered <= slip.balance ? (left > 0 ? <>After this payment <strong>{inr(left)}</strong> is left to pay.</> : <>This pays the salary in full.</>) : null}</p>
    </Modal>
  );
}

/** The salary month by month of a year: slips, sent, earning, deduction, net, paid and still to pay. */
function MonthWiseReport({ branch, version }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const list = useLoad(() => api.hr.monthWiseSalary({ year, branch }), [year, branch, version]);
  const d = list.data;
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <h3 className="section-title" style={{ margin: 0 }}>Month wise report</h3>
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <Refresh onClick={list.load} loading={list.loading} />
        <button className="btn no-print" onClick={() => window.print()} disabled={!d?.rows.length}>Print</button>
      </div>
      {list.loading && !d ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : !d?.rows.length ? <EmptyState title={`No salary in ${year}`} /> : (
        <div className="table-wrap">
          <table className="data-table grid-lines">
            <thead><tr><th>Month</th><th className="num">Slips</th><th className="num">Sent</th><th className="num">Paid</th><th className="num">Earning</th><th className="num">Deduction</th><th className="num">Net salary</th><th className="num">Paid amount</th><th className="num">To pay</th></tr></thead>
            <tbody>
              {d.rows.map((r) => <tr key={r.month}><td data-label="Month">{monthLabel(r.month)}</td><td data-label="Slips" className="num">{r.slips}</td><td data-label="Sent" className="num">{r.sent}</td><td data-label="Paid" className="num">{r.paidCount}</td><td data-label="Earning" className="num">{inr(r.earning)}</td><td data-label="Deduction" className="num">{inr(r.deduction)}</td><td data-label="Net" className="num"><strong>{inr(r.net)}</strong></td><td data-label="Paid amount" className="num">{inr(r.paid)}</td><td data-label="To pay" className="num">{inr(r.due)}</td></tr>)}
              <tr style={{ borderTop: '2px solid currentColor' }}><td><strong>Total {year}</strong></td><td className="num"><strong>{d.totals.slips}</strong></td><td /><td /><td className="num"><strong>{inr(d.totals.earning)}</strong></td><td className="num"><strong>{inr(d.totals.deduction)}</strong></td><td className="num"><strong>{inr(d.totals.net)}</strong></td><td className="num"><strong>{inr(d.totals.paid)}</strong></td><td className="num"><strong>{inr(d.totals.due)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
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

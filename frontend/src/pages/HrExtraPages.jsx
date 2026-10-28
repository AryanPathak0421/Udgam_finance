import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { staffLabel, branchLabel } from '../utils/staffLabel.js';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import BankAccountSelect from '../components/BankAccountSelect.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PhotoField } from './NewBorrower.jsx';
import { BranchSelect, Refresh, Summary, useLoad, inr, dmy, today, MODE_LABEL } from './HrPages.jsx';
import { todayIso } from '../utils/format.js';

const monthNow = () => todayIso().slice(0, 7);
const monthStart = () => `${monthNow()}-01`;
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, ' ') : '—');
const BADGE = { pending: 'amber', approved: 'green', rejected: 'danger', open: 'amber', in_progress: 'amber', done: 'green', resolved: 'green', cancelled: 'grey', paid: 'green', filled: 'green' };
const Badge = ({ s }) => <span className={`badge ${BADGE[s] || 'grey'}`}>{cap(s)}</span>;
const Dates = ({ from, setFrom, to, setTo }) => (
  <>
    <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
    <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
  </>
);
const Body = ({ list, empty, children }) => (list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : !list.data || list.data.items.length === 0 ? <EmptyState title="Nothing here" description={empty} /> : children());

/** Branch, then an employee of that branch. */
function EmployeePick({ value, onChange, error, label = 'Employee', id = 'empick', onlyActive = true, branch: forced, onBranch }) {
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState(forced || '');
  const [emps, setEmps] = useState([]);
  useEffect(() => { api.groups.branchOptions().then((r) => { setBranches(r.items); if (!forced && r.items.length === 1) setBranch(r.items[0].id); }).catch(() => {}); }, [forced]);
  useEffect(() => {
    // no branch chosen yet: the employees of all the branches are listed, so an employee can be found without choosing the branch first
    api.hr.employees({ branch, status: onlyActive ? 'active' : '', pick: onlyActive ? '1' : undefined }).then((r) => setEmps(r.items)).catch(() => {});
    if (branch) onBranch?.(branch);
  }, [branch, onlyActive]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {!forced && branches.length > 1 && (
        <FormField id={`${id}b`} label="Branch" required>
          <select id={`${id}b`} value={branch} onChange={(e) => { setBranch(e.target.value); onChange(''); }}><option value="">Select</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select>
        </FormField>
      )}
      <FormField id={id} label={label} required error={error}>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select</option>{emps.map((e) => <option key={e.id} value={e.id}>{staffLabel(e)}</option>)}</select>
      </FormField>
    </>
  );
}

function FormModal({ title, onClose, onSave, busy, children, saveLabel = 'Save' }) {
  return (
    <Modal open title={title} onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Close</button><button className="btn primary" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : saveLabel}</button></>}>
      {children}
    </Modal>
  );
}
/** Runs a save, shows its errors on the form and refreshes the list. */
function useSaver(toast, done) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const run = async (fn, okMessage) => {
    setBusy(true);
    setErrors({});
    try { const r = await fn(); toast.success(typeof okMessage === 'function' ? okMessage(r) : okMessage); done(r); } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  };
  return { busy, errors, setErrors, run };
}
function ReasonModal({ title, subject, label = 'Reason', confirm = 'Reject', onClose, onSend, tone = 'danger', required = true }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title={title} onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className={`btn ${tone}`} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onSend(reason); } catch (err) { setError(err.errors?.reason || err.errors?.remark || err.message); setBusy(false); } }}>{busy ? 'Saving…' : confirm}</button></>}>
      <p className="muted">{subject}</p>
      <FormField id="rsn" label={label} required={required} error={error}><input id="rsn" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></FormField>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Room rent entry
const KIND = { room: 'Room owner', messenger: 'Messenger' };
const digitsOnly = (v, n) => v.replace(/\D/g, '').slice(0, n);
const decimal = (v) => v.replace(/[^\d.]/g, '');
const num = (v) => Number(v) || 0;

// A room owner (address, rent, and the electricity meter when it is included) or a messenger (name, mobile, amount): entered by the admin only.
function PartyForm({ item, kind, branches, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ branch: item?.branch?.id || (branches.length === 1 ? branches[0].id : ''), name: item?.name || '', mobile: item?.mobile || '', address: item?.address || '', amount: item?.amount ? String(item.amount) : '', meterIncluded: Boolean(item?.meterIncluded), openingReading: item ? String(item.openingReading ?? '') : '', perUnit: item?.perUnit ? String(item.perUnit) : '', meterPhoto: '' });
  const sv = useSaver(toast, onSaved);
  useEffect(() => { if (item?.meterIncluded) api.hr.rentParty(item.id).then((r) => setF((x) => ({ ...x, meterPhoto: r.item.meterPhoto || '' }))).catch(() => {}); }, [item]);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); sv.setErrors((x) => ({ ...x, [k]: undefined })); };
  const room = kind === 'room';
  return (
    <FormModal title={`${item ? 'Edit' : 'Register'} ${KIND[kind].toLowerCase()}`} onClose={onClose} busy={sv.busy}
      onSave={() => sv.run(() => (item ? api.hr.updateRentParty(item.id, { ...f, kind }) : api.hr.createRentParty({ ...f, kind })), 'Saved')}>
      <div className="form-grid">
        {!item && branches.length > 1 && <FormField id="rpb" label="Branch" required error={sv.errors.branch}><select id="rpb" value={f.branch} onChange={set('branch')}><option value="">Select</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></FormField>}
        <FormField id="rpn" label="Name" required error={sv.errors.name}><input id="rpn" value={f.name} maxLength={80} onChange={set('name')} /></FormField>
        <FormField id="rpm" label="Mobile" required error={sv.errors.mobile}><input id="rpm" inputMode="numeric" value={f.mobile} onChange={(e) => setF((x) => ({ ...x, mobile: digitsOnly(e.target.value, 10) }))} /></FormField>
        {room && <FormField id="rpa" label="Address" required className="span-2" error={sv.errors.address}><input id="rpa" value={f.address} maxLength={300} onChange={set('address')} /></FormField>}
        <FormField id="rpr" label={room ? 'Monthly room rent (₹)' : 'Amount (₹)'} required error={sv.errors.amount}><input id="rpr" inputMode="decimal" value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: decimal(e.target.value) }))} /></FormField>
        {room && (
          <>
            <label className="span-2" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.meterIncluded} onChange={(e) => setF((x) => ({ ...x, meterIncluded: e.target.checked }))} /> Room rent meter included (electricity is paid by the meter reading)</label>
            {f.meterIncluded && (
              <>
                <FormField id="rpo" label="Meter reading" required error={sv.errors.openingReading}><input id="rpo" inputMode="decimal" value={f.openingReading} onChange={(e) => setF((x) => ({ ...x, openingReading: decimal(e.target.value) }))} /></FormField>
                <FormField id="rpu" label="Rate per unit (₹)" required error={sv.errors.perUnit}><input id="rpu" inputMode="decimal" value={f.perUnit} onChange={(e) => setF((x) => ({ ...x, perUnit: decimal(e.target.value) }))} /></FormField>
                <PhotoField id="rpph" label="Meter photo" required value={f.meterPhoto} error={sv.errors.meterPhoto} onChange={(v) => setF((x) => ({ ...x, meterPhoto: v }))} />
              </>
            )}
          </>
        )}
      </div>
    </FormModal>
  );
}

function RentParties({ branches, onClose }) {
  const toast = useToast();
  const list = useLoad(() => api.hr.rentParties({}), []);
  const [form, setForm] = useState(null);
  const items = list.data?.items || [];
  async function remove(p) {
    try { await api.hr.removeRentParty(p.id); toast.success('Removed'); list.load(); } catch (err) { toast.error(err.message); }
  }
  return (
    <Modal open title="Room owners and messengers" onClose={onClose} size="xl" footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p className="muted small" style={{ marginTop: 0 }}>Registered by the admin only. Branches then pay the rent to them in Room / Messenger Rent.</p>
      <div className="toolbar"><button className="btn primary" onClick={() => setForm({ kind: 'room' })}>Register room owner</button><button className="btn primary" onClick={() => setForm({ kind: 'messenger' })}>Register messenger</button></div>
      <Body list={list} empty="No room owner or messenger registered.">{() => (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Type</th><th>Name</th><th>Branch</th><th>Mobile</th><th className="num">Amount</th><th>Meter</th><th /></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td data-label="Type">{KIND[p.kind]}</td><td data-label="Name"><strong>{p.name}</strong>{p.address && <div className="muted small">{p.address}</div>}</td><td data-label="Branch">{branchLabel(p.branch)}</td><td data-label="Mobile">{p.mobile}</td>
                  <td data-label="Amount" className="num">{inr(p.amount)}</td>
                  <td data-label="Meter">{p.meterIncluded ? <>Last reading {p.lastReading}<div className="muted small">{inr(p.perUnit)} per unit</div></> : <span className="muted">{p.kind === 'room' ? 'Not included' : '—'}</span>}</td>
                  <td><div style={{ display: 'flex', gap: 6 }}><button className="btn sm" onClick={() => setForm({ kind: p.kind, item: p })}>Edit</button><button className="btn sm danger-outline" onClick={() => remove(p)}>Remove</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}</Body>
      {form && <PartyForm item={form.item} kind={form.kind} branches={branches} onClose={() => setForm(null)} onSaved={() => { setForm(null); list.load(); }} />}
    </Modal>
  );
}

export function RoomRent() {
  const toast = useToast();
  const { user } = useAuth();
  const admin = ['super_admin', 'admin'].includes(user?.role);
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.hr.roomRents({ branch, from, to, q }), [branch, from, to, q]);
  const [adding, setAdding] = useState(false);
  const [parties, setParties] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [f, setF] = useState({});
  const sv = useSaver(toast, () => { setAdding(false); list.load(); });
  const [branches, setBranches] = useState([]);
  const [people, setPeople] = useState([]);
  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  const loadPeople = () => api.hr.rentParties({ active: 1 }).then((r) => setPeople(r.items)).catch(() => {});
  useEffect(() => { loadPeople(); }, []);
  const openAdd = () => { setF({ branch: '', party: '', month: monthNow(), landlord: '', rent: '', currentReading: '', meterPhoto: '', paidOn: today(), payMode: 'cash', bankAccount: '', reference: '', remark: '' }); sv.setErrors({}); loadPeople(); setAdding(true); };
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); sv.setErrors((x) => ({ ...x, [k]: undefined })); };
  const party = people.find((p) => p.id === f.party);
  const myBranch = f.branch || (branches.length === 1 ? branches[0].id : '');
  const choices = people.filter((p) => !myBranch || p.branch?.id === myBranch);
  const metered = party?.kind === 'room' && party.meterIncluded;
  const units = metered && f.currentReading !== '' ? Math.round((num(f.currentReading) - party.lastReading) * 100) / 100 : 0;
  const electricity = metered ? Math.round(Math.max(units, 0) * party.perUnit * 100) / 100 : 0;
  const rent = f.rent !== '' ? num(f.rent) : party ? party.amount : 0;
  const total = Math.round((rent + electricity) * 100) / 100;
  async function viewPhoto(r) {
    try { const x = await api.hr.roomRentPhoto(r.id); const w = window.open('', '_blank'); if (w && x.photo) w.document.write(`<img src="${x.photo}" style="max-width:100%">`); } catch (err) { toast.error(err.message); }
  }
  const items = list.data?.items || [];
  return (
    <>
      <PageHeader title="Room / Messenger Rent" description="The rent paid to a room owner or a messenger of a branch. For a room with an electricity meter the rent is the room rent plus the units used (current reading − old reading) at the rate per unit. Every entry is a payment in the Cashbook of the branch." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <Dates from={from} setFrom={setFrom} to={to} setTo={setTo} />
          <input type="search" placeholder="Search name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <Refresh onClick={list.load} loading={list.loading} />
          {admin && <button className="btn" onClick={() => setParties(true)}>Room owners / Messengers</button>}
          <button className="btn primary" onClick={openAdd}>New rent entry</button>
        </div>
        <Body list={list} empty="No rent entered for these dates.">{() => (<>
          <Summary items={[['Entries', list.data.summary.entries], ['Rent paid', inr(list.data.summary.amount)]]} />
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Paid on</th><th>Branch</th><th>Rent of</th><th>Paid to</th><th className="num">Rent</th><th className="num">Electricity</th><th className="num">Total</th><th>By</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Paid on">{dmy(r.paidOn)}</td><td data-label="Branch">{branchLabel(r.branch)}</td><td data-label="Rent of">{new Date(`${r.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</td>
                    <td data-label="Paid to">{r.landlord}{r.kind !== 'other' && <div className="muted small">{KIND[r.kind]}</div>}{r.remark && <div className="muted small">{r.remark}</div>}</td>
                    <td data-label="Rent" className="num">{inr(r.rent)}</td>
                    <td data-label="Electricity" className="num">{r.hasMeter ? <>{inr(r.electricity)}<div className="muted small">{r.prevReading} → {r.currentReading} = {r.units} units × {inr(r.perUnit)}</div><button className="btn sm" onClick={() => viewPhoto(r)}>Meter photo</button></> : '—'}</td>
                    <td data-label="Total" className="num"><strong>{inr(r.amount)}</strong></td>
                    <td data-label="By">{MODE_LABEL[r.payMode]}{r.reference ? ` · ${r.reference}` : ''}<div className="muted small">{r.by}</div></td>
                    <td data-label="Status"><Badge s={r.status} />{r.cancelReason && <div className="muted small">{r.cancelReason}</div>}</td>
                    <td>{r.status === 'paid' && <button className="btn sm danger-outline" onClick={() => setCancelling(r)}>Cancel</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}</Body>
      </div>
      {parties && <RentParties branches={branches} onClose={() => { setParties(false); loadPeople(); }} />}
      {adding && (
        <FormModal title="New rent entry" onClose={() => setAdding(false)} busy={sv.busy} saveLabel={`Pay ${total ? inr(total) : ''}`.trim()} onSave={() => sv.run(() => api.hr.createRoomRent({ ...f, bankAccount: f.payMode === 'bank' ? f.bankAccount : undefined, meterPhoto: metered ? f.meterPhoto : undefined, currentReading: metered ? f.currentReading : undefined }), 'Rent paid. It is in the Cashbook.')}>
          <div className="form-grid">
            {branches.length > 1 && <FormField id="rrb" label="Branch" required error={sv.errors.branch}><select id="rrb" value={f.branch} onChange={(e) => { setF((x) => ({ ...x, branch: e.target.value, party: '' })); }}><option value="">Select</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></FormField>}
            <FormField id="rrq" label="Room owner / Messenger" error={sv.errors.party} hint={choices.length ? '' : 'None registered for this branch: the admin registers them in Room owners / Messengers. Or type a name below.'}>
              <select id="rrq" value={f.party} onChange={(e) => setF((x) => ({ ...x, party: e.target.value, rent: '', currentReading: '', meterPhoto: '' }))}><option value="">Other (type the name)</option>{choices.map((p) => <option key={p.id} value={p.id}>{KIND[p.kind]}: {p.name}</option>)}</select>
            </FormField>
            <FormField id="rrm" label="Rent of the month" required error={sv.errors.month}><input id="rrm" type="month" value={f.month} onChange={set('month')} /></FormField>
            {!party && <FormField id="rrl" label="Name" required error={sv.errors.landlord}><input id="rrl" value={f.landlord} maxLength={80} onChange={set('landlord')} /></FormField>}
            <FormField id="rra" label={party?.kind === 'messenger' ? 'Amount (₹)' : 'Rent (₹)'} required error={sv.errors.rent} hint={party ? `Set for ${party.name}: ${inr(party.amount)}` : ''}><input id="rra" inputMode="decimal" value={f.rent} placeholder={party ? String(party.amount) : ''} onChange={(e) => { setF((x) => ({ ...x, rent: decimal(e.target.value) })); sv.setErrors((x) => ({ ...x, rent: undefined })); }} /></FormField>
            {metered && (
              <>
                <FormField id="rrold" label="Old meter reading"><input id="rrold" value={party.lastReading} readOnly /></FormField>
                <FormField id="rrcur" label="Current meter reading" required error={sv.errors.currentReading}><input id="rrcur" inputMode="decimal" value={f.currentReading} onChange={(e) => { setF((x) => ({ ...x, currentReading: decimal(e.target.value) })); sv.setErrors((x) => ({ ...x, currentReading: undefined })); }} /></FormField>
                <PhotoField id="rrph" label="Current meter reading photo" required value={f.meterPhoto} error={sv.errors.meterPhoto} onChange={(v) => setF((x) => ({ ...x, meterPhoto: v }))} />
                <div className="span-2 muted" style={{ alignSelf: 'center' }}>(Current − old) = {units > 0 ? units : 0} units × {inr(party.perUnit)} per unit = <strong>{inr(electricity)}</strong><br />Rent {inr(rent)} + electricity {inr(electricity)} = <strong>Total pay {inr(total)}</strong></div>
              </>
            )}
            <FormField id="rrd" label="Paid on" error={sv.errors.paidOn}><input id="rrd" type="date" max={today()} value={f.paidOn} onChange={set('paidOn')} /></FormField>
            <FormField id="rrp" label="Paid by" error={sv.errors.payMode}><select id="rrp" value={f.payMode} onChange={set('payMode')}>{Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FormField>
            <BankAccountSelect id="rrbank" mode={f.payMode} value={f.bankAccount} onChange={(v) => setF((x) => ({ ...x, bankAccount: v }))} error={sv.errors.bankAccount} />
            <FormField id="rrr" label="Reference no." hint="Optional"><input id="rrr" value={f.reference} maxLength={60} onChange={set('reference')} /></FormField>
            <FormField id="rrk" label="Remark" className="span-2"><input id="rrk" value={f.remark} maxLength={200} onChange={set('remark')} /></FormField>
          </div>
        </FormModal>
      )}
      {cancelling && <ReasonModal title="Cancel the rent entry" subject={`${cancelling.landlord} · ${inr(cancelling.amount)}. It is taken out of the Cashbook.`} confirm="Cancel entry" onClose={() => setCancelling(null)} onSend={async (reason) => { await api.hr.cancelRoomRent(cancelling.id, reason); toast.success('Entry cancelled'); setCancelling(null); list.load(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Task
const TASK_NEXT = { open: ['in_progress', 'done', 'cancelled'], in_progress: ['done', 'cancelled', 'open'], done: ['open'], cancelled: ['open'] };
const pendingBadge = (p, unit) => (p.pending > 0 ? <span className="badge danger">−{unit === 'inr' ? inr(p.pending) : p.pending}</span> : p.target > 0 ? <span className="badge green">done</span> : <span className="muted">—</span>);

function TargetForm({ onClose, onSaved }) {
  const toast = useToast();
  const [ranks, setRanks] = useState([]);
  const [f, setF] = useState({ fromDate: today(), toDate: today(), rank: '', newMember: '', d6: '', newGroup: '', npaRecovery: '', remark: '' });
  const sv = useSaver(toast, onSaved);
  useEffect(() => { api.hr.targetOptions().then((r) => setRanks(r.ranks)).catch(() => {}); }, []);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); sv.setErrors((x) => ({ ...x, [k]: undefined })); };
  const whole = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value.replace(/\D/g, '').slice(0, 6) })); sv.setErrors((x) => ({ ...x, [k]: undefined })); };
  return (
    <FormModal title="Give a target task" onClose={onClose} busy={sv.busy} onSave={() => sv.run(() => api.hr.createTargetTask(f), (r) => `Task given to ${r.item.employees.length} employee${r.item.employees.length === 1 ? '' : 's'}`)}>
      <div className="form-grid">
        <FormField id="ttf" label="From date" required error={sv.errors.fromDate}><input id="ttf" type="date" value={f.fromDate} onChange={set('fromDate')} /></FormField>
        <FormField id="ttt" label="To date" required error={sv.errors.toDate}><input id="ttt" type="date" min={f.fromDate} value={f.toDate} onChange={set('toDate')} /></FormField>
        <FormField id="ttr" label="Rank" required className="span-2" error={sv.errors.rank} hint="Every working employee of this rank (in your branches) gets the task"><select id="ttr" value={f.rank} onChange={set('rank')}><option value="">Select rank</option>{ranks.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}</select></FormField>
        <FormField id="ttm" label="New member — target" error={sv.errors.newMember}><input id="ttm" inputMode="numeric" value={f.newMember} onChange={whole('newMember')} /></FormField>
        <FormField id="ttd" label="D6 — target" error={sv.errors.d6} hint="Counted by hand"><input id="ttd" inputMode="numeric" value={f.d6} onChange={whole('d6')} /></FormField>
        <FormField id="ttg" label="New group — target" error={sv.errors.newGroup}><input id="ttg" inputMode="numeric" value={f.newGroup} onChange={whole('newGroup')} /></FormField>
        <FormField id="ttn" label="NPA recovery — target (₹)" error={sv.errors.npaRecovery}><input id="ttn" inputMode="decimal" value={f.npaRecovery} onChange={(e) => setF((x) => ({ ...x, npaRecovery: e.target.value.replace(/[^\d.]/g, '') }))} /></FormField>
        <FormField id="ttk" label="Remark" className="span-2"><input id="ttk" value={f.remark} maxLength={300} onChange={set('remark')} /></FormField>
      </div>
    </FormModal>
  );
}

function TargetTasks() {
  const toast = useToast();
  const [month, setMonth] = useState(monthNow());
  const list = useLoad(() => api.hr.targetTasks({ month }), [month]);
  const old = useLoad(() => api.hr.pendingOldTargets(), []);
  const [adding, setAdding] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const items = list.data?.items || [];
  async function d6(task, e, value) {
    try { await api.hr.setTargetD6(task.id, { employee: e.id, achieved: value }); list.load(); old.load(); } catch (err) { toast.error(err.errors?.achieved || err.message); }
  }
  async function cancel(task) {
    try { await api.hr.cancelTargetTask(task.id); toast.success('Task cancelled'); list.load(); old.load(); } catch (err) { toast.error(err.message); }
  }
  const oldItems = old.data?.items || [];
  return (
    <>
      <PageHeader title="Target Task" description="Give a task for a period (from date to date) rank wise: new member, D6, new group and NPA recovery targets. What an employee has achieved is counted from the work done under the employee code; what is still to be done shows as pending (−) and goes down as the work is done." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Month <input type="month" value={month} onChange={(e) => setMonth(e.target.value || monthNow())} aria-label="Month" /></label>
          <Refresh onClick={() => { list.load(); old.load(); }} loading={list.loading} />
          <button className="btn" onClick={() => setShowOld((x) => !x)}>Old tasks pending{oldItems.length ? ` (${oldItems.length})` : ''}</button>
          <button className="btn primary" onClick={() => setAdding(true)}>Give a target task</button>
        </div>
        {showOld && (
          <div className="notice" style={{ marginBottom: 12 }}>
            <strong>Employees with an old task still pending</strong>
            {oldItems.length === 0 ? <div className="muted small">None: every ended task is done.</div> : (
              <div className="table-wrap"><table className="data-table"><thead><tr><th>Employee</th><th>Period</th><th className="num">New member</th><th className="num">D6</th><th className="num">New group</th><th className="num">NPA recovery</th></tr></thead><tbody>
                {oldItems.flatMap((e) => e.tasks.map((t, i) => (
                  <tr key={`${e.code}${t.id}`}><td data-label="Employee">{i === 0 ? <><strong>{e.code}</strong> {e.name}</> : ''}</td><td data-label="Period">{dmy(t.from)} – {dmy(t.to)}</td><td data-label="New member" className="num">{t.newMember ? `−${t.newMember}` : '—'}</td><td data-label="D6" className="num">{t.d6 ? `−${t.d6}` : '—'}</td><td data-label="New group" className="num">{t.newGroup ? `−${t.newGroup}` : '—'}</td><td data-label="NPA recovery" className="num">{t.npaRecovery ? `−${inr(t.npaRecovery)}` : '—'}</td></tr>
                )))}
              </tbody></table></div>
            )}
          </div>
        )}
        <Body list={list} empty={`No target task in ${month}.`}>{() => items.map((t) => (
          <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12, opacity: t.status === 'cancelled' ? 0.6 : 1 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <div><strong>{dmy(t.fromDate)} – {dmy(t.toDate)}</strong> · {t.rank || 'Chosen employees'} <span className="muted small">by {t.by}</span>{t.remark && <div className="muted small">{t.remark}</div>}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge green">{t.summary.done} done</span><span className="badge danger">{t.summary.pending} pending</span>{t.status === 'cancelled' ? <Badge s="cancelled" /> : <button className="btn sm danger-outline" onClick={() => cancel(t)}>Cancel</button>}
              </div>
            </div>
            <div className="muted small" style={{ margin: '6px 0' }}>Target: New member {t.targets.newMember} · D6 {t.targets.d6} · New group {t.targets.newGroup} · NPA recovery {inr(t.targets.npaRecovery)}</div>
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Employee</th><th className="num">New member</th><th className="num">D6</th><th className="num">New group</th><th className="num">NPA recovery</th><th>Status</th></tr></thead>
              <tbody>
                {t.employees.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Employee"><strong>{e.code}</strong> {e.name}</td>
                    <td data-label="New member" className="num">{e.newMember.achieved}/{e.newMember.target} {pendingBadge(e.newMember)}</td>
                    <td data-label="D6" className="num"><input aria-label={`D6 of ${e.code}`} inputMode="numeric" defaultValue={e.d6.achieved} disabled={t.status === 'cancelled'} onBlur={(ev) => { const v = ev.target.value.replace(/\D/g, ''); if (v !== '' && Number(v) !== e.d6.achieved) d6(t, e, Number(v)); }} style={{ width: 56, textAlign: 'right' }} />/{e.d6.target} {pendingBadge(e.d6)}</td>
                    <td data-label="New group" className="num">{e.newGroup.achieved}/{e.newGroup.target} {pendingBadge(e.newGroup)}</td>
                    <td data-label="NPA recovery" className="num">{inr(e.npaRecovery.achieved)}/{inr(e.npaRecovery.target)} {pendingBadge(e.npaRecovery, 'inr')}</td>
                    <td data-label="Status"><span className={`badge ${e.status === 'done' ? 'green' : 'amber'}`}>{e.status === 'done' ? 'Done' : 'Pending'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        ))}</Body>
      </div>
      {adding && <TargetForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.load(); old.load(); }} />}
    </>
  );
}

export function Tasks() {
  const [tab, setTab] = useState('target');
  return (
    <>
      <div className="toolbar" style={{ gap: 8, marginBottom: 8 }}>
        <button className={`btn ${tab === 'target' ? 'primary' : ''}`} onClick={() => setTab('target')}>Target tasks</button>
        <button className={`btn ${tab === 'task' ? 'primary' : ''}`} onClick={() => setTab('task')}>Other tasks</button>
      </div>
      {tab === 'target' ? <TargetTasks /> : <PlainTasks />}
    </>
  );
}

function PlainTasks() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.hr.tasks({ branch, status, q }), [branch, status, q]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({});
  const [editing, setEditing] = useState(null);
  const [next, setNext] = useState({ status: '', remark: '' });
  const sv = useSaver(toast, () => { setAdding(false); setEditing(null); list.load(); });
  const items = list.data?.items || [];
  const s = list.data?.summary;
  return (
    <>
      <PageHeader title="Task" description="Tasks given to employees, with the date it is due and where it stands." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="active">Open and in progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option><option value="">All</option></select>
          <input type="search" placeholder="Search task, employee" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn primary" onClick={() => { setF({ employee: '', title: '', description: '', dueDate: '', priority: 'medium' }); sv.setErrors({}); setAdding(true); }}>Give a task</button>
        </div>
        <Body list={list} empty="No task for this filter.">{() => (<>
          <Summary items={[['Tasks', s.tasks], ['Open', s.open], ['In progress', s.inProgress], ['Done', s.done], ['Overdue', s.overdue]]} />
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Task</th><th>Given to</th><th>Branch</th><th>Due</th><th>Priority</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Task"><strong>{t.title}</strong>{t.description && <div className="muted small">{t.description}</div>}</td>
                    <td data-label="Given to">{t.assignedTo.code} {t.assignedTo.name}<div className="muted small">by {t.createdBy}</div></td>
                    <td data-label="Branch">{branchLabel(t.branch)}</td>
                    <td data-label="Due">{dmy(t.dueDate)}{t.overdue && <div><span className="badge danger">Overdue</span></div>}</td>
                    <td data-label="Priority"><span className={`badge ${t.priority === 'high' ? 'danger' : t.priority === 'medium' ? 'amber' : 'grey'}`}>{cap(t.priority)}</span></td>
                    <td data-label="Status"><Badge s={t.status} />{t.history.length > 1 && t.history[t.history.length - 1].remark && <div className="muted small">{t.history[t.history.length - 1].remark}</div>}</td>
                    <td><button className="btn sm" onClick={() => { setEditing(t); setNext({ status: '', remark: '' }); sv.setErrors({}); }}>Update</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}</Body>
      </div>
      {adding && (
        <FormModal title="Give a task" onClose={() => setAdding(false)} busy={sv.busy} onSave={() => sv.run(() => api.hr.createTask(f), 'Task given')}>
          <div className="form-grid">
            <EmployeePick id="tkemp" value={f.employee} onChange={(v) => setF((x) => ({ ...x, employee: v }))} error={sv.errors.employee} label="Give it to" />
            <FormField id="tkt" label="Task" required className="span-2" error={sv.errors.title}><input id="tkt" value={f.title} maxLength={120} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} /></FormField>
            <FormField id="tkd" label="Details" className="span-2"><input id="tkd" value={f.description} maxLength={500} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} /></FormField>
            <FormField id="tkdue" label="Due date" error={sv.errors.dueDate}><input id="tkdue" type="date" value={f.dueDate} onChange={(e) => setF((x) => ({ ...x, dueDate: e.target.value }))} /></FormField>
            <FormField id="tkp" label="Priority"><select id="tkp" value={f.priority} onChange={(e) => setF((x) => ({ ...x, priority: e.target.value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></FormField>
          </div>
        </FormModal>
      )}
      {editing && (
        <FormModal title={`Update: ${editing.title}`} onClose={() => setEditing(null)} busy={sv.busy} saveLabel="Update" onSave={() => sv.run(() => api.hr.setTaskStatus(editing.id, next), 'Task updated')}>
          <p className="muted">Now <Badge s={editing.status} /></p>
          <FormField id="tkst" label="New status" required error={sv.errors.status}><select id="tkst" value={next.status} onChange={(e) => setNext((x) => ({ ...x, status: e.target.value }))}><option value="">Select</option>{TASK_NEXT[editing.status].map((k) => <option key={k} value={k}>{cap(k)}</option>)}</select></FormField>
          <FormField id="tkrm" label="Remark"><input id="tkrm" value={next.remark} maxLength={300} onChange={(e) => setNext((x) => ({ ...x, remark: e.target.value }))} /></FormField>
          {editing.history.length > 0 && <div className="muted small" style={{ marginTop: 8 }}>{editing.history.map((h, i) => <div key={i}>{dmy(h.at)} · {cap(h.status)}{h.remark ? ` — ${h.remark}` : ''} ({h.by})</div>)}</div>}
        </FormModal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Toll free complaint entry
const CATS = [['loan', 'Loan'], ['emi', 'EMI'], ['staff', 'Staff behaviour'], ['insurance', 'Insurance'], ['other', 'Other']];
export function Complaints() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.hr.complaints({ branch, status, from, to, q }), [branch, status, from, to, q]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({});
  const [editing, setEditing] = useState(null);
  const [next, setNext] = useState({ status: '', resolution: '' });
  const [branches, setBranches] = useState([]);
  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  const sv = useSaver(toast, () => { setAdding(false); setEditing(null); list.load(); });
  const items = list.data?.items || [];
  const s = list.data?.summary;
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); sv.setErrors((x) => ({ ...x, [k]: undefined })); };
  return (
    <>
      <PageHeader title="Toll Free Complaint Entry" description="Complaints received on the toll free number: who called, what about, who looks into it and what was done." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select>
          <Dates from={from} setFrom={setFrom} to={to} setTo={setTo} />
          <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn primary" onClick={() => { setF({ date: today(), callerName: '', callerMobile: '', branch: '', memberCode: '', husbandName: '', groupCode: '', groupName: '', groupLeaderName: '', category: 'other', description: '', assignedTo: '' }); sv.setErrors({}); setAdding(true); }}>New complaint</button>
        </div>
        <Body list={list} empty="No complaint for these dates.">{() => (<>
          <Summary items={[['Complaints', s.complaints], ['Open', s.open], ['In progress', s.inProgress], ['Resolved', s.resolved]]} />
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Complaint</th><th>Caller</th><th>About</th><th>Branch</th><th>Looked into by</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Complaint"><strong>{c.complaintNo}</strong><div className="muted small">{dmy(c.date)}</div></td>
                    <td data-label="Caller">{c.callerName}<div className="muted small">{c.callerMobile}</div>{c.husbandName && <div className="muted small">Husband: {c.husbandName}</div>}{(c.groupCode || c.groupName) && <div className="muted small">Group: {[c.groupCode, c.groupName].filter(Boolean).join(' · ')}{c.groupLeaderName ? ` · Leader ${c.groupLeaderName}` : ''}</div>}</td>
                    <td data-label="About">{cap(c.category)}{c.memberCode ? ` · ${c.memberCode}` : ''}<div className="muted small">{c.description}</div></td>
                    <td data-label="Branch">{branchLabel(c.branch)}</td><td data-label="Looked into by">{c.assignedTo || '—'}</td>
                    <td data-label="Status"><Badge s={c.status} />{c.resolution && <div className="muted small">{c.resolution}</div>}</td>
                    <td><button className="btn sm" onClick={() => { setEditing(c); setNext({ status: '', resolution: '', assignedTo: '' }); sv.setErrors({}); }}>Update</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}</Body>
      </div>
      {adding && (
        <FormModal title="New toll free complaint" onClose={() => setAdding(false)} busy={sv.busy} onSave={() => sv.run(() => api.hr.createComplaint(f), (r) => `Complaint ${r.item.complaintNo} entered`)}>
          <div className="form-grid">
            <FormField id="cpd" label="Date" error={sv.errors.date}><input id="cpd" type="date" max={today()} value={f.date} onChange={set('date')} /></FormField>
            <FormField id="cpn" label="Caller name" required error={sv.errors.callerName}><input id="cpn" value={f.callerName} maxLength={80} onChange={set('callerName')} /></FormField>
            <FormField id="cpm" label="Caller mobile" error={sv.errors.callerMobile}><input id="cpm" inputMode="numeric" value={f.callerMobile} onChange={(e) => { setF((x) => ({ ...x, callerMobile: e.target.value.replace(/\D/g, '').slice(0, 10) })); sv.setErrors((x) => ({ ...x, callerMobile: undefined })); }} /></FormField>
            <FormField id="cpb" label="Branch" error={sv.errors.branch}><select id="cpb" value={f.branch} onChange={set('branch')}><option value="">Not known</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></FormField>
            <FormField id="cpmem" label="Member code" hint="Optional"><input id="cpmem" value={f.memberCode} maxLength={30} onChange={(e) => setF((x) => ({ ...x, memberCode: e.target.value.toUpperCase() }))} /></FormField>
            <FormField id="cphus" label="Husband name" hint="Optional"><input id="cphus" value={f.husbandName} maxLength={80} onChange={set('husbandName')} /></FormField>
            <FormField id="cpgc" label="Group code" hint="Optional"><input id="cpgc" value={f.groupCode} maxLength={30} onChange={(e) => setF((x) => ({ ...x, groupCode: e.target.value.toUpperCase() }))} /></FormField>
            <FormField id="cpgn" label="Group name" hint="Optional"><input id="cpgn" value={f.groupName} maxLength={80} onChange={set('groupName')} /></FormField>
            <FormField id="cpgl" label="Group leader name" hint="Optional"><input id="cpgl" value={f.groupLeaderName} maxLength={80} onChange={set('groupLeaderName')} /></FormField>
            <FormField id="cpc" label="About" error={sv.errors.category}><select id="cpc" value={f.category} onChange={set('category')}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></FormField>
            <FormField id="cpx" label="Complaint" required className="span-2" error={sv.errors.description}><input id="cpx" value={f.description} maxLength={1000} onChange={set('description')} /></FormField>
            {f.branch && <EmployeePick id="cpa" branch={f.branch} value={f.assignedTo} onChange={(v) => setF((x) => ({ ...x, assignedTo: v }))} label="Looked into by" error={sv.errors.assignedTo} />}
          </div>
        </FormModal>
      )}
      {editing && (
        <FormModal title={`${editing.complaintNo} — update`} onClose={() => setEditing(null)} busy={sv.busy} saveLabel="Update" onSave={() => sv.run(() => api.hr.setComplaintStatus(editing.id, next), 'Complaint updated')}>
          <p className="muted">{editing.callerName} · {editing.description}</p>
          <FormField id="cust" label="Status" required error={sv.errors.status}><select id="cust" value={next.status} onChange={(e) => setNext((x) => ({ ...x, status: e.target.value }))}><option value="">Select</option>{['open', 'in_progress', 'resolved'].map((k) => <option key={k} value={k}>{cap(k)}</option>)}</select></FormField>
          {editing.branch && <EmployeePick id="cuas" branch={editing.branch.id} value={next.assignedTo} onChange={(v) => setNext((x) => ({ ...x, assignedTo: v }))} label="Looked into by" onlyActive />}
          <FormField id="cures" label="What was done" error={sv.errors.resolution} hint="Required when resolving"><input id="cures" value={next.resolution} maxLength={500} onChange={(e) => setNext((x) => ({ ...x, resolution: e.target.value }))} /></FormField>
          {editing.history.length > 0 && <div className="muted small" style={{ marginTop: 8 }}>{editing.history.map((h, i) => <div key={i}>{dmy(h.at)} · {cap(h.status)}{h.remark ? ` — ${h.remark}` : ''} ({h.by})</div>)}</div>}
        </FormModal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Employee requirement
export function Requirements() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const list = useLoad(() => api.hr.requirements({ branch, status }), [branch, status]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({});
  const [opts, setOpts] = useState({ departments: [], designations: [] });
  const [branches, setBranches] = useState([]);
  const [rejecting, setRejecting] = useState(null);
  const sv = useSaver(toast, () => { setAdding(false); list.load(); });
  useEffect(() => { api.hr.options().then(setOpts).catch(() => {}); api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); sv.setErrors((x) => ({ ...x, [k]: undefined })); };
  const decide = async (r, st) => { try { await api.hr.decideRequirement(r.id, { status: st }); toast.success(`Marked ${st}`); list.load(); } catch (err) { toast.error(err.message); } };
  const items = list.data?.items || [];
  const s = list.data?.summary;
  return (
    <>
      <PageHeader title="Employee Requirement" description="A branch asks for new employees (how many, for which post and why). The admin approves it; when the posts are filled it is marked as filled." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option><option value="pending">Waiting</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="filled">Filled</option></select>
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn primary" onClick={() => { setF({ branch: '', department: '', designation: '', count: '1', reason: '', requiredBy: '', expectedTime: '' }); sv.setErrors({}); setAdding(true); }}>New requirement</button>
        </div>
        <Body list={list} empty="No requirement for this filter.">{() => (<>
          <Summary items={[['Requirements', s.requirements], ['Waiting', s.pending], ['Approved', s.approved], ['Posts open', s.positions]]} />
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Requirement</th><th>Branch</th><th>Post</th><th className="num">Needed</th><th>Required by</th><th>Expected time</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Requirement"><strong>{r.reqNo}</strong><div className="muted small">{r.reason}</div></td><td data-label="Branch">{branchLabel(r.branch)}</td>
                    <td data-label="Post">{r.designation || '—'}<div className="muted small">{r.department}</div></td><td data-label="Needed" className="num">{r.count}</td><td data-label="Required by">{dmy(r.requiredBy)}</td><td data-label="Expected time">{r.expectedTime || '—'}</td>
                    <td data-label="Status"><Badge s={r.status} />{r.remark && <div className="muted small">{r.remark}</div>}</td>
                    <td>
                      {r.status === 'pending' && <div style={{ display: 'flex', gap: 6 }}><button className="btn sm primary" onClick={() => decide(r, 'approved')}>Approve</button><button className="btn sm danger-outline" onClick={() => setRejecting(r)}>Reject</button></div>}
                      {r.status === 'approved' && <button className="btn sm" onClick={() => decide(r, 'filled')}>Mark filled</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}</Body>
      </div>
      {adding && (
        <FormModal title="New employee requirement" onClose={() => setAdding(false)} busy={sv.busy} onSave={() => sv.run(() => api.hr.createRequirement(f), (r) => `Requirement ${r.item.reqNo} sent`)}>
          <div className="form-grid">
            {branches.length > 1 && <FormField id="rqb" label="Branch" required error={sv.errors.branch}><select id="rqb" value={f.branch} onChange={set('branch')}><option value="">Select</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></FormField>}
            <FormField id="rqd" label="Department" error={sv.errors.department}><select id="rqd" value={f.department} onChange={set('department')}><option value="">Any</option>{opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
            <FormField id="rqs" label="Designation" error={sv.errors.designation}><select id="rqs" value={f.designation} onChange={set('designation')}><option value="">Any</option>{opts.designations.filter((d) => !f.department || !d.department || d.department === f.department).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
            <FormField id="rqc" label="How many" required error={sv.errors.count}><input id="rqc" inputMode="numeric" value={f.count} onChange={(e) => setF((x) => ({ ...x, count: e.target.value.replace(/\D/g, '').slice(0, 3) }))} /></FormField>
            <FormField id="rqby" label="Needed by" error={sv.errors.requiredBy}><input id="rqby" type="date" value={f.requiredBy} onChange={set('requiredBy')} /></FormField>
            <FormField id="rqet" label="Expected time" error={sv.errors.expectedTime} hint="In what time the employees should join, e.g. 15 days"><input id="rqet" value={f.expectedTime} maxLength={60} onChange={set('expectedTime')} /></FormField>
            <FormField id="rqr" label="Why" required className="span-2" error={sv.errors.reason}><input id="rqr" value={f.reason} maxLength={300} onChange={set('reason')} /></FormField>
          </div>
        </FormModal>
      )}
      {rejecting && <ReasonModal title="Reject the requirement" subject={`${rejecting.reqNo} · ${rejecting.count} × ${rejecting.designation || 'employee'} for ${rejecting.branch?.code}`} onClose={() => setRejecting(null)} onSend={async (remark) => { await api.hr.decideRequirement(rejecting.id, { status: 'rejected', remark }); toast.success('Rejected'); setRejecting(null); list.load(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Leave apply and leave approval
const LEAVE_TYPES = [['casual', 'Casual'], ['sick', 'Sick'], ['earned', 'Earned'], ['other', 'Other']];
export function LeaveApply() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const list = useLoad(() => api.hr.leaves({ branch, from: '' }), [branch]);
  const [f, setF] = useState({ employee: '', type: 'earned', from: today(), to: today(), reason: '' });
  const [bal, setBal] = useState(null);
  const balances = useLoad(() => api.hr.leaveBalances({ branch }), [branch]);
  const sv = useSaver(toast, () => { setF((x) => ({ ...x, employee: '', reason: '' })); setBal(null); list.load(); balances.load(); });
  useEffect(() => { if (!f.employee) { setBal(null); return; } api.hr.leaveBalance(f.employee).then((r) => setBal(r.balance)).catch(() => setBal(null)); }, [f.employee]);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); sv.setErrors((x) => ({ ...x, [k]: undefined })); };
  const items = list.data?.items || [];
  return (
    <>
      <PageHeader title="Leave Apply" description="The company gives Earned Leave (EL) only: 1 for every month, 12 in a financial year (April to March). Joined after the 15th of a month: EL starts from the next month. Old pending EL can be taken together, but no EL is given in advance. Sundays are the weekly off and are not counted. The leave waits for approval under Leave Approval." />
      <div className="panel" style={{ padding: 16 }}>
        <h3 className="section-title">Apply for leave</h3>
        <div className="form-grid">
          <EmployeePick id="lvemp" value={f.employee} onChange={(v) => setF((x) => ({ ...x, employee: v }))} error={sv.errors.employee} onBranch={setBranch} />
          <FormField id="lvt" label="Kind of leave" error={sv.errors.type}><input id="lvt" value="Earned leave (EL)" readOnly /></FormField>
          {bal && <p className="span-2" style={{ margin: 0 }}><strong>EL {bal.financialYear}:</strong> carried {bal.opening} + earned {bal.earned} − taken {bal.used} = <strong>{bal.available} available</strong>{!bal.joiningKnown && <span className="muted small"> (joining date not set: counted from the start of this financial year)</span>}</p>}
          <FormField id="lvf" label="From" required error={sv.errors.from}><input id="lvf" type="date" value={f.from} onChange={set('from')} /></FormField>
          <FormField id="lvto" label="To" required error={sv.errors.to}><input id="lvto" type="date" min={f.from} value={f.to} onChange={set('to')} /></FormField>
          <FormField id="lvr" label="Reason" required className="span-2" error={sv.errors.reason}><input id="lvr" value={f.reason} maxLength={300} onChange={set('reason')} /></FormField>
        </div>
        <button className="btn primary" onClick={() => sv.run(() => api.hr.applyLeave(f), (r) => `Leave of ${r.item.days} day${r.item.days === 1 ? '' : 's'} sent for approval`)} disabled={sv.busy || !f.employee}>{sv.busy ? 'Saving…' : 'Apply'}</button>
      </div>
      <div className="panel">
        <h3 className="section-title">EL balance{balances.data?.financialYear ? ` — financial year ${balances.data.financialYear}` : ''}</h3>
        <Body list={balances} empty="No employee.">{() => (
          <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>Employee</th><th>Branch</th><th className="num">Carried</th><th className="num">Earned</th><th className="num">Taken</th><th className="num">Available</th></tr></thead>
              <tbody>{balances.data.items.map((b) => <tr key={b.id}><td data-label="Employee"><strong>{b.employeeCode}</strong> {b.name}</td><td data-label="Branch">{branchLabel(b.branch)}</td><td data-label="Carried" className="num">{b.opening}</td><td data-label="Earned" className="num">{b.earned}</td><td data-label="Taken" className="num">{b.used}</td><td data-label="Available" className="num"><strong>{b.available}</strong></td></tr>)}</tbody>
            </table>
          </div>
        )}</Body>
      </div>
      <div className="panel">
        <h3 className="section-title">Leave applications</h3>
        <div className="toolbar"><BranchSelect value={branch} onChange={setBranch} /><Refresh onClick={list.load} loading={list.loading} /></div>
        <Body list={list} empty="No leave applied yet.">{() => (<>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Employee</th><th>Branch</th><th>Kind</th><th>From – To</th><th className="num">Days</th><th>Reason</th><th>Status</th></tr></thead>
              <tbody>
                {items.slice(0, 100).map((l) => (
                  <tr key={l.id}>
                    <td data-label="Employee"><strong>{l.employeeCode}</strong> {l.employeeName}</td><td data-label="Branch">{branchLabel(l.branch)}</td><td data-label="Kind">{cap(l.type)}</td><td data-label="From – To">{dmy(l.from)} – {dmy(l.to)}</td>
                    <td data-label="Days" className="num">{l.days}</td><td data-label="Reason">{l.reason}</td><td data-label="Status"><Badge s={l.status} />{l.rejectReason && <div className="muted small">{l.rejectReason}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}</Body>
      </div>
    </>
  );
}

export function LeaveApproval() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('pending');
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.hr.leaves({ branch, status, q, mine: mine ? 1 : '' }), [branch, status, q, mine]);
  const [rejecting, setRejecting] = useState(null);
  const [approving, setApproving] = useState(null);
  const items = list.data?.items || [];
  return (
    <>
      <PageHeader title="Leave Approval" description="A leave goes to the supervisor that was chosen when the employee was registered (they are told by mail and in the app). The supervisor, the branch manager or the admin approves or rejects it with a reason; the employee is told by mail and in the app. An approved leave is marked as Leave (paid) in the attendance of every working day of it." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="pending">Waiting for approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></select>
          <input type="search" placeholder="Search employee, supervisor, reason" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" style={{ minWidth: 220 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only the ones that came to me</label>
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        <Body list={list} empty="No leave for this filter.">{() => (<>
          <Summary items={[['Applications', list.data.summary.applications], ['Waiting', list.data.summary.pending], ['Approved days', list.data.summary.approvedDays]]} />
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Employee</th><th>Branch</th><th>Supervisor</th><th>Kind</th><th>From – To</th><th className="num">Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Employee"><strong>{l.employeeCode}</strong> {l.employeeName}<div className="muted small">applied by {l.appliedBy}</div></td><td data-label="Branch">{branchLabel(l.branch)}</td><td data-label="Supervisor">{l.approver || <span className="muted">none set</span>}</td><td data-label="Kind">{cap(l.type)}</td>
                    <td data-label="From – To">{dmy(l.from)} – {dmy(l.to)}</td><td data-label="Days" className="num">{l.days}</td><td data-label="Reason">{l.reason}</td>
                    <td data-label="Status"><Badge s={l.status} />{l.rejectReason && <div className="muted small">{l.rejectReason}</div>}{l.decisionRemark && <div className="muted small">{l.decisionRemark}</div>}{l.decidedBy && <div className="muted small">{l.decidedBy}</div>}</td>
                    <td>{l.status === 'pending' && <div style={{ display: 'flex', gap: 6 }}><button className="btn sm primary" onClick={() => setApproving(l)}>Approve</button><button className="btn sm danger-outline" onClick={() => setRejecting(l)}>Reject</button></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}</Body>
      </div>
      {approving && <ReasonModal title="Approve the leave" subject={`${approving.employeeCode} ${approving.employeeName}: ${dmy(approving.from)} – ${dmy(approving.to)} (${approving.days} day${approving.days === 1 ? '' : 's'})`} label="Remark (optional)" confirm="Approve" tone="primary" required={false} onClose={() => setApproving(null)} onSend={async (reason) => { await api.hr.decideLeave(approving.id, { status: 'approved', reason }); toast.success(`${approving.employeeCode}: leave approved. It is marked in the attendance.`); setApproving(null); list.load(); }} />}
      {rejecting && <ReasonModal title="Reject the leave" subject={`${rejecting.employeeCode} ${rejecting.employeeName}: ${dmy(rejecting.from)} – ${dmy(rejecting.to)}`} onClose={() => setRejecting(null)} onSend={async (reason) => { await api.hr.decideLeave(rejecting.id, { status: 'rejected', reason }); toast.success('Leave rejected'); setRejecting(null); list.load(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Resignation approval
export function Resignations() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('pending');
  const list = useLoad(() => api.hr.resignations({ branch, status }), [branch, status]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({});
  const [rejecting, setRejecting] = useState(null);
  const [approving, setApproving] = useState(null);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState('');
  const [busy, setBusy] = useState('');
  const sv = useSaver(toast, () => { setAdding(false); list.load(); });
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); sv.setErrors((x) => ({ ...x, [k]: undefined })); };
  async function approve() {
    setBusy(approving.id);
    setNoticeError('');
    try { await api.hr.decideResignation(approving.id, { status: 'approved', noticePeriodDate: notice }); toast.success(`${approving.employeeCode} is marked as left on ${dmy(notice)}`); setApproving(null); list.load(); } catch (err) { setNoticeError(err.errors?.noticePeriodDate || err.message); } finally { setBusy(''); }
  }
  const items = list.data?.items || [];
  return (
    <>
      <PageHeader title="Resignation Approval" description="Resignations of employees. When one is approved the employee is marked as left on the last working day, and the salary stops after it." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="pending">Waiting for approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></select>
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn primary" onClick={() => { setF({ employee: '', appliedOn: today(), lastWorkingDate: '', reason: '' }); sv.setErrors({}); setAdding(true); }}>Add a resignation</button>
        </div>
        <Body list={list} empty="No resignation for this filter.">{() => (<>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Employee</th><th>Branch</th><th>Resigned on</th><th>Last working day</th><th>Notice period till</th><th>Reason</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Employee"><strong>{r.employeeCode}</strong> {r.employeeName}</td><td data-label="Branch">{branchLabel(r.branch)}</td><td data-label="Resigned on">{dmy(r.appliedOn)}</td><td data-label="Last working day">{dmy(r.lastWorkingDate)}</td><td data-label="Notice period till">{r.noticePeriodDate ? dmy(r.noticePeriodDate) : <span className="muted">set when approving</span>}</td><td data-label="Reason">{r.reason}</td>
                    <td data-label="Status"><Badge s={r.status} />{r.rejectReason && <div className="muted small">{r.rejectReason}</div>}{r.decidedBy && <div className="muted small">{r.decidedBy}</div>}</td>
                    <td>{r.status === 'pending' && <div style={{ display: 'flex', gap: 6 }}><button className="btn sm primary" disabled={busy === r.id} onClick={() => { setApproving(r); setNotice(r.lastWorkingDate || today()); setNoticeError(''); }}>Approve</button><button className="btn sm danger-outline" onClick={() => setRejecting(r)}>Reject</button></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}</Body>
      </div>
      {adding && (
        <FormModal title="Add a resignation" onClose={() => setAdding(false)} busy={sv.busy} onSave={() => sv.run(() => api.hr.applyResignation(f), 'Resignation sent for approval')}>
          <div className="form-grid">
            <EmployeePick id="rsemp" value={f.employee} onChange={(v) => setF((x) => ({ ...x, employee: v }))} error={sv.errors.employee} />
            <FormField id="rsd" label="Resigned on" error={sv.errors.appliedOn}><input id="rsd" type="date" max={today()} value={f.appliedOn} onChange={set('appliedOn')} /></FormField>
            <FormField id="rsl" label="Last working day" required error={sv.errors.lastWorkingDate}><input id="rsl" type="date" min={f.appliedOn} value={f.lastWorkingDate} onChange={set('lastWorkingDate')} /></FormField>
            <FormField id="rsr" label="Reason" required className="span-2" error={sv.errors.reason}><input id="rsr" value={f.reason} maxLength={300} onChange={set('reason')} /></FormField>
          </div>
        </FormModal>
      )}
      {approving && (
        <FormModal title="Approve the resignation" onClose={() => setApproving(null)} busy={busy === approving.id} saveLabel="Approve" onSave={approve}>
          <p className="muted">{approving.employeeCode} {approving.employeeName} resigned on {dmy(approving.appliedOn)}; the last working day asked for is {dmy(approving.lastWorkingDate)}.</p>
          <FormField id="rsnp" label="Notice period date" required error={noticeError} hint="The date the notice period ends: the employee is marked as left on it and the salary stops after it"><input id="rsnp" type="date" min={approving.appliedOn} value={notice} onChange={(e) => setNotice(e.target.value)} /></FormField>
        </FormModal>
      )}
      {rejecting && <ReasonModal title="Reject the resignation" subject={`${rejecting.employeeCode} ${rejecting.employeeName}`} onClose={() => setRejecting(null)} onSend={async (reason) => { await api.hr.decideResignation(rejecting.id, { status: 'rejected', reason }); toast.success('Rejected'); setRejecting(null); list.load(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Letters
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function printLetter({ company, title, paragraphs, to, ref, date }) {
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:Georgia,serif;margin:40px 56px;color:#111;line-height:1.55;font-size:15px}
    .head{text-align:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:22px}.head h1{margin:0;font-size:22px}.head div{font-size:13px}
    .row{display:flex;justify-content:space-between;margin-bottom:14px}.sign{margin-top:56px}.sign img{max-height:60px;display:block}.stamp{float:right;max-height:90px}
    h2{text-align:center;text-decoration:underline;font-size:16px;margin:18px 0}
  </style></head><body>
    <div class="head"><h1>${esc(company?.name || 'Company')}</h1><div>${esc([company?.address, company?.city, company?.state, company?.pincode].filter(Boolean).join(', '))}</div><div>${esc([company?.mobile, company?.email].filter(Boolean).join(' · '))}</div></div>
    <div class="row"><span>Ref: ${esc(ref)}</span><span>Date: ${esc(date)}</span></div>
    <div>To,<br><strong>${esc(to.name)}</strong> (${esc(to.code)})<br>${esc(to.address || '')}</div>
    <h2>${esc(title)}</h2>
    ${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
    <div class="sign">${company?.stamp ? `<img class="stamp" src="${company.stamp}" alt="">` : ''}Yours faithfully,<br>${company?.signature ? `<img src="${company.signature}" alt="">` : '<br><br>'}<strong>Authorised signatory</strong><br>${esc(company?.name || '')}</div>
    <script>window.onload=function(){window.print();}</script></body></html>`);
  w.document.close();
  return true;
}
const fmtDate = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

export function Letters() {
  const toast = useToast();
  const [emp, setEmp] = useState('');
  const kind = 'joining'; // only the joining letter is made
  const [employees, setEmployees] = useState([]);
  const [company, setCompany] = useState(null);
  const [branch, setBranch] = useState('');
  useEffect(() => { api.hr.letterhead().then((r) => setCompany(r.company)).catch(() => {}); }, []);
  useEffect(() => { if (branch) api.hr.employees({ branch, status: '' }).then((r) => setEmployees(r.items)).catch(() => {}); }, [branch]);
  const e = employees.find((x) => x.id === emp);
  function compose() {
    const post = `${e.designation?.name || 'Employee'}${e.department ? ` in the ${e.department.name} department` : ''}`;
    const salary = e.monthlySalary ? ` Your monthly salary will be ${inr(e.monthlySalary)}.` : '';
    const co = company?.name || 'the company';
    return kind === 'joining'
      ? { title: 'Joining Letter', paragraphs: [`Dear ${e.name},`, `This is to confirm that you joined ${co} on ${fmtDate(e.joiningDate) || 'the date of joining'} as ${post}, at the ${e.branch?.name || ''} branch. Your employee code is ${e.employeeCode}.${salary}`, 'You are expected to follow the rules and policies of the company and to report to your branch manager. We wish you a successful career with us.'] }
      : { title: 'Appointment Letter', paragraphs: [`Dear ${e.name},`, `We are pleased to appoint you as ${post} of ${co}, at the ${e.branch?.name || ''} branch, with effect from ${fmtDate(e.joiningDate) || 'the date of joining'}. Your employee code is ${e.employeeCode}.${salary}`, 'Your appointment is subject to the rules and policies of the company and to the satisfactory verification of your documents. Please sign and return a copy of this letter as your acceptance.'] };
  }
  function print() {
    const c = compose();
    const ok = printLetter({ company, title: c.title, paragraphs: c.paragraphs, to: { name: e.name, code: e.employeeCode, address: e.address }, ref: `${kind === 'joining' ? 'JL' : 'AL'}/${e.employeeCode}`, date: fmtDate(today()) });
    if (!ok) toast.error('Allow pop-ups to print the letter');
  }
  return (
    <>
      <PageHeader title="Joining Letter" description="Make the joining letter of an employee on the company letterhead (with the stamp and signature of the Company Profile) and print it." />
      <div className="panel" style={{ padding: 16 }}>
        {!company && <div className="notice" style={{ marginBottom: 8 }}>The Company Profile is not filled in yet (Admin Master → Company Profile). The letter will have no letterhead.</div>}
        <div className="form-grid">
          <BranchSelectField value={branch} onChange={(v) => { setBranch(v); setEmp(''); }} />
          <FormField id="ltemp" label="Employee" required><select id="ltemp" value={emp} onChange={(ev) => setEmp(ev.target.value)}><option value="">{branch ? 'Select' : 'Select the branch first'}</option>{employees.map((x) => <option key={x.id} value={x.id}>{staffLabel(x)}</option>)}</select></FormField>
        </div>
        {e && (
          <div style={{ border: '1px solid var(--border, #d8dee2)', borderRadius: 8, padding: 16, margin: '12px 0', maxWidth: 720 }}>
            <strong>{compose().title}</strong>
            {compose().paragraphs.map((p, i) => <p key={i} style={{ margin: '8px 0' }}>{p}</p>)}
          </div>
        )}
        <button className="btn primary" onClick={print} disabled={!e}>Print the letter</button>
      </div>
    </>
  );
}
function BranchSelectField({ value, onChange }) {
  const [branches, setBranches] = useState([]);
  useEffect(() => { api.groups.branchOptions().then((r) => { setBranches(r.items); if (r.items.length === 1) onChange(r.items[0].id); }).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <FormField id="ltbr" label="Branch" required><select id="ltbr" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></FormField>;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Promotion and transfer
const SALARY_BOXES = [['basic', 'Basic'], ['hra', 'HRA'], ['ta', 'TA'], ['allowance', 'Allowance'], ['da', 'DA'], ['fuel', 'Fuel'], ['transport', 'Transport allowance'], ['bike', 'Bike repair'], ['otherAllowance', 'Other allowance']];
export function PromotionTransfer() {
  const toast = useToast();
  const [kind, setKind] = useState('');
  const list = useLoad(() => api.hr.changes({ kind }), [kind]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({});
  const [opts, setOpts] = useState({ departments: [], designations: [] });
  const [branches, setBranches] = useState([]);
  const [company, setCompany] = useState(null);
  const sv = useSaver(toast, () => { setAdding(false); list.load(); });
  useEffect(() => { api.hr.options().then(setOpts).catch(() => {}); api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); api.hr.letterhead().then((r) => setCompany(r.company)).catch(() => {}); }, []);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); sv.setErrors((x) => ({ ...x, [k]: undefined })); };
  function letter(c) {
    const promo = c.kind === 'promotion';
    const paragraphs = [`Dear ${c.employeeName},`, promo
      ? `We are pleased to inform you that you are promoted from ${c.fromDesignation || 'your present post'} to ${c.toDesignation} with effect from ${fmtDate(c.effectiveDate)}.${c.toSalary && c.toSalary !== c.fromSalary ? ` Your monthly salary is revised from ${inr(c.fromSalary)} to ${inr(c.toSalary)}.` : ''}`
      : `You are transferred from ${c.fromBranch} to ${c.toBranch} with effect from ${fmtDate(c.effectiveDate)}. Please hand over your charge and report to the new branch on that date.`,
    ...(c.salaryLines?.length ? [`Your salary: ${c.salaryLines.map((l) => `${l.label} ${inr(l.amount)}`).join(', ')}; monthly total ${inr(c.toSalary)}.`] : []), ...(c.remark ? [c.remark] : []), 'We wish you every success.'];
    if (!printLetter({ company, title: promo ? 'Promotion Letter' : 'Transfer Letter', paragraphs, to: { name: c.employeeName, code: c.employeeCode }, ref: c.letterNo, date: fmtDate(today()) })) toast.error('Allow pop-ups to print the letter');
  }
  const items = list.data?.items || [];
  return (
    <>
      <PageHeader title="Promotion & Transfer" description="Promote an employee (new designation, and a new salary if it changes) or transfer one to another branch. It is applied to the employee at once; a letter with a number is made, ready to print." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="">Promotion and transfer</option><option value="promotion">Promotion</option><option value="transfer">Transfer</option></select>
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn primary" onClick={() => { setF({ employee: '', kind: 'promotion', toDesignation: '', toSalary: '', salaryLines: [], toBranch: '', effectiveDate: today(), remark: '' }); sv.setErrors({}); setAdding(true); }}>New promotion / transfer</button>
        </div>
        <Body list={list} empty="No promotion or transfer yet.">{() => (<>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Letter</th><th>Employee</th><th>Kind</th><th>Change</th><th>From</th><th /></tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Letter"><strong>{c.letterNo}</strong></td><td data-label="Employee">{c.employeeCode} {c.employeeName}</td><td data-label="Kind"><span className={`badge ${c.kind === 'promotion' ? 'green' : 'grey'}`}>{cap(c.kind)}</span></td>
                    <td data-label="Change">{c.kind === 'promotion' ? <>{c.fromDesignation || '—'} → <strong>{c.toDesignation}</strong>{c.toSalary !== c.fromSalary && <div className="muted small">{inr(c.fromSalary)} → {inr(c.toSalary)}</div>}{c.salaryLines?.length > 0 && <div className="muted small">{c.salaryLines.map((l) => `${l.label} ${inr(l.amount)}`).join(' · ')}</div>}</> : <>{c.fromBranch} → <strong>{c.toBranch}</strong></>}</td>
                    <td data-label="From">{dmy(c.effectiveDate)}<div className="muted small">by {c.by}</div></td>
                    <td><button className="btn sm" onClick={() => letter(c)}>Letter</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}</Body>
      </div>
      {adding && (
        <FormModal title="New promotion / transfer" onClose={() => setAdding(false)} busy={sv.busy} onSave={() => sv.run(() => api.hr.createChange(f), (r) => `${cap(r.item.kind)} done — letter ${r.item.letterNo}`)}>
          <div className="form-grid">
            <FormField id="pckind" label="Kind" required error={sv.errors.kind}><select id="pckind" value={f.kind} onChange={set('kind')}><option value="promotion">Promotion</option><option value="transfer">Transfer</option></select></FormField>
            <FormField id="pcdate" label="With effect from" required error={sv.errors.effectiveDate}><input id="pcdate" type="date" value={f.effectiveDate} onChange={set('effectiveDate')} /></FormField>
            <EmployeePick id="pcemp" value={f.employee} onChange={(v) => setF((x) => ({ ...x, employee: v }))} error={sv.errors.employee} />
            {f.kind === 'promotion' ? (
              <>
                <FormField id="pcdes" label="New designation" required error={sv.errors.toDesignation}><select id="pcdes" value={f.toDesignation} onChange={set('toDesignation')}><option value="">Select</option>{opts.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FormField>
                <div className="span-2">
                  <strong>Salary boxes</strong> <span className="muted small">— add a box for every part of the salary that changes; the employee gets it by mail and in the app</span>
                  {(f.salaryLines || []).map((l, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                      <select aria-label="Salary box" value={l.key} onChange={(e) => setF((x) => ({ ...x, salaryLines: x.salaryLines.map((y, j) => (j === i ? { ...y, key: e.target.value } : y)) }))}>{SALARY_BOXES.map(([k, label]) => <option key={k} value={k} disabled={(f.salaryLines || []).some((y, j) => j !== i && y.key === k)}>{label}</option>)}</select>
                      <input aria-label="Amount" inputMode="decimal" placeholder="₹ amount" value={l.amount} onChange={(e) => setF((x) => ({ ...x, salaryLines: x.salaryLines.map((y, j) => (j === i ? { ...y, amount: e.target.value.replace(/[^\d.]/g, '') } : y)) }))} style={{ width: 130 }} />
                      <button type="button" className="btn sm danger-outline" onClick={() => setF((x) => ({ ...x, salaryLines: x.salaryLines.filter((_, j) => j !== i) }))}>Remove</button>
                    </div>
                  ))}
                  <div style={{ marginTop: 6 }}><button type="button" className="btn sm" disabled={(f.salaryLines || []).length >= SALARY_BOXES.length} onClick={() => setF((x) => ({ ...x, salaryLines: [...(x.salaryLines || []), { key: (SALARY_BOXES.find(([k]) => !(x.salaryLines || []).some((y) => y.key === k)) || [''])[0], amount: '' }] }))}>+ Add salary box</button></div>
                  {sv.errors.salaryLines && <div className="field-error small">{sv.errors.salaryLines}</div>}
                </div>
                <FormField id="pcsal" label="New monthly salary (₹)" hint="Leave empty if it does not change" error={sv.errors.toSalary}><input id="pcsal" inputMode="decimal" value={f.toSalary} onChange={(e) => setF((x) => ({ ...x, toSalary: e.target.value.replace(/[^\d.]/g, '') }))} /></FormField>
              </>
            ) : (
              <FormField id="pcbr" label="Transfer to branch" required error={sv.errors.toBranch}><select id="pcbr" value={f.toBranch} onChange={set('toBranch')}><option value="">Select</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></FormField>
            )}
            <FormField id="pcrem" label="Remark (printed in the letter)" className="span-2"><input id="pcrem" value={f.remark} maxLength={300} onChange={set('remark')} /></FormField>
          </div>
        </FormModal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Employee list and block
export function EmployeeList() {
  const toast = useToast();
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.hr.employees({ branch, status, q }), [branch, status, q]);
  const [blocking, setBlocking] = useState(null);
  const items = list.data?.items || [];
  async function unblock(e) {
    try { await api.hr.blockEmployee(e.id, { block: false }); toast.success(`${e.employeeCode} is unblocked`); list.load(); } catch (err) { toast.error(err.message); }
  }
  return (
    <>
      <PageHeader title="Employee List & Block" description="All employees. Blocking an employee stops the staff login and the app of that employee at once; unblock gives it back." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <BranchSelect value={branch} onChange={setBranch} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All</option><option value="active">Working</option><option value="left">Left</option></select>
          <input type="search" placeholder="Search name, code, mobile" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" style={{ minWidth: 200 }} />
          <Refresh onClick={list.load} loading={list.loading} />
        </div>
        <Body list={list} empty="No employee for this filter.">{() => (<>
          <Summary items={[['Employees', list.data.summary.employees], ['Working', list.data.summary.active], ['Blocked', items.filter((e) => e.isBlocked).length]]} />
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Employee</th><th>Department · Designation</th><th>Branch</th><th>Mobile</th><th>Status</th><th /></tr></thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Employee"><strong>{e.employeeCode}</strong> {e.name}{e.hasLogin && <div className="muted small">has login</div>}</td>
                    <td data-label="Department">{e.department?.name || '—'}<div className="muted small">{e.designation?.name || '—'}</div></td>
                    <td data-label="Branch">{branchLabel(e.branch)}</td><td data-label="Mobile">{e.mobile || '—'}</td>
                    <td data-label="Status">{e.isBlocked ? <><span className="badge danger">Blocked</span><div className="muted small">{e.blockReason}</div></> : <span className={`badge ${e.status === 'active' ? 'green' : 'grey'}`}>{e.status === 'active' ? 'Working' : `Left ${dmy(e.leftOn)}`}</span>}</td>
                    <td>{e.isBlocked ? <button className="btn sm" onClick={() => unblock(e)}>Unblock</button> : <button className="btn sm danger-outline" onClick={() => setBlocking(e)}>Block</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}</Body>
      </div>
      {blocking && <ReasonModal title="Block the employee" subject={`${blocking.employeeCode} ${blocking.name}${blocking.hasLogin ? ': the staff login and the app stop working at once.' : '.'}`} confirm="Block" onClose={() => setBlocking(null)} onSend={async (reason) => { await api.hr.blockEmployee(blocking.id, { block: true, reason }); toast.success('Employee blocked'); setBlocking(null); list.load(); }} />}
    </>
  );
}

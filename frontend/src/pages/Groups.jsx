import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { useNavigate } from 'react-router-dom';
import GroupFields, { MEETING_LABEL, WEEKDAYS, collectionLabel, formatTime, todayISO, validateGroup } from '../components/GroupFields.jsx';
import { todayIso } from '../utils/format.js';

const LIMIT = 25;
const ADMINS = ['super_admin', 'admin'];
const MANAGERS = [...ADMINS, 'branch_manager', 'loan_officer', 'field_officer'];
const thisMonth = () => todayIso().slice(0, 7);

function GroupForm({ item, branches, isAdmin, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    branch: item.branchId,
    name: item.name,
    openingDate: item.openingDate || todayISO(),
    employeeCode: item.employeeCode || '',
    leaderName: item.leaderName,
    leaderMobile: item.leaderMobile,
    meetingType: item.meetingType || '',
    collectionDay: item.collectionDay ? String(item.collectionDay) : '',
    meetingTime: item.meetingTime || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const found = validateGroup(form, { isEdit: true, mobileLocked: !isAdmin });
    setErrors(found);
    if (Object.keys(found).length) return toast.error('Please correct the highlighted fields');
    setSaving(true);
    try {
      await api.groups.update(item.id, { ...form, name: form.name.trim(), leaderName: form.leaderName.trim() });
      toast.success('Group updated');
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={`Edit group — ${item.code}`}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="grp-form" disabled={saving}>{saving ? 'Saving…' : 'Update group'}</button>
        </>
      }
    >
      <form id="grp-form" onSubmit={submit} noValidate>
        <GroupFields form={form} setForm={setForm} errors={errors} setErrors={setErrors} branches={branches} isAdmin={isAdmin} isEdit groupCode={item.code} branchLocked />
      </form>
    </Modal>
  );
}

// Interim input of how many loans the group had disbursed each month (until the Loans module exists).
// The branch changes only the meeting type, the collection day and the meeting time of a group.
// The branch picks the member of the group who becomes the leader; the request goes to the admin.
function LeaderRequestDialog({ item, onClose, onSent }) {
  const toast = useToast();
  const [members, setMembers] = useState(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.groups.get(item.id).then((r) => setMembers(r.members || [])).catch((err) => { setMembers([]); setError(err.message); });
  }, [item.id]);

  async function submit(e) {
    e.preventDefault();
    if (!pick) { setError('Select the member who becomes the leader'); return; }
    setSaving(true);
    try {
      await api.groups.requestLeader(item.id, pick);
      toast.success('Request sent to the admin');
      onSent();
    } catch (err) {
      setError(err.errors?.memberId || err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Change group leader — ${item.code} ${item.name}`} onClose={onClose} busy={saving}
      footer={<><button className="btn" onClick={onClose} disabled={saving}>Cancel</button><button className="btn primary" form="leader-form" type="submit" disabled={saving || !pick}>{saving ? 'Sending…' : 'Submit request'}</button></>}>
      <form id="leader-form" onSubmit={submit} noValidate>
        <p className="muted small" style={{ marginTop: 0 }}>
          Current leader: <strong>{item.leaderName || 'Not recorded'}</strong>{item.leaderMobile ? ` · ${item.leaderMobile}` : ''}. Select the member of this group who becomes the leader. The request goes to the admin; when it is approved, the leader name and mobile of the group become that member's name and mobile.
        </p>
        {error && <div className="notice warn" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
        {members === null ? <Spinner label="Loading members…" /> : members.length === 0 ? <p className="muted">This group has no members.</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th style={{ width: 40 }} /><th>Member</th><th>Mobile</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} style={m.isBlocked ? { opacity: 0.6 } : undefined}>
                    <td><input type="radio" name="leaderPick" aria-label={`Select ${m.name}`} checked={pick === m.id} disabled={m.isBlocked} onChange={() => { setPick(m.id); setError(''); }} /></td>
                    <td><strong>{m.name}</strong><div className="muted small">{m.code}{m.isBlocked ? ' · blocked' : ''}</div></td>
                    <td>{m.mobile || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </form>
    </Modal>
  );
}

// Admin: the leader change requests of the branches, approve or reject.
function LeaderRequestsDialog({ onClose, onChanged }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const load = useCallback(() => api.groups.leaderRequests({ status: 'pending' }).then((r) => setItems(r.items || [])).catch((err) => { setItems([]); setError(err.message); }), []);
  useEffect(() => { load(); }, [load]);

  async function decide(it, approve) {
    let reason = '';
    if (!approve) {
      reason = window.prompt('Reason for rejecting (optional)') ?? null;
      if (reason === null) return;
    }
    setBusyId(it.id);
    try {
      if (approve) await api.groups.approveLeader(it.id); else await api.groups.rejectLeader(it.id, reason);
      toast.success(approve ? `${it.memberName} is now the leader of ${it.groupCode}` : 'Request rejected');
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <Modal open title="Group leader change requests" onClose={onClose} size="lg" footer={<button className="btn" onClick={onClose}>Close</button>}>
      {error && <div className="notice warn" role="alert">{error}</div>}
      {items === null ? <Spinner label="Loading…" /> : items.length === 0 ? <p className="muted">No request is waiting.</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Group</th><th>Present leader</th><th>New leader</th><th>Asked by</th><th className="actions-col">Action</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td><strong>{it.groupCode}</strong><div className="muted small">{it.groupName}{it.branch ? ` · ${it.branch.code}` : ''}</div></td>
                  <td>{it.oldLeaderName || 'Not recorded'}<div className="muted small">{it.oldLeaderMobile}</div></td>
                  <td><strong>{it.memberName}</strong><div className="muted small">{it.memberCode} · {it.memberMobile}</div></td>
                  <td>{it.requestedBy || '—'}<div className="muted small">{it.requestedAt ? new Date(it.requestedAt).toLocaleDateString('en-IN') : ''}</div></td>
                  <td className="actions-col">
                    <div className="row-actions">
                      <button className="btn sm primary" disabled={busyId === it.id} onClick={() => decide(it, true)}>Approve</button>
                      <button className="btn sm danger-outline" disabled={busyId === it.id} onClick={() => decide(it, false)}>Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function ScheduleDialog({ item, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ meetingType: item.meetingType || '', collectionDay: item.collectionDay ? String(item.collectionDay) : '', meetingTime: item.meetingTime || '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value, ...(key === 'meetingType' ? { collectionDay: '' } : {}) }));
    setErrors((x) => ({ ...x, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!form.meetingType) found.meetingType = 'Select the meeting type';
    if ((form.meetingType === 'weekly' || form.meetingType === 'monthly') && !form.collectionDay) found.collectionDay = form.meetingType === 'weekly' ? 'Select the collection day' : 'Select the day of the month';
    if (!/^\d{2}:\d{2}$/.test(form.meetingTime)) found.meetingTime = 'Enter the meeting time';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await api.groups.updateSchedule(item.id, form);
      toast.success('Meeting schedule changed');
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Meeting — ${item.code} ${item.name}`} onClose={onClose} busy={saving}
      footer={<><button className="btn" onClick={onClose} disabled={saving}>Cancel</button><button className="btn primary" form="schedule-form" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <form id="schedule-form" onSubmit={submit} noValidate>
        <p className="muted small" style={{ marginTop: 0 }}>The branch can change only the meeting type, the collection day and the meeting time. Other details of the group are changed by an admin.</p>
        <div className="form-grid">
          <FormField id="smeetingType" label="Meeting type" required error={errors.meetingType}>
            <select id="smeetingType" value={form.meetingType} onChange={set('meetingType')}>
              <option value="">Select</option>
              {Object.entries(MEETING_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FormField>
          <FormField id="scollectionDay" label="Meeting day" required={form.meetingType === 'weekly' || form.meetingType === 'monthly'} error={errors.collectionDay} hint={form.meetingType === 'daily' ? 'Collection happens every day' : !form.meetingType ? 'Select the meeting type first' : undefined}>
            <select id="scollectionDay" value={form.collectionDay} onChange={set('collectionDay')} disabled={form.meetingType !== 'weekly' && form.meetingType !== 'monthly'}>
              <option value="">{form.meetingType === 'daily' ? 'Every day' : 'Select day'}</option>
              {form.meetingType === 'weekly' && WEEKDAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              {form.meetingType === 'monthly' && Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>Day {i + 1}</option>)}
            </select>
          </FormField>
          <FormField id="smeetingTime" label="Meeting time" required error={errors.meetingTime}>
            <input id="smeetingTime" type="time" value={form.meetingTime} onChange={set('meetingTime')} />
          </FormField>
        </div>
        <p className="muted small">A group that meets daily can take daily schemes only, a weekly group weekly ones, a monthly group monthly ones. Loans that are running keep their own repayment mode.</p>
      </form>
    </Modal>
  );
}

function DisbursementDialog({ group, canEdit, onClose }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(thisMonth());
  const [loans, setLoans] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await api.groups.disbursements(group.id)).items);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [group.id, toast]);
  useEffect(() => {
    load();
  }, [load]);

  async function save(m, n) {
    setSaving(true);
    setError('');
    try {
      await api.groups.saveDisbursement(group.id, m, n);
      toast.success('Disbursement saved. Commission updated.');
      setLoans('');
      await load();
    } catch (err) {
      setError(err.errors?.month || err.errors?.loans || err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Loan disbursements — ${group.name}`} onClose={onClose} busy={saving} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Number of loans disbursed to this group in a month. The group leader earns commission on these loans from the next month.
      </p>
      {canEdit && (
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <FormField id="d-month" label="Month">
            <input id="d-month" type="month" max={thisMonth()} value={month} onChange={(e) => setMonth(e.target.value)} />
          </FormField>
          <FormField id="d-loans" label="Loans disbursed" error={error}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="d-loans" type="number" min="0" step="1" value={loans} onChange={(e) => { setLoans(e.target.value); setError(''); }} />
              <button className="btn primary" disabled={saving || loans === '' || !month} onClick={() => save(month, Number(loans))}>
                Save
              </button>
            </div>
          </FormField>
        </div>
      )}
      {loading ? (
        <Spinner label="Loading…" />
      ) : items.length === 0 ? (
        <EmptyState title="No disbursements entered yet" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Month</th><th className="num">Loans</th>{canEdit && <th className="actions-col">Actions</th>}</tr></thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td data-label="Month">{d.month}</td>
                  <td data-label="Loans" className="num">{d.loans}</td>
                  {canEdit && (
                    <td data-label="Actions" className="actions-col">
                      <div className="row-actions">
                        <button className="btn sm" onClick={() => { setMonth(d.month); setLoans(String(d.loans)); }}>Edit</button>
                        <button className="btn sm danger-outline" disabled={saving} onClick={() => save(d.month, 0)}>Remove</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function Groups() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = ADMINS.includes(user?.role);
  const canManage = MANAGERS.includes(user?.role); // may create groups
  // Editing the group master and entering loan disbursements is for the admin only.
  const canEdit = isAdmin;
  const canDelete = isAdmin;

  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [leaderPending, setLeaderPending] = useState([]); // the leader change requests that wait for the admin
  const loadLeaderPending = useCallback(() => {
    if (canManage) api.groups.leaderRequests({ status: 'pending' }).then((r) => setLeaderPending(r.items || [])).catch(() => {});
  }, [canManage]);
  useEffect(() => { loadLeaderPending(); }, [loadLeaderPending]);
  const q = useDebounce(search);

  useEffect(() => {
    if (canManage) api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, [canManage]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.groups.list({ page, limit: LIMIT, q, branch, status }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, branch, status]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, branch, status]);

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  const close = () => setDialog(null);
  const hasFilters = q || branch || status;

  // Point 6 fix: separate merged group rows (e.g. G0000030,G0000461 or G0000015, G0000178) into distinct rows
  const displayGroups = (data.items || []).flatMap((g) => {
    if (g.code && g.code.includes(',')) {
      const codes = g.code.split(',').map((c) => c.trim()).filter(Boolean);
      const names = (g.name || '').split(',').map((n) => n.trim());
      return codes.map((c, idx) => ({
        ...g,
        id: `${g.id || g._id}_${idx}`,
        code: c,
        name: names[idx] || names[0] || g.name,
      }));
    }
    return [g];
  });

  return (
    <>
      <PageHeader
        title="Group List"
        description="All groups with their leader, employee and meeting schedule. The commission OTP goes to the leader's registered mobile number."
        actions={canManage && (
          <>
            {isAdmin && <button className="btn" onClick={() => setDialog({ type: 'leaderRequests' })}>Leader change requests{leaderPending.length ? ` (${leaderPending.length})` : ''}</button>}
            <button className="btn primary" onClick={() => navigate('/group-master/create')}>+ Create Group</button>
          </>
        )}
      />

      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by code, group or leader" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search groups" />
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Filter by branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && <button className="btn" onClick={() => { setSearch(''); setBranch(''); setStatus(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading groups…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState title={hasFilters ? 'No groups match your filters' : 'No groups yet'} description={hasFilters ? 'Try changing or clearing the filters.' : 'Add the first group to get started.'} />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Group code</th>
                    <th>Group name</th>
                    <th>Branch</th>
                    <th>Leader</th>
                    <th>Employee</th>
                    <th>Meeting</th>
                    <th className="num">Members</th>
                    <th>Leader mobile</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayGroups.map((g) => (
                    <tr key={g.id}>
                      <td data-label="Code"><strong>{g.code}</strong></td>
                      <td data-label="Group">{g.name}</td>
                      <td data-label="Branch">{g.branch ? `${g.branch.code} — ${g.branch.name}` : '—'}</td>
                      <td data-label="Leader">{g.leaderName}</td>
                      <td data-label="Employee">{g.employeeCode ? `${g.employeeCode}${g.employeeName ? ` — ${g.employeeName}` : ''}` : '—'}</td>
                      <td data-label="Meeting">{g.meetingType ? `${MEETING_LABEL[g.meetingType]} · ${collectionLabel(g)} · ${formatTime(g.meetingTime)}` : '—'}</td>
                      <td data-label="Members" className="num">{g.memberCount}</td>
                      <td data-label="Mobile">{g.leaderMobile}</td>
                      <td data-label="Status"><StatusBadge active={g.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          {isAdmin && <button className="btn sm" onClick={() => setDialog({ type: 'loans', item: g })}>Disbursements</button>}
                          {canEdit && <button className="btn sm" onClick={() => setDialog({ type: 'form', item: g })}>Edit</button>}
                          {!canEdit && canManage && <button className="btn sm" onClick={() => setDialog({ type: 'schedule', item: g })}>Change meeting</button>}
                          {!canEdit && canManage && (leaderPending.some((x) => x.groupId === String(g.id))
                            ? <button className="btn sm" disabled title="A leader change of this group is waiting for the admin">Leader change pending</button>
                            : <button className="btn sm" onClick={() => setDialog({ type: 'leader', item: g })}>Change leader</button>)}
                          {canEdit && <button className="btn sm" onClick={() => setDialog({ type: 'status', item: g })}>{g.isActive ? 'Deactivate' : 'Activate'}</button>}
                          {canDelete && <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', item: g })}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>

      {dialog?.type === 'form' && dialog.item && (
        <GroupForm item={dialog.item} branches={branches} isAdmin={isAdmin} onClose={close} onSaved={() => { close(); load(); }} />
      )}
      {dialog?.type === 'schedule' && dialog.item && <ScheduleDialog item={dialog.item} onClose={close} onSaved={() => { close(); load(); }} />}
      {dialog?.type === 'leader' && dialog.item && <LeaderRequestDialog item={dialog.item} onClose={close} onSent={() => { close(); loadLeaderPending(); }} />}
      {dialog?.type === 'leaderRequests' && isAdmin && <LeaderRequestsDialog onClose={close} onChanged={() => { loadLeaderPending(); load(); }} />}
      {dialog?.type === 'loans' && isAdmin && <DisbursementDialog group={dialog.item} canEdit onClose={close} />}

      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.item?.isActive ? 'Deactivate group?' : 'Activate group?'}
        message={dialog?.item ? (dialog.item.isActive ? `${dialog.item.name} will stop receiving commission OTPs.` : `${dialog.item.name} will be active again.`) : ''}
        confirmLabel={dialog?.item?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() => run(() => api.groups.setStatus(dialog.item.id, !dialog.item.isActive), dialog.item.isActive ? 'Group deactivated' : 'Group activated')}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete group?"
        message={dialog?.item ? `Delete "${dialog.item.name}"? A group with disbursement history cannot be deleted.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.groups.remove(dialog.item.id), 'Group deleted')}
        onCancel={close}
      />
    </>
  );
}

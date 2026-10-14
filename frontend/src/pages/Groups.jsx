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

const LIMIT = 25;
const ADMINS = ['super_admin', 'admin'];
const MANAGERS = [...ADMINS, 'branch_manager', 'loan_officer', 'field_officer'];
const thisMonth = () => new Date().toISOString().slice(0, 7);

function GroupForm({ item, branches, isAdmin, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const [form, setForm] = useState({
    name: item?.name || '',
    branch: item?.branchId || (branches.length === 1 ? branches[0].id : ''),
    leaderName: item?.leaderName || '',
    leaderMobile: item?.leaderMobile || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  // The registered number can only be changed by an admin once the group exists.
  const mobileLocked = isEdit && !isAdmin;

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (form.name.trim().length < 2) found.name = 'Group name is required';
    if (!form.branch) found.branch = 'Select a branch';
    if (form.leaderName.trim().length < 2) found.leaderName = 'Group leader name is required';
    if (!mobileLocked && !/^[6-9]\d{9}$/.test(form.leaderMobile)) found.leaderMobile = 'Enter a valid 10-digit mobile number';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        branch: form.branch,
        leaderName: form.leaderName.trim(),
        leaderMobile: form.leaderMobile,
      };
      if (isEdit) await api.groups.update(item.id, payload);
      else await api.groups.create(payload);
      toast.success(isEdit ? 'Group updated' : 'Group added');
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
      title={isEdit ? `Edit group — ${item.code}` : 'Add group'}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="grp-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update group' : 'Save group'}
          </button>
        </>
      }
    >
      <form id="grp-form" onSubmit={submit} noValidate className="form-grid">
        {isEdit && (
          <FormField id="code" label="Group code">
            <input id="code" value={item.code} disabled />
          </FormField>
        )}
        <FormField id="name" label="Group name" required error={errors.name}>
          <input id="name" value={form.name} onChange={set('name')} maxLength={80} autoFocus />
        </FormField>
        <FormField id="branch" label="Branch" required error={errors.branch}>
          <select id="branch" value={form.branch} onChange={set('branch')}>
            <option value="">Select branch</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </FormField>
        <FormField id="leaderName" label="Group leader name" required error={errors.leaderName}>
          <input id="leaderName" value={form.leaderName} onChange={set('leaderName')} maxLength={80} />
        </FormField>
        <FormField
          id="leaderMobile"
          label="Leader mobile number"
          required
          error={errors.leaderMobile}
          hint={mobileLocked ? 'Only an admin can change the registered mobile number' : 'OTP for commission deposit is sent to this number'}
        >
          <input
            id="leaderMobile"
            value={form.leaderMobile}
            onChange={(e) => setForm((f) => ({ ...f, leaderMobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
            inputMode="numeric"
            maxLength={10}
            disabled={mobileLocked}
          />
        </FormField>
      </form>
    </Modal>
  );
}

// Interim input of how many loans the group had disbursed each month (until the Loans module exists).
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
  const { user } = useAuth();
  const isAdmin = ADMINS.includes(user?.role);
  const canManage = MANAGERS.includes(user?.role);
  const canDelete = [...ADMINS, 'branch_manager'].includes(user?.role);

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

  return (
    <>
      <PageHeader
        title="Centers & Groups"
        description="Loan groups with their leader. The commission OTP goes to the leader's registered mobile number."
        actions={canManage && <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Group</button>}
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
                    <th>Leader mobile</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((g) => (
                    <tr key={g.id}>
                      <td data-label="Code"><strong>{g.code}</strong></td>
                      <td data-label="Group">{g.name}</td>
                      <td data-label="Branch">{g.branch ? `${g.branch.code} — ${g.branch.name}` : '—'}</td>
                      <td data-label="Leader">{g.leaderName}</td>
                      <td data-label="Mobile">{g.leaderMobile}</td>
                      <td data-label="Status"><StatusBadge active={g.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'loans', item: g })}>Disbursements</button>
                          {canManage && <button className="btn sm" onClick={() => setDialog({ type: 'form', item: g })}>Edit</button>}
                          {canManage && <button className="btn sm" onClick={() => setDialog({ type: 'status', item: g })}>{g.isActive ? 'Deactivate' : 'Activate'}</button>}
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

      {dialog?.type === 'form' && (
        <GroupForm item={dialog.item || null} branches={branches} isAdmin={isAdmin} onClose={close} onSaved={() => { close(); load(); }} />
      )}
      {dialog?.type === 'loans' && <DisbursementDialog group={dialog.item} canEdit={canManage} onClose={close} />}

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

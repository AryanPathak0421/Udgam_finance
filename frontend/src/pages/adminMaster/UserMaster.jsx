import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import BranchPicker from '../../components/ui/BranchPicker.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useDebounce from '../../hooks/useDebounce.js';
import { ROLE_LABELS } from '../../config/nav.js';

const LIMIT = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
const PASSWORD_HINT = '8–64 characters, with letters and numbers';

function UserForm({ initial, isEdit, ranks, branches, canAssignSuper, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const roles = Object.keys(ROLE_LABELS).filter((r) => canAssignSuper || r !== 'super_admin');

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (form.name.trim().length < 2) found.name = 'Name is required';
    if (!isEdit && !EMAIL_RE.test(form.email.trim())) found.email = 'Enter a valid email address';
    if (form.mobile && !MOBILE_RE.test(form.mobile.trim())) found.mobile = 'Enter a valid 10-digit mobile number';
    if (!isEdit) {
      if (!PASSWORD_RE.test(form.password)) found.password = `Password must be ${PASSWORD_HINT}`;
      else if (form.password !== form.confirm) found.confirm = 'Passwords do not match';
    }
    if (!form.rank) found.rank = 'Select a rank';
    if (!form.role) found.role = 'Select a role';
    if (!form.branches.length) found.branches = 'Select at least one branch';
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const { confirm, ...payload } = form;
      if (isEdit) await api.users.update(initial.id, payload);
      else await api.users.create(payload);
      toast.success(isEdit ? 'User updated' : 'User created');
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
      title={isEdit ? `Edit user — ${initial.name}` : 'Create user'}
      onClose={onClose}
      busy={saving}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="user-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update user' : 'Create user'}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="name" label="Full name" required error={errors.name}>
          <input id="name" value={form.name} onChange={set('name')} maxLength={100} autoFocus />
        </FormField>
        <FormField id="email" label="Email (login ID)" required error={errors.email} hint={isEdit ? 'Login ID cannot be changed' : undefined}>
          <input id="email" type="email" value={form.email} onChange={set('email')} disabled={isEdit} autoComplete="off" />
        </FormField>
        <FormField id="mobile" label="Mobile" error={errors.mobile}>
          <input id="mobile" inputMode="numeric" value={form.mobile} onChange={set('mobile')} maxLength={10} />
        </FormField>
        <FormField id="rank" label="Rank" required error={errors.rank}>
          <select id="rank" value={form.rank} onChange={set('rank')}>
            <option value="">Select rank</option>
            {ranks.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </FormField>
        <FormField id="role" label="System role" required error={errors.role} hint="Decides default access and API permissions">
          <select id="role" value={form.role} onChange={set('role')}>
            <option value="">Select role</option>
            {roles.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </FormField>
        {!isEdit && (
          <>
            <FormField id="password" label="Password" required error={errors.password} hint={PASSWORD_HINT}>
              <input id="password" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
            </FormField>
            <FormField id="confirm" label="Confirm password" required error={errors.confirm}>
              <input id="confirm" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
            </FormField>
          </>
        )}
        <FormField id="branches" label="Branches" required error={errors.branches} className="span-2" hint="User can work in the selected branches">
          <BranchPicker options={branches} value={form.branches} onChange={(v) => { setForm((f) => ({ ...f, branches: v })); setErrors((er) => ({ ...er, branches: undefined })); }} error={errors.branches} />
        </FormField>
      </form>
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!PASSWORD_RE.test(password)) return setError(`Password must be ${PASSWORD_HINT}`);
    if (password !== confirm) return setError('Passwords do not match');
    setSaving(true);
    try {
      await api.users.resetPassword(user.id, password);
      toast.success('Password reset. The user can sign in with the new password.');
      onClose();
    } catch (err) {
      setError(err.errors?.password || err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={`Reset password — ${user.name}`}
      onClose={onClose}
      busy={saving}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="pw-form" disabled={saving}>{saving ? 'Saving…' : 'Reset password'}</button>
        </>
      }
    >
      <form id="pw-form" onSubmit={submit} noValidate>
        <FormField id="newpw" label="New password" required hint={PASSWORD_HINT}>
          <input id="newpw" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} autoComplete="new-password" autoFocus />
        </FormField>
        <FormField id="newpw2" label="Confirm password" required error={error}>
          <input id="newpw2" type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(''); }} autoComplete="new-password" />
        </FormField>
      </form>
    </Modal>
  );
}

export default function UserMaster() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [rank, setRank] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [ranks, setRanks] = useState([]);
  const [branches, setBranches] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    api.ranks.options().then((d) => setRanks(d.items)).catch(() => {});
    api.branches.options().then((d) => setBranches(d.items)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.users.list({ page, limit: LIMIT, q, rank, role, status }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, rank, role, status]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, rank, role, status]);

  async function toggleStatus() {
    const u = dialog.user;
    setBusy(true);
    try {
      await api.users.setStatus(u.id, !u.isActive);
      toast.success(u.isActive ? 'User deactivated' : 'User activated');
      setDialog(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  const closeDialog = () => setDialog(null);
  const hasFilters = q || rank || role || status;
  const isSuper = me.role === 'super_admin';

  return (
    <>
      <PageHeader
        title="User Master"
        description="Create users against a rank, assign branches, then set their menu access in Menu Permission."
        actions={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Create User</button>}
      />

      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by name, email or mobile" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
          <select value={rank} onChange={(e) => setRank(e.target.value)} aria-label="Filter by rank">
            <option value="">All ranks</option>
            {ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
            <option value="">All roles</option>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && <button className="btn" onClick={() => { setSearch(''); setRank(''); setRole(''); setStatus(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading users…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No users match your filters' : 'No users yet'}
            description={hasFilters ? 'Try changing or clearing the filters.' : 'Create ranks and branches first, then add users.'}
          />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Login (email)</th>
                    <th>Rank</th>
                    <th>Role</th>
                    <th>Branches</th>
                    <th>Menus</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr key={u.id}>
                      <td data-label="Name"><strong>{u.name}</strong>{u.mobile && <div className="muted small">{u.mobile}</div>}</td>
                      <td data-label="Login (email)">{u.email}</td>
                      <td data-label="Rank">{u.rank?.name || '—'}</td>
                      <td data-label="Role">{ROLE_LABELS[u.role] || u.role}</td>
                      <td data-label="Branches">{u.branches.map((b) => b.code).join(', ') || '—'}</td>
                      <td data-label="Menus">{['super_admin', 'admin'].includes(u.role) ? 'Full' : u.hasCustomMenus ? 'Custom' : 'Role default'}</td>
                      <td data-label="Status"><StatusBadge active={u.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', user: u })}>Edit</button>
                          <Link className="btn sm" to={`/admin-master/menu-permissions?user=${u.id}`}>Menus</Link>
                          <button className="btn sm" onClick={() => setDialog({ type: 'password', user: u })}>Reset password</button>
                          {u.id !== me.id && (
                            <button className="btn sm" onClick={() => setDialog({ type: 'status', user: u })}>{u.isActive ? 'Deactivate' : 'Activate'}</button>
                          )}
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
        <UserForm
          initial={
            dialog.user
              ? { id: dialog.user.id, name: dialog.user.name, email: dialog.user.email, mobile: dialog.user.mobile, role: dialog.user.role, rank: dialog.user.rankId, branches: dialog.user.branches.map((b) => String(b.id)), password: '', confirm: '' }
              : { name: '', email: '', mobile: '', role: '', rank: '', branches: [], password: '', confirm: '' }
          }
          isEdit={Boolean(dialog.user)}
          ranks={ranks}
          branches={branches}
          canAssignSuper={isSuper}
          onClose={closeDialog}
          onSaved={() => { closeDialog(); load(); }}
        />
      )}

      {dialog?.type === 'password' && <ResetPasswordDialog user={dialog.user} onClose={closeDialog} />}

      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.user?.isActive ? 'Deactivate user?' : 'Activate user?'}
        message={dialog?.user ? (dialog.user.isActive ? `${dialog.user.name} will no longer be able to sign in.` : `${dialog.user.name} will be able to sign in again.`) : ''}
        confirmLabel={dialog?.user?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={toggleStatus}
        onCancel={closeDialog}
      />
    </>
  );
}

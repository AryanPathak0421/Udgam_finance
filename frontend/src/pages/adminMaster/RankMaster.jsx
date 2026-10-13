import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useDebounce from '../../hooks/useDebounce.js';

const LIMIT = 10;
const EMPTY = { code: '', name: '', level: '', description: '' };
const CODE_RE = /^[A-Z0-9-]{2,10}$/;

function RankForm({ initial, isEdit, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!CODE_RE.test(form.code.trim().toUpperCase())) found.code = 'Use 2–10 letters, numbers or hyphen';
    if (form.name.trim().length < 2) found.name = 'Rank name is required';
    const level = Number(form.level);
    if (!Number.isInteger(level) || level < 1 || level > 99) found.level = 'Enter a whole number from 1 to 99';
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const payload = { ...form, code: form.code.trim().toUpperCase(), level };
      if (isEdit) await api.ranks.update(initial.id, payload);
      else await api.ranks.create(payload);
      toast.success(isEdit ? 'Rank updated' : 'Rank added');
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
      title={isEdit ? `Edit rank — ${initial.name}` : 'Add rank'}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="rank-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update rank' : 'Save rank'}
          </button>
        </>
      }
    >
      <form id="rank-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="name" label="Rank / post name" required error={errors.name}>
          <input id="name" value={form.name} onChange={set('name')} maxLength={80} autoFocus placeholder="e.g. Branch Manager" />
        </FormField>
        <FormField id="code" label="Rank code" required error={errors.code} hint="Short unique code, e.g. BM">
          <input id="code" value={form.code} onChange={set('code')} maxLength={10} style={{ textTransform: 'uppercase' }} />
        </FormField>
        <FormField id="level" label="Level" required error={errors.level} hint="1 = highest in the hierarchy">
          <input id="level" type="number" min={1} max={99} value={form.level} onChange={set('level')} />
        </FormField>
        <FormField id="description" label="Description" error={errors.description} className="span-2">
          <textarea id="description" rows={2} value={form.description} onChange={set('description')} maxLength={200} />
        </FormField>
      </form>
    </Modal>
  );
}

export default function RankMaster() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.ranks.list({ page, limit: LIMIT, q, status }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, status]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, status]);

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      const wasDelete = dialog?.type === 'delete';
      setDialog(null);
      if (wasDelete && data.items.length === 1 && page > 1) setPage(page - 1);
      else load();
    } catch (err) {
      toast.error(err.message);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  const closeDialog = () => setDialog(null);
  const hasFilters = q || status;

  return (
    <>
      <PageHeader
        title="Rank Master"
        description="Company posts / designations in hierarchy order. Users are created against a rank."
        actions={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Rank</button>}
      />

      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by rank name or code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search ranks" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && <button className="btn" onClick={() => { setSearch(''); setStatus(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading ranks…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No ranks match your filters' : 'No ranks yet'}
            description={hasFilters ? 'Try changing or clearing the filters.' : 'Add ranks such as Branch Manager, Loan Officer or Field Officer.'}
            action={!hasFilters && <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Rank</button>}
          />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Level</th>
                    <th>Rank / post</th>
                    <th>Code</th>
                    <th>Description</th>
                    <th>Users</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Level"><strong>{r.level}</strong></td>
                      <td data-label="Rank / post">{r.name}</td>
                      <td data-label="Code">{r.code}</td>
                      <td data-label="Description">{r.description || '—'}</td>
                      <td data-label="Users">{r.userCount}</td>
                      <td data-label="Status"><StatusBadge active={r.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', rank: r })}>Edit</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'status', rank: r })}>{r.isActive ? 'Deactivate' : 'Activate'}</button>
                          <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', rank: r })}>Delete</button>
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
        <RankForm
          initial={dialog.rank ? { ...dialog.rank, level: String(dialog.rank.level) } : EMPTY}
          isEdit={Boolean(dialog.rank)}
          onClose={closeDialog}
          onSaved={() => { closeDialog(); load(); }}
        />
      )}

      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.rank?.isActive ? 'Deactivate rank?' : 'Activate rank?'}
        message={dialog?.rank ? (dialog.rank.isActive ? `${dialog.rank.name} will no longer be selectable for new users.` : `${dialog.rank.name} will be selectable for users again.`) : ''}
        confirmLabel={dialog?.rank?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() => run(() => api.ranks.setStatus(dialog.rank.id, !dialog.rank.isActive), dialog.rank.isActive ? 'Rank deactivated' : 'Rank activated')}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete rank?"
        message={dialog?.rank ? `Delete ${dialog.rank.name}? A rank assigned to users cannot be deleted.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.ranks.remove(dialog.rank.id), 'Rank deleted')}
        onCancel={closeDialog}
      />
    </>
  );
}

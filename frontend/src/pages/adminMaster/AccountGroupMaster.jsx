import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useDebounce from '../../hooks/useDebounce.js';

const LIMIT = 50;
export const NATURE_LABEL = { asset: 'Asset', liability: 'Liability', income: 'Income', expense: 'Expense' };
const NATURE_TONE = { asset: 'green', liability: 'grey', income: 'green', expense: 'grey' };

function GroupForm({ item, options, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const [form, setForm] = useState({
    name: item?.name || '',
    parent: item?.parentId || '',
    nature: item?.nature || 'asset',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // A group cannot be placed under itself or one of its own sub-groups.
  const parents = options.filter((o) => !item || (o.id !== item.id && !o.path.startsWith(`${item.path} ›`)));
  const parent = parents.find((o) => o.id === form.parent);
  const nature = parent ? parent.nature : form.nature;

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (form.name.trim().length < 2) found.name = 'Group name is required';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), parent: form.parent, nature };
      if (isEdit) await api.accountGroups.update(item.id, payload);
      else await api.accountGroups.create(payload);
      toast.success(isEdit ? 'Account group updated' : 'Account group added');
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
      title={isEdit ? `Edit group — ${item.name}` : 'Add account group'}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="group-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update group' : 'Save group'}
          </button>
        </>
      }
    >
      <form id="group-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="name" label="Group name" required error={errors.name} className="span-2">
          <input id="name" value={form.name} onChange={set('name')} maxLength={60} autoFocus />
        </FormField>
        <FormField id="parent" label="Under group" error={errors.parent} hint="Leave empty to create a primary group">
          <select id="parent" value={form.parent} onChange={set('parent')}>
            <option value="">None (primary group)</option>
            {parents.map((o) => (
              <option key={o.id} value={o.id}>{'  '.repeat(o.depth)}{o.depth ? '↳ ' : ''}{o.name}</option>
            ))}
          </select>
        </FormField>
        <FormField id="nature" label="Nature" required error={errors.nature} hint={parent ? 'Inherited from the parent group' : undefined}>
          <select id="nature" value={nature} onChange={set('nature')} disabled={Boolean(parent)}>
            {Object.entries(NATURE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </FormField>
      </form>
    </Modal>
  );
}

export default function AccountGroupMaster() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [nature, setNature] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, opts] = await Promise.all([
        api.accountGroups.list({ page, limit: LIMIT, q, nature, status }),
        api.accountGroups.options(),
      ]);
      setData(list);
      setOptions(opts.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, nature, status]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, nature, status]);

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
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
  const hasFilters = q || nature || status;

  return (
    <>
      <PageHeader
        title="Account Group Master"
        description="The chart of accounts: groups that ledgers sit under. Built-in groups are protected; add your own sub-groups."
        actions={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Group</button>}
      />

      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by group name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search groups" />
          <select value={nature} onChange={(e) => setNature(e.target.value)} aria-label="Filter by nature">
            <option value="">All natures</option>
            {Object.entries(NATURE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && <button className="btn" onClick={() => { setSearch(''); setNature(''); setStatus(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading account groups…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState title="No groups match your filters" description="Try changing or clearing the filters." />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Nature</th>
                    <th>Under</th>
                    <th className="num">Sub-groups</th>
                    <th className="num">Ledgers</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((g) => (
                    <tr key={g.id}>
                      <td data-label="Group">
                        <span style={{ paddingLeft: hasFilters ? 0 : g.depth * 18 }}>
                          {!hasFilters && g.depth > 0 && <span className="muted">↳ </span>}
                          <strong>{g.name}</strong>
                        </span>
                      </td>
                      <td data-label="Nature"><span className={`badge ${NATURE_TONE[g.nature]}`}>{NATURE_LABEL[g.nature]}</span></td>
                      <td data-label="Under">{g.parentName || '—'}</td>
                      <td data-label="Sub-groups" className="num">{g.childCount}</td>
                      <td data-label="Ledgers" className="num">{g.ledgerCount}</td>
                      <td data-label="Type">{g.isSystem ? <span className="badge grey">Built-in</span> : 'Custom'}</td>
                      <td data-label="Status"><StatusBadge active={g.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        {g.isSystem ? (
                          <span className="muted small">Protected</span>
                        ) : (
                          <div className="row-actions">
                            <button className="btn sm" onClick={() => setDialog({ type: 'form', item: g })}>Edit</button>
                            <button className="btn sm" onClick={() => setDialog({ type: 'status', item: g })}>{g.isActive ? 'Deactivate' : 'Activate'}</button>
                            <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', item: g })}>Delete</button>
                          </div>
                        )}
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
        <GroupForm item={dialog.item || null} options={options} onClose={closeDialog} onSaved={() => { closeDialog(); load(); }} />
      )}

      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.item?.isActive ? 'Deactivate group?' : 'Activate group?'}
        message={dialog?.item ? (dialog.item.isActive ? `${dialog.item.name} will no longer be offered when creating ledgers.` : `${dialog.item.name} will be offered again.`) : ''}
        confirmLabel={dialog?.item?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() => run(() => api.accountGroups.setStatus(dialog.item.id, !dialog.item.isActive), dialog.item.isActive ? 'Group deactivated' : 'Group activated')}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete account group?"
        message={dialog?.item ? `Delete "${dialog.item.name}"? A group with sub-groups or ledgers cannot be deleted.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.accountGroups.remove(dialog.item.id), 'Account group deleted')}
        onCancel={closeDialog}
      />
    </>
  );
}

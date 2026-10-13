import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useDebounce from '../../hooks/useDebounce.js';
import useLocations from '../../hooks/useLocations.js';
import { formatDate } from '../../utils/format.js';

const LIMIT = 10;
const EMPTY = { code: '', name: '', address: '', state: '', city: '', openingDate: '' };
const CODE_RE = /^[A-Z0-9-]{2,12}$/;

function validate(f, isEdit) {
  const e = {};
  if (!isEdit && !CODE_RE.test(f.code.trim().toUpperCase())) e.code = 'Use 2–12 letters, numbers or hyphen';
  if (f.name.trim().length < 2) e.name = 'Branch name is required';
  if (f.address.trim().length < 5) e.address = 'Address is required (min 5 characters)';
  if (!f.state) e.state = 'Select a state';
  if (!f.city) e.city = 'Select a city';
  if (!f.openingDate) e.openingDate = 'Opening date is required';
  return e;
}

function BranchForm({ initial, isEdit, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const { states, cities } = useLocations(form.state);

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value, ...(key === 'state' ? { city: '' } : {}) }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = validate(form, isEdit);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = { ...form, code: form.code.trim().toUpperCase() };
      if (isEdit) await api.branches.update(initial.id, payload);
      else await api.branches.create(payload);
      toast.success(isEdit ? 'Branch updated' : 'Branch added');
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
      title={isEdit ? `Edit branch — ${initial.code}` : 'Add branch'}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn primary" type="submit" form="branch-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update branch' : 'Save branch'}
          </button>
        </>
      }
    >
      <form id="branch-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="code" label="Branch code" required error={errors.code} hint={isEdit ? 'Code cannot be changed' : 'Unique, e.g. BR001'}>
          <input id="code" value={form.code} onChange={set('code')} disabled={isEdit} maxLength={12} style={{ textTransform: 'uppercase' }} autoFocus={!isEdit} />
        </FormField>
        <FormField id="name" label="Branch name" required error={errors.name}>
          <input id="name" value={form.name} onChange={set('name')} maxLength={100} autoFocus={isEdit} />
        </FormField>
        <FormField id="address" label="Address" required error={errors.address} className="span-2">
          <textarea id="address" rows={3} value={form.address} onChange={set('address')} maxLength={300} />
        </FormField>
        <FormField id="state" label="State" required error={errors.state}>
          <select id="state" value={form.state} onChange={set('state')}>
            <option value="">Select state</option>
            {states.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <FormField id="city" label="City" required error={errors.city}>
          <select id="city" value={form.city} onChange={set('city')} disabled={!form.state}>
            <option value="">{form.state ? 'Select city' : 'Select state first'}</option>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </FormField>
        <FormField id="openingDate" label="Opening date" required error={errors.openingDate}>
          <input id="openingDate" type="date" value={form.openingDate} onChange={set('openingDate')} />
        </FormField>
      </form>
    </Modal>
  );
}

export default function BranchMaster() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState({ field: 'createdAt', order: 'desc' });
  const [dialog, setDialog] = useState(null); // {type:'form'|'view'|'delete'|'status', branch?}
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);
  const { states } = useLocations('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.branches.list({ page, limit: LIMIT, q, state, status, sort: sort.field, order: sort.order }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, state, status, sort]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => setPage(1), [q, state, status]);

  const toggleSort = (field) =>
    setSort((s) => (s.field === field ? { field, order: s.order === 'asc' ? 'desc' : 'asc' } : { field, order: 'asc' }));
  const arrow = (field) => (sort.field === field ? (sort.order === 'asc' ? ' ▲' : ' ▼') : '');

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      setDialog(null);
      // If the last row of a page was removed, step back a page.
      if (dialog?.type === 'delete' && data.items.length === 1 && page > 1) setPage(page - 1);
      else load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const closeDialog = () => setDialog(null);
  const hasFilters = q || state || status;

  return (
    <>
      <PageHeader
        title="Branch Master"
        description="Manage company branches. Branch code must be unique."
        actions={
          <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>
            + Add Branch
          </button>
        }
      />

      <div className="panel">
        <div className="toolbar">
          <input
            type="search"
            placeholder="Search by code, name or city"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search branches"
            className="toolbar-search"
          />
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="Filter by state">
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && (
            <button
              className="btn"
              onClick={() => {
                setSearch('');
                setState('');
                setStatus('');
              }}
            >
              Clear
            </button>
          )}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading branches…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No branches match your filters' : 'No branches yet'}
            description={hasFilters ? 'Try changing or clearing the filters.' : 'Add your first branch to get started.'}
            action={
              !hasFilters && (
                <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>
                  + Add Branch
                </button>
              )
            }
          />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => toggleSort('code')}>Code{arrow('code')}</th>
                    <th className="sortable" onClick={() => toggleSort('name')}>Branch name{arrow('name')}</th>
                    <th className="sortable" onClick={() => toggleSort('city')}>City{arrow('city')}</th>
                    <th className="sortable" onClick={() => toggleSort('state')}>State{arrow('state')}</th>
                    <th className="sortable" onClick={() => toggleSort('openingDate')}>Opening date{arrow('openingDate')}</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((b) => (
                    <tr key={b.id}>
                      <td data-label="Code"><strong>{b.code}</strong></td>
                      <td data-label="Branch name">{b.name}</td>
                      <td data-label="City">{b.city}</td>
                      <td data-label="State">{b.state}</td>
                      <td data-label="Opening date">{formatDate(b.openingDate)}</td>
                      <td data-label="Status"><StatusBadge active={b.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'view', branch: b })}>View</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', branch: b })}>Edit</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'status', branch: b })}>
                            {b.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', branch: b })}>Delete</button>
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
        <BranchForm
          initial={dialog.branch ? { ...dialog.branch } : EMPTY}
          isEdit={Boolean(dialog.branch)}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            load();
          }}
        />
      )}

      <Modal
        open={dialog?.type === 'view'}
        title={dialog?.branch ? `${dialog.branch.name} (${dialog.branch.code})` : ''}
        onClose={closeDialog}
        footer={<button className="btn" onClick={closeDialog}>Close</button>}
      >
        {dialog?.type === 'view' && (
          <DetailList
            items={[
              ['Branch code', dialog.branch.code],
              ['Branch name', dialog.branch.name],
              ['Address', dialog.branch.address],
              ['State', dialog.branch.state],
              ['City', dialog.branch.city],
              ['Opening date', formatDate(dialog.branch.openingDate)],
              ['Status', dialog.branch.isActive ? 'Active' : 'Inactive'],
            ]}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete branch?"
        message={dialog?.branch ? `Delete ${dialog.branch.name} (${dialog.branch.code})? It will be removed from the list. This cannot be undone from the screen.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.branches.remove(dialog.branch.id), 'Branch deleted')}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.branch?.isActive ? 'Deactivate branch?' : 'Activate branch?'}
        message={
          dialog?.branch
            ? dialog.branch.isActive
              ? `${dialog.branch.name} will be marked inactive and hidden from new transactions.`
              : `${dialog.branch.name} will be marked active again.`
            : ''
        }
        confirmLabel={dialog?.branch?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() =>
          run(
            () => api.branches.setStatus(dialog.branch.id, !dialog.branch.isActive),
            dialog.branch.isActive ? 'Branch deactivated' : 'Branch activated'
          )
        }
        onCancel={closeDialog}
      />
    </>
  );
}

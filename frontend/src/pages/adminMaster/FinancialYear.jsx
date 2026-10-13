import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { daysBetween, formatDate } from '../../utils/format.js';

const MAX_DAYS = 458;

function overlapWith(list, start, end, excludeId) {
  return list.find((fy) => fy.id !== excludeId && fy.startDate <= end && fy.endDate >= start);
}

function FinancialYearForm({ item, list, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const [form, setForm] = useState({ startDate: item?.startDate || '', endDate: item?.endDate || '' });
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState({ financialYearId: item?.financialYearId || '', name: item?.name || '' });
  const [saving, setSaving] = useState(false);

  // Generated ID/name preview comes from the server so it matches what will be saved.
  useEffect(() => {
    const { startDate, endDate } = form;
    if (!startDate || !endDate || endDate <= startDate) {
      if (!isEdit) setPreview({ financialYearId: '', name: '' });
      return undefined;
    }
    let live = true;
    api.financialYears
      .preview({ startDate, endDate })
      .then((p) => live && setPreview({ financialYearId: isEdit ? item.financialYearId : p.financialYearId || '', name: p.name || '' }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [form, isEdit, item]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined, startDate: undefined, endDate: undefined }));
  };

  function validate() {
    const e = {};
    if (!form.startDate) e.startDate = 'Start date is required';
    if (!form.endDate) e.endDate = 'End date is required';
    if (form.startDate && form.endDate) {
      if (form.endDate <= form.startDate) e.endDate = 'End date must be after the start date';
      else if (daysBetween(form.startDate, form.endDate) > MAX_DAYS) e.endDate = 'A financial year cannot exceed 15 months';
      else {
        const clash = overlapWith(list, form.startDate, form.endDate, item?.id);
        if (clash) e.startDate = `Overlaps with ${clash.name} (${formatDate(clash.startDate)} – ${formatDate(clash.endDate)})`;
      }
    }
    return e;
  }

  async function submit(e) {
    e.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      if (isEdit) await api.financialYears.update(item.id, form);
      else await api.financialYears.create(form);
      toast.success(isEdit ? 'Financial year updated' : 'Financial year created');
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
      title={isEdit ? `Edit financial year — ${item.name}` : 'Add financial year'}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="fy-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </button>
        </>
      }
    >
      <form id="fy-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="startDate" label="Start date" required error={errors.startDate}>
          <input id="startDate" type="date" value={form.startDate} onChange={set('startDate')} autoFocus />
        </FormField>
        <FormField id="endDate" label="End date" required error={errors.endDate}>
          <input id="endDate" type="date" value={form.endDate} onChange={set('endDate')} />
        </FormField>
        <FormField id="fyId" label="Financial year ID" hint="Auto-generated">
          <input id="fyId" value={preview.financialYearId} placeholder="Generated from dates" readOnly disabled />
        </FormField>
        <FormField id="fyName" label="Financial year name" hint="Auto-generated">
          <input id="fyName" value={preview.name} placeholder="Generated from dates" readOnly disabled />
        </FormField>
      </form>
    </Modal>
  );
}

export default function FinancialYear() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // {type:'form'|'view'|'activate'|'delete', item?}
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems((await api.financialYears.list()).items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
  const active = items.find((i) => i.isActive);

  return (
    <>
      <PageHeader
        title="Financial Year"
        description="ID and name are generated automatically from the dates. Only one year can be active."
        actions={
          <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>
            + Add Financial Year
          </button>
        }
      />

      {!loading && !error && items.length > 0 && (
        <div className={`notice ${active ? 'ok' : ''}`}>
          {active ? (
            <>
              Active financial year: <strong>{active.name}</strong> ({formatDate(active.startDate)} – {formatDate(active.endDate)})
            </>
          ) : (
            'No financial year is active. Set one as active to use it across the system.'
          )}
        </div>
      )}

      <div className="panel">
        {loading ? (
          <Spinner label="Loading financial years…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No financial years yet"
            description="Create the first one — it will become the active year automatically."
            action={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Financial Year</button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Financial year ID</th>
                  <th>Name</th>
                  <th>Start date</th>
                  <th>End date</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((fy) => (
                  <tr key={fy.id} className={fy.isActive ? 'row-active' : ''}>
                    <td data-label="Financial year ID"><strong>{fy.financialYearId}</strong></td>
                    <td data-label="Name">{fy.name}</td>
                    <td data-label="Start date">{formatDate(fy.startDate)}</td>
                    <td data-label="End date">{formatDate(fy.endDate)}</td>
                    <td data-label="Days">{daysBetween(fy.startDate, fy.endDate)}</td>
                    <td data-label="Status"><StatusBadge active={fy.isActive} inactiveLabel="Inactive" /></td>
                    <td data-label="Actions" className="actions-col">
                      <div className="row-actions">
                        <button className="btn sm" onClick={() => setDialog({ type: 'view', item: fy })}>View</button>
                        <button className="btn sm" onClick={() => setDialog({ type: 'form', item: fy })}>Edit</button>
                        {!fy.isActive && (
                          <button className="btn sm" onClick={() => setDialog({ type: 'activate', item: fy })}>Set active</button>
                        )}
                        {!fy.isActive && (
                          <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', item: fy })}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog?.type === 'form' && (
        <FinancialYearForm
          item={dialog.item}
          list={items}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            load();
          }}
        />
      )}

      <Modal
        open={dialog?.type === 'view'}
        title={dialog?.item ? `Financial year ${dialog.item.name}` : ''}
        onClose={closeDialog}
        footer={<button className="btn" onClick={closeDialog}>Close</button>}
      >
        {dialog?.type === 'view' && (
          <DetailList
            items={[
              ['Financial year ID', dialog.item.financialYearId],
              ['Name', dialog.item.name],
              ['Start date', formatDate(dialog.item.startDate)],
              ['End date', formatDate(dialog.item.endDate)],
              ['Duration', `${daysBetween(dialog.item.startDate, dialog.item.endDate)} days`],
              ['Status', dialog.item.isActive ? 'Active' : 'Inactive'],
            ]}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={dialog?.type === 'activate'}
        title="Set as active financial year?"
        message={
          dialog?.item
            ? `${dialog.item.name} will become the active financial year${active ? ` and ${active.name} will be deactivated` : ''}.`
            : ''
        }
        confirmLabel="Set active"
        loading={busy}
        onConfirm={() => run(() => api.financialYears.activate(dialog.item.id), 'Active financial year changed')}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete financial year?"
        message={dialog?.item ? `Delete financial year ${dialog.item.name}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.financialYears.remove(dialog.item.id), 'Financial year deleted')}
        onCancel={closeDialog}
      />
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { ErrorState, PageHeader, Spinner } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';

const fmt = (prefix, padding, n) => `${prefix.toUpperCase()}${String(n || 0).padStart(Number(padding) || 0, '0')}`;
const PREFIX_RE = /^[A-Z0-9-]{1,10}$/;

// Used for both "Add sequence" (item = null) and "Edit sequence".
function SequenceForm({ item, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const canRename = !isEdit || !item.isSystem;
  const [form, setForm] = useState({
    label: item?.label || '',
    prefix: item?.prefix || '',
    padding: String(item?.padding ?? 6),
    nextNumber: String(item?.nextNumber ?? 1),
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const minNext = item?.nextNumber ?? 1;

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    const padding = Number(form.padding);
    const nextNumber = Number(form.nextNumber);
    if (canRename && form.label.trim().length < 2) found.label = 'Enter a name (e.g. Receipt No)';
    if (!PREFIX_RE.test(form.prefix.trim().toUpperCase())) found.prefix = 'Use 1–10 letters, numbers or hyphen';
    if (!Number.isInteger(padding) || padding < 3 || padding > 10) found.padding = 'Enter a number from 3 to 10';
    if (!Number.isInteger(nextNumber) || nextNumber < minNext) found.nextNumber = `Must be ${minNext} or higher`;
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const payload = { label: form.label.trim(), prefix: form.prefix.trim(), padding, nextNumber };
      if (isEdit) await api.codeSequences.update(item.type, payload);
      else await api.codeSequences.create(payload);
      toast.success(isEdit ? 'Code sequence updated' : 'Code sequence added');
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const preview = PREFIX_RE.test(form.prefix.trim().toUpperCase()) ? fmt(form.prefix.trim(), form.padding, form.nextNumber) : '—';

  return (
    <Modal
      open
      title={isEdit ? `Edit ${item.label} sequence` : 'Add code sequence'}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="seq-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Add sequence'}
          </button>
        </>
      }
    >
      <form id="seq-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="label" label="Sequence name" required error={errors.label} className="span-2" hint={canRename ? 'e.g. Receipt No, Voucher No, Group Code' : 'Built-in sequence name cannot be changed'}>
          <input id="label" value={form.label} onChange={set('label')} maxLength={40} disabled={!canRename} autoFocus={canRename} />
        </FormField>
        <FormField id="prefix" label="Prefix" required error={errors.prefix} hint="Letters/numbers, e.g. RCPT. Must be unique.">
          <input id="prefix" value={form.prefix} onChange={set('prefix')} maxLength={10} style={{ textTransform: 'uppercase' }} autoFocus={!canRename} />
        </FormField>
        <FormField id="padding" label="Number length" required error={errors.padding} hint="Digits, zero-padded (3–10)">
          <input id="padding" type="number" min={3} max={10} value={form.padding} onChange={set('padding')} />
        </FormField>
        <FormField id="nextNumber" label={isEdit ? 'Next number' : 'Starting number'} required error={errors.nextNumber} hint={isEdit ? 'Can only move forward — issued codes are never reused' : undefined}>
          <input id="nextNumber" type="number" min={minNext} value={form.nextNumber} onChange={set('nextNumber')} />
        </FormField>
        <FormField id="preview" label="Next code preview">
          <input id="preview" value={preview} readOnly disabled />
        </FormField>
      </form>
    </Modal>
  );
}

export default function CodeSequence() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // {type:'form'|'delete', item?}
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems((await api.codeSequences.list()).items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove() {
    setBusy(true);
    try {
      await api.codeSequences.remove(dialog.item.type);
      toast.success('Code sequence deleted');
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

  return (
    <>
      <PageHeader
        title="Code Sequence"
        description="Prefix and numbering for member codes, loan IDs, employee codes and any other series you add. Codes are generated automatically."
        actions={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Sequence</button>}
      />

      <div className="panel">
        {loading ? (
          <Spinner label="Loading code sequences…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sequence</th>
                  <th>Prefix</th>
                  <th>Number length</th>
                  <th>Next number</th>
                  <th>Next code</th>
                  <th>Issued</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.type}>
                    <td data-label="Sequence">
                      <strong>{s.label}</strong>
                      {s.isSystem && <span className="badge grey" style={{ marginLeft: 8 }}>Built-in</span>}
                    </td>
                    <td data-label="Prefix">{s.prefix}</td>
                    <td data-label="Number length">{s.padding}</td>
                    <td data-label="Next number">{s.nextNumber}</td>
                    <td data-label="Next code"><span className="badge green">{s.nextCode}</span></td>
                    <td data-label="Issued">{s.issued}</td>
                    <td data-label="Actions" className="actions-col">
                      <div className="row-actions">
                        <button className="btn sm" onClick={() => setDialog({ type: 'form', item: s })}>Edit</button>
                        {!s.isSystem && (
                          <button
                            className="btn sm danger-outline"
                            onClick={() => setDialog({ type: 'delete', item: s })}
                            disabled={s.issued > 0}
                            title={s.issued > 0 ? 'Codes have already been issued from this sequence' : undefined}
                          >
                            Delete
                          </button>
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
        <SequenceForm
          item={dialog.item || null}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            load();
          }}
        />
      )}

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete code sequence?"
        message={dialog?.item ? `Delete the "${dialog.item.label}" sequence? No codes have been issued from it yet.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={remove}
        onCancel={closeDialog}
      />
    </>
  );
}

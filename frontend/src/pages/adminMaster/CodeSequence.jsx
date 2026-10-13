import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { ErrorState, PageHeader, Spinner } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';

const fmt = (prefix, padding, n) => `${prefix.toUpperCase()}${String(n || 0).padStart(Number(padding) || 0, '0')}`;
const PREFIX_RE = /^[A-Z0-9-]{1,10}$/;

function SequenceForm({ item, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ prefix: item.prefix, padding: String(item.padding), nextNumber: String(item.nextNumber) });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    const padding = Number(form.padding);
    const nextNumber = Number(form.nextNumber);
    if (!PREFIX_RE.test(form.prefix.trim().toUpperCase())) found.prefix = 'Use 1–10 letters, numbers or hyphen';
    if (!Number.isInteger(padding) || padding < 3 || padding > 10) found.padding = 'Enter a number from 3 to 10';
    if (!Number.isInteger(nextNumber) || nextNumber < item.nextNumber) found.nextNumber = `Must be ${item.nextNumber} or higher`;
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      await api.codeSequences.update(item.type, { prefix: form.prefix.trim(), padding, nextNumber });
      toast.success(`${item.label} sequence updated`);
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
      title={`Edit ${item.label} sequence`}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="seq-form" disabled={saving}>{saving ? 'Saving…' : 'Update'}</button>
        </>
      }
    >
      <form id="seq-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="prefix" label="Prefix" required error={errors.prefix} hint="Letters/numbers, e.g. MEM">
          <input id="prefix" value={form.prefix} onChange={set('prefix')} maxLength={10} style={{ textTransform: 'uppercase' }} autoFocus />
        </FormField>
        <FormField id="padding" label="Number length" required error={errors.padding} hint="Digits, zero-padded (3–10)">
          <input id="padding" type="number" min={3} max={10} value={form.padding} onChange={set('padding')} />
        </FormField>
        <FormField id="nextNumber" label="Next number" required error={errors.nextNumber} hint="Can only move forward — issued codes are never reused">
          <input id="nextNumber" type="number" min={item.nextNumber} value={form.nextNumber} onChange={set('nextNumber')} />
        </FormField>
        <FormField id="preview" label="Next code preview">
          <input id="preview" value={preview} readOnly disabled />
        </FormField>
      </form>
    </Modal>
  );
}

export default function CodeSequence() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

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

  return (
    <>
      <PageHeader
        title="Code Sequence"
        description="Prefix and numbering for member codes, loan IDs and employee codes. Codes are generated automatically by the system."
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
                  <th>For</th>
                  <th>Prefix</th>
                  <th>Number length</th>
                  <th>Next number</th>
                  <th>Next code</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.type}>
                    <td data-label="For"><strong>{s.label}</strong></td>
                    <td data-label="Prefix">{s.prefix}</td>
                    <td data-label="Number length">{s.padding}</td>
                    <td data-label="Next number">{s.nextNumber}</td>
                    <td data-label="Next code"><span className="badge green">{s.nextCode}</span></td>
                    <td data-label="Actions" className="actions-col">
                      <div className="row-actions">
                        <button className="btn sm" onClick={() => setEditing(s)}>Edit</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <SequenceForm
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

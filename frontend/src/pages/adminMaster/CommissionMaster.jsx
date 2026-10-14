import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { formatINR } from '../../utils/format.js';

const LIMIT = 10;
const FOR_LABEL = { employee: 'Employee (target-wise)', group_leader: 'Group leader' };
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

const showValue = (c) => (c.commissionType === 'percentage' ? `${c.commissionValue}%` : formatINR(c.commissionValue));
const showTarget = (c) =>
  c.targetFrom === null ? 'Any target' : `${formatINR(c.targetFrom)} – ${formatINR(c.targetTo)}`;

function CommissionForm({ item, years, ranks, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const activeYear = years.find((y) => y.isActive);
  const [form, setForm] = useState({
    commissionFor: item?.commissionFor || 'employee',
    financialYear: item?.financialYearId || activeYear?.id || '',
    rank: item?.rankId || '',
    targetFrom: item?.targetFrom === null || item?.targetFrom === undefined ? '' : String(item.targetFrom),
    targetTo: item?.targetTo === null || item?.targetTo === undefined ? '' : String(item.targetTo),
    commissionType: item?.commissionType || 'percentage',
    commissionValue: item ? String(item.commissionValue) : '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const isEmployee = form.commissionFor === 'employee';

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    const from = form.targetFrom.trim();
    const to = form.targetTo.trim();
    if (!form.financialYear) found.financialYear = 'Select a financial year';
    if (isEmployee && !from) found.targetFrom = 'Enter the target start amount';
    if (isEmployee && !to) found.targetTo = 'Enter the target end amount';
    if (!isEmployee && Boolean(from) !== Boolean(to)) found[from ? 'targetTo' : 'targetFrom'] = 'Enter both, or leave both empty';
    if (from && !MONEY_RE.test(from)) found.targetFrom = 'Enter a valid amount (up to 2 decimals)';
    if (to && !MONEY_RE.test(to)) found.targetTo = 'Enter a valid amount (up to 2 decimals)';
    if (!found.targetFrom && !found.targetTo && from && to && Number(to) < Number(from)) found.targetTo = 'Must not be less than the start';
    const value = form.commissionValue.trim();
    if (!MONEY_RE.test(value) || Number(value) <= 0) found.commissionValue = 'Enter a value greater than 0 (up to 2 decimals)';
    else if (form.commissionType === 'percentage' && Number(value) > 100) found.commissionValue = 'Percentage cannot exceed 100';
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const payload = {
        ...form,
        rank: isEmployee ? form.rank : '',
        targetFrom: from,
        targetTo: to,
        commissionValue: value,
      };
      if (isEdit) await api.commissions.update(item.id, payload);
      else await api.commissions.create(payload);
      toast.success(isEdit ? 'Commission updated' : 'Commission added');
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
      title={isEdit ? 'Edit commission' : 'Add commission'}
      onClose={onClose}
      busy={saving}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="commission-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Save commission'}
          </button>
        </>
      }
    >
      <form id="commission-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="commissionFor" label="Commission for" required error={errors.commissionFor}>
          <select id="commissionFor" value={form.commissionFor} onChange={set('commissionFor')} autoFocus>
            <option value="employee">Employee — target-wise</option>
            <option value="group_leader">Group leader</option>
          </select>
        </FormField>
        <FormField id="financialYear" label="Financial year" required error={errors.financialYear}>
          <select id="financialYear" value={form.financialYear} onChange={set('financialYear')}>
            <option value="">Select financial year</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}{y.isActive ? ' (active)' : ''}</option>
            ))}
          </select>
        </FormField>

        {isEmployee && (
          <FormField id="rank" label="Rank" error={errors.rank} className="span-2" hint="Leave on 'All ranks' to apply to every employee rank. A rank-specific slab is kept separately.">
            <select id="rank" value={form.rank} onChange={set('rank')}>
              <option value="">All ranks</option>
              {ranks.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </FormField>
        )}

        <FormField id="targetFrom" label={isEmployee ? 'Target from (₹)' : 'Target from (₹, optional)'} required={isEmployee} error={errors.targetFrom}>
          <input id="targetFrom" inputMode="decimal" value={form.targetFrom} onChange={set('targetFrom')} placeholder={isEmployee ? 'e.g. 0' : 'Leave empty for any target'} />
        </FormField>
        <FormField id="targetTo" label={isEmployee ? 'Target to (₹)' : 'Target to (₹, optional)'} required={isEmployee} error={errors.targetTo}>
          <input id="targetTo" inputMode="decimal" value={form.targetTo} onChange={set('targetTo')} placeholder={isEmployee ? 'e.g. 100000' : 'Leave empty for any target'} />
        </FormField>

        <FormField id="commissionType" label="Commission type" required error={errors.commissionType}>
          <select id="commissionType" value={form.commissionType} onChange={set('commissionType')}>
            <option value="percentage">Percentage (%)</option>
            <option value="fixed">Fixed amount (₹)</option>
          </select>
        </FormField>
        <FormField
          id="commissionValue"
          label={form.commissionType === 'percentage' ? 'Commission (%)' : 'Commission amount (₹)'}
          required
          error={errors.commissionValue}
        >
          <input id="commissionValue" inputMode="decimal" value={form.commissionValue} onChange={set('commissionValue')} />
        </FormField>
      </form>
    </Modal>
  );
}

export default function CommissionMaster() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [forFilter, setForFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [status, setStatus] = useState('');
  const [years, setYears] = useState([]);
  const [ranks, setRanks] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.financialYears.list().then((d) => setYears(d.items)).catch(() => {});
    api.ranks.options().then((d) => setRanks(d.items)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.commissions.list({ page, limit: LIMIT, commissionFor: forFilter, financialYear: yearFilter, status }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, forFilter, yearFilter, status]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [forFilter, yearFilter, status]);

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
  const hasFilters = forFilter || yearFilter || status;

  return (
    <>
      <PageHeader
        title="Commission Master"
        description="Employee commission by target slab, and group leader commission, set per financial year."
        actions={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Commission</button>}
      />

      <div className="panel">
        <div className="toolbar">
          <select value={forFilter} onChange={(e) => setForFilter(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            <option value="employee">Employee (target-wise)</option>
            <option value="group_leader">Group leader</option>
          </select>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} aria-label="Filter by financial year">
            <option value="">All financial years</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && <button className="btn" onClick={() => { setForFilter(''); setYearFilter(''); setStatus(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading commissions…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No commissions match your filters' : 'No commissions yet'}
            description={hasFilters ? 'Try changing or clearing the filters.' : years.length ? 'Add target slabs for employees and a rate for group leaders.' : 'Create a financial year first, then add commissions.'}
            action={!hasFilters && years.length > 0 && <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Commission</button>}
          />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>For</th>
                    <th>Financial year</th>
                    <th>Rank</th>
                    <th>Target range</th>
                    <th>Commission</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <td data-label="For"><strong>{FOR_LABEL[c.commissionFor]}</strong></td>
                      <td data-label="Financial year">{c.financialYear?.name || '—'}</td>
                      <td data-label="Rank">{c.commissionFor === 'employee' ? c.rank?.name || 'All ranks' : '—'}</td>
                      <td data-label="Target range">{showTarget(c)}</td>
                      <td data-label="Commission"><span className="badge green">{showValue(c)}</span></td>
                      <td data-label="Status"><StatusBadge active={c.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', item: c })}>Edit</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'status', item: c })}>{c.isActive ? 'Deactivate' : 'Activate'}</button>
                          <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', item: c })}>Delete</button>
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
        <CommissionForm
          item={dialog.item || null}
          years={years}
          ranks={ranks}
          onClose={closeDialog}
          onSaved={() => { closeDialog(); load(); }}
        />
      )}

      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.item?.isActive ? 'Deactivate commission?' : 'Activate commission?'}
        message={dialog?.item ? (dialog.item.isActive ? 'This commission rule will stop applying.' : 'This commission rule will apply again.') : ''}
        confirmLabel={dialog?.item?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() => run(() => api.commissions.setStatus(dialog.item.id, !dialog.item.isActive), dialog.item.isActive ? 'Commission deactivated' : 'Commission activated')}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete commission?"
        message={dialog?.item ? `Delete this ${FOR_LABEL[dialog.item.commissionFor].toLowerCase()} commission (${showValue(dialog.item)}, ${showTarget(dialog.item)})?` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.commissions.remove(dialog.item.id), 'Commission deleted')}
        onCancel={closeDialog}
      />
    </>
  );
}

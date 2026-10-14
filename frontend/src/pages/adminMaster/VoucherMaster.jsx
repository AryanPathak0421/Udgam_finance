import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useDebounce from '../../hooks/useDebounce.js';
import { formatDate } from '../../utils/format.js';

const LIMIT = 10;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function VoucherForm({ item, years, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const activeYear = years.find((y) => y.isActive);
  const [form, setForm] = useState({
    name: item?.name || '',
    financialYear: item?.financialYearId || activeYear?.id || '',
    month: item ? String(item.month) : '',
    fromDate: item?.fromDate || '',
    toDate: item?.toDate || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const year = years.find((y) => y.id === form.financialYear);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (form.name.trim().length < 2) found.name = 'Voucher name is required';
    if (!form.financialYear) found.financialYear = 'Select a financial year';
    if (!form.month) found.month = 'Select a month';
    if (!form.fromDate) found.fromDate = 'From date is required';
    if (!form.toDate) found.toDate = 'To date is required';
    if (form.fromDate && form.toDate && form.toDate < form.fromDate) found.toDate = 'To date must not be before from date';
    if (year && form.fromDate && form.fromDate < year.startDate) found.fromDate = `Must be on or after ${formatDate(year.startDate)}`;
    if (year && form.toDate && form.toDate > year.endDate) found.toDate = `Must be on or before ${formatDate(year.endDate)}`;
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const payload = { ...form, name: form.name.trim(), month: Number(form.month) };
      if (isEdit) await api.vouchers.update(item.id, payload);
      else await api.vouchers.create(payload);
      toast.success(isEdit ? 'Voucher updated' : 'Voucher added');
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
      title={isEdit ? `Edit voucher — ${item.name}` : 'Add voucher'}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="voucher-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Save voucher'}
          </button>
        </>
      }
    >
      <form id="voucher-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="name" label="Voucher name" required error={errors.name} className="span-2">
          <input id="name" value={form.name} onChange={set('name')} maxLength={80} autoFocus placeholder="e.g. April 2025 Voucher" />
        </FormField>
        <FormField id="financialYear" label="Financial year" required error={errors.financialYear}>
          <select id="financialYear" value={form.financialYear} onChange={set('financialYear')}>
            <option value="">Select financial year</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}{y.isActive ? ' (active)' : ''}</option>
            ))}
          </select>
        </FormField>
        <FormField id="month" label="Voucher month" required error={errors.month}>
          <select id="month" value={form.month} onChange={set('month')}>
            <option value="">Select month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </FormField>
        <FormField id="fromDate" label="From date" required error={errors.fromDate} hint={year ? `Within ${formatDate(year.startDate)} – ${formatDate(year.endDate)}` : undefined}>
          <input id="fromDate" type="date" min={year?.startDate} max={year?.endDate} value={form.fromDate} onChange={set('fromDate')} />
        </FormField>
        <FormField id="toDate" label="To date" required error={errors.toDate}>
          <input id="toDate" type="date" min={form.fromDate || year?.startDate} max={year?.endDate} value={form.toDate} onChange={set('toDate')} />
        </FormField>
      </form>
    </Modal>
  );
}

export default function VoucherMaster() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [status, setStatus] = useState('');
  const [years, setYears] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    api.financialYears.list().then((d) => setYears(d.items)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.vouchers.list({ page, limit: LIMIT, q, financialYear: yearFilter, month: monthFilter, status }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, yearFilter, monthFilter, status]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, yearFilter, monthFilter, status]);

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
  const hasFilters = q || yearFilter || monthFilter || status;

  return (
    <>
      <PageHeader
        title="Voucher Master"
        description="Voucher periods: a named month with a from–to date window inside a financial year."
        actions={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Voucher</button>}
      />

      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by voucher name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search vouchers" />
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} aria-label="Filter by financial year">
            <option value="">All financial years</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
          <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} aria-label="Filter by month">
            <option value="">All months</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && <button className="btn" onClick={() => { setSearch(''); setYearFilter(''); setMonthFilter(''); setStatus(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading vouchers…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No vouchers match your filters' : 'No vouchers yet'}
            description={hasFilters ? 'Try changing or clearing the filters.' : years.length ? 'Add a voucher period for each month.' : 'Create a financial year first, then add vouchers.'}
            action={!hasFilters && years.length > 0 && <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Voucher</button>}
          />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Voucher name</th>
                    <th>Financial year</th>
                    <th>Month</th>
                    <th>From date</th>
                    <th>To date</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((v) => (
                    <tr key={v.id}>
                      <td data-label="Voucher name"><strong>{v.name}</strong></td>
                      <td data-label="Financial year">{v.financialYear?.name || '—'}</td>
                      <td data-label="Month">{MONTHS[v.month - 1]}</td>
                      <td data-label="From date">{formatDate(v.fromDate)}</td>
                      <td data-label="To date">{formatDate(v.toDate)}</td>
                      <td data-label="Status"><StatusBadge active={v.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', item: v })}>Edit</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'status', item: v })}>{v.isActive ? 'Deactivate' : 'Activate'}</button>
                          <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', item: v })}>Delete</button>
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
        <VoucherForm
          item={dialog.item || null}
          years={years}
          onClose={closeDialog}
          onSaved={() => { closeDialog(); load(); }}
        />
      )}

      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.item?.isActive ? 'Deactivate voucher?' : 'Activate voucher?'}
        message={dialog?.item ? (dialog.item.isActive ? `${dialog.item.name} will be marked inactive.` : `${dialog.item.name} will be marked active again.`) : ''}
        confirmLabel={dialog?.item?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() => run(() => api.vouchers.setStatus(dialog.item.id, !dialog.item.isActive), dialog.item.isActive ? 'Voucher deactivated' : 'Voucher activated')}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete voucher?"
        message={dialog?.item ? `Delete voucher "${dialog.item.name}"? The month becomes available again.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.vouchers.remove(dialog.item.id), 'Voucher deleted')}
        onCancel={closeDialog}
      />
    </>
  );
}

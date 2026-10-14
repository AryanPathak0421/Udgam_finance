import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import BranchPicker from '../../components/ui/BranchPicker.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useDebounce from '../../hooks/useDebounce.js';
import { formatDate, formatINR, todayIso } from '../../utils/format.js';

const LIMIT = 10;
const EMPTY = { accountHolderName: '', accountNumber: '', bankName: '', ifsc: '', address: '', openingAmount: '', openDate: '', branches: [] };
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function BankForm({ initial, isEdit, branches, onClose, onSaved }) {
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
    if (form.accountHolderName.trim().length < 2) found.accountHolderName = 'Account holder name is required';
    if (!/^\d{9,18}$/.test(form.accountNumber.trim())) found.accountNumber = 'Account number must be 9–18 digits';
    if (form.bankName.trim().length < 2) found.bankName = 'Bank name is required';
    if (form.ifsc && !IFSC_RE.test(form.ifsc.trim().toUpperCase())) found.ifsc = 'Enter a valid IFSC (e.g. SBIN0001234)';
    if (form.address.trim().length < 5) found.address = 'Address is required (min 5 characters)';
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(String(form.openingAmount).trim())) found.openingAmount = 'Enter an amount (0 or more, up to 2 decimals)';
    if (!form.openDate) found.openDate = 'Open date is required';
    if (!form.branches.length) found.branches = 'Select at least one branch';
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      // Sent as a string so the server converts to paise without float error.
      const payload = { ...form, openingAmount: String(form.openingAmount).trim(), ifsc: form.ifsc.trim().toUpperCase() };
      if (isEdit) await api.bankAccounts.update(initial.id, payload);
      else await api.bankAccounts.create(payload);
      toast.success(isEdit ? 'Bank account updated' : 'Bank account added');
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
      title={isEdit ? 'Edit bank account' : 'Add bank account'}
      onClose={onClose}
      busy={saving}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="bank-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update account' : 'Save account'}
          </button>
        </>
      }
    >
      <form id="bank-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="accountHolderName" label="Account holder name" required error={errors.accountHolderName}>
          <input id="accountHolderName" value={form.accountHolderName} onChange={set('accountHolderName')} maxLength={100} autoFocus />
        </FormField>
        <FormField id="accountNumber" label="Account number" required error={errors.accountNumber}>
          <input id="accountNumber" inputMode="numeric" value={form.accountNumber} onChange={set('accountNumber')} maxLength={18} />
        </FormField>
        <FormField id="bankName" label="Bank name" required error={errors.bankName}>
          <input id="bankName" value={form.bankName} onChange={set('bankName')} maxLength={100} />
        </FormField>
        <FormField id="ifsc" label="IFSC code" error={errors.ifsc} hint="Optional">
          <input id="ifsc" value={form.ifsc} onChange={set('ifsc')} maxLength={11} style={{ textTransform: 'uppercase' }} />
        </FormField>
        <FormField id="address" label="Bank address" required error={errors.address} className="span-2">
          <textarea id="address" rows={2} value={form.address} onChange={set('address')} maxLength={300} />
        </FormField>
        <FormField id="openingAmount" label="Opening amount (₹)" required error={errors.openingAmount}>
          <input id="openingAmount" type="number" min={0} step="0.01" value={form.openingAmount} onChange={set('openingAmount')} />
        </FormField>
        <FormField id="openDate" label="Open date" required error={errors.openDate}>
          <input id="openDate" type="date" max={todayIso()} value={form.openDate} onChange={set('openDate')} />
        </FormField>
        <FormField id="branches" label="Branches" required error={errors.branches} className="span-2" hint="Select every branch that uses this account">
          <BranchPicker options={branches} value={form.branches} onChange={(v) => { setForm((f) => ({ ...f, branches: v })); setErrors((er) => ({ ...er, branches: undefined })); }} error={errors.branches} />
        </FormField>
      </form>
    </Modal>
  );
}

export default function BankAccountMaster() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const [branches, setBranches] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    api.branches.options().then((d) => setBranches(d.items)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.bankAccounts.list({ page, limit: LIMIT, q, branch, status }));
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
  const hasFilters = q || branch || status;
  const mask = (n) => `•••• ${n.slice(-4)}`;

  return (
    <>
      <PageHeader
        title="Bank Account Master"
        description="Company bank accounts, with the branches that operate each account."
        actions={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Bank Account</button>}
      />

      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search holder, account no. or bank" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search bank accounts" />
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Filter by branch">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && <button className="btn" onClick={() => { setSearch(''); setBranch(''); setStatus(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading bank accounts…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No accounts match your filters' : 'No bank accounts yet'}
            description={hasFilters ? 'Try changing or clearing the filters.' : 'Add the company bank accounts used for collections and disbursements.'}
            action={!hasFilters && <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Bank Account</button>}
          />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account holder</th>
                    <th>Bank</th>
                    <th>Account no.</th>
                    <th>Opening amount</th>
                    <th>Open date</th>
                    <th>Branches</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Account holder"><strong>{a.accountHolderName}</strong></td>
                      <td data-label="Bank">{a.bankName}</td>
                      <td data-label="Account no.">{mask(a.accountNumber)}</td>
                      <td data-label="Opening amount">{formatINR(a.openingAmount)}</td>
                      <td data-label="Open date">{formatDate(a.openDate)}</td>
                      <td data-label="Branches">{a.branches.map((b) => b.code).join(', ') || '—'}</td>
                      <td data-label="Status"><StatusBadge active={a.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'view', account: a })}>View</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', account: a })}>Edit</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'status', account: a })}>{a.isActive ? 'Deactivate' : 'Activate'}</button>
                          <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', account: a })}>Delete</button>
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
        <BankForm
          initial={dialog.account ? { ...dialog.account, openingAmount: String(dialog.account.openingAmount), branches: dialog.account.branches.map((b) => String(b.id)) } : EMPTY}
          isEdit={Boolean(dialog.account)}
          branches={branches}
          onClose={closeDialog}
          onSaved={() => { closeDialog(); load(); }}
        />
      )}

      <Modal
        open={dialog?.type === 'view'}
        title={dialog?.account ? `${dialog.account.bankName} — ${dialog.account.accountHolderName}` : ''}
        onClose={closeDialog}
        footer={<button className="btn" onClick={closeDialog}>Close</button>}
      >
        {dialog?.type === 'view' && (
          <DetailList
            items={[
              ['Account holder', dialog.account.accountHolderName],
              ['Account number', dialog.account.accountNumber],
              ['Bank name', dialog.account.bankName],
              ['IFSC', dialog.account.ifsc],
              ['Bank address', dialog.account.address],
              ['Opening amount', formatINR(dialog.account.openingAmount)],
              ['Open date', formatDate(dialog.account.openDate)],
              ['Status', dialog.account.isActive ? 'Active' : 'Inactive'],
              ['Branches', dialog.account.branches.map((b) => `${b.code} · ${b.name}`).join(', ')],
            ]}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.account?.isActive ? 'Deactivate account?' : 'Activate account?'}
        message={dialog?.account ? (dialog.account.isActive ? 'The account will be marked inactive.' : 'The account will be marked active again.') : ''}
        confirmLabel={dialog?.account?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() => run(() => api.bankAccounts.setStatus(dialog.account.id, !dialog.account.isActive), dialog.account.isActive ? 'Account deactivated' : 'Account activated')}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete bank account?"
        message={dialog?.account ? `Delete the ${dialog.account.bankName} account of ${dialog.account.accountHolderName}?` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.bankAccounts.remove(dialog.account.id), 'Bank account deleted')}
        onCancel={closeDialog}
      />
    </>
  );
}


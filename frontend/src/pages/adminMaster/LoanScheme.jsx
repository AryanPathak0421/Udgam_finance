import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useDebounce from '../../hooks/useDebounce.js';
import { formatINR } from '../../utils/format.js';

const LIMIT = 10;
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const CODE_RE = /^[A-Z0-9-]{2,12}$/;

export const LOAN_TYPES = [
  ['group', 'Group loan'],
  ['personal', 'Personal loan'],
  ['product', 'Product loan'],
  ['msme', 'MSME loan'],
  ['business', 'Business loan'],
];
export const MODE_OPTIONS = [
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['biweekly', 'Bi-weekly'],
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
  ['halfyearly', 'Half-yearly'],
  ['yearly', 'Yearly'],
];
const SECURITY_TYPES = [
  ['none', 'None'],
  ['group_guarantee', 'Group guarantee'],
  ['guarantor', 'Personal guarantor'],
  ['fixed_deposit', 'Fixed deposit lien'],
  ['gold', 'Gold'],
  ['property', 'Property'],
  ['vehicle', 'Vehicle'],
];
export const FINE_COUNTING = [
  ['per_day', 'Per day (every day overdue)'],
  ['per_month', 'Per month (every 30 days overdue)'],
  ['one_time', 'One time (once, when grace ends)'],
];
export const ROUNDING = [
  ['0', 'None (exact amount, no rounding)'],
  ['1', 'Nearest ₹1 (whole rupee)'],
  ['5', 'Nearest ₹5'],
  ['10', 'Nearest ₹10'],
];
const TERM_UNITS = [
  ['days', 'Days'],
  ['weeks', 'Weeks'],
  ['months', 'Months'],
];
const label = (list, key) => list.find(([k]) => k === key)?.[1] || key;
const charge = (c) => (c.type === 'percentage' ? `${c.value}%` : formatINR(c.value));

const EMPTY = {
  code: '', name: '', loanType: 'group',
  amountMin: '', amountMax: '',
  termUnit: 'months', termMin: '', termMax: '',
  ageMin: '18', ageMax: '60',
  roiMin: '', roiMax: '',
  modes: [], calculationType: 'flat', emiType: 'equal',
  securityType: 'none', securityDeposit: { type: 'percentage', value: '0' },
  processingFee: { type: 'percentage', value: '0' },
  cost: { type: 'percentage', value: '0' },
  installmentRounding: '1',
  gracePeriodDays: '0',
  fine: { type: 'fixed', value: '0', counting: 'per_day' },
};

const toForm = (s) => ({
  code: s.code, name: s.name, loanType: s.loanType,
  amountMin: String(s.amountMin), amountMax: String(s.amountMax),
  termUnit: s.termUnit, termMin: String(s.termMin), termMax: String(s.termMax),
  ageMin: String(s.ageMin), ageMax: String(s.ageMax),
  roiMin: String(s.roiMin), roiMax: String(s.roiMax),
  modes: s.modes, calculationType: s.calculationType, emiType: s.emiType,
  securityType: s.securityType,
  securityDeposit: { type: s.securityDeposit?.type || 'percentage', value: String(s.securityDeposit?.value ?? s.securityPercent ?? 0) },
  processingFee: { type: s.processingFee.type, value: String(s.processingFee.value) },
  cost: { type: s.cost.type, value: String(s.cost.value) },
  installmentRounding: String(s.installmentRounding ?? 1),
  gracePeriodDays: String(s.gracePeriodDays ?? 0),
  fine: { type: s.fine?.type || 'fixed', value: String(s.fine?.value ?? 0), counting: s.fine?.counting || 'per_day' },
});

function validate(f, isEdit) {
  const e = {};
  const money = (v) => MONEY_RE.test(String(v).trim());
  const int = (v) => /^\d+$/.test(String(v).trim());
  if (!isEdit && !CODE_RE.test(f.code.trim().toUpperCase())) e.code = 'Use 2–12 letters, numbers or hyphen';
  if (f.name.trim().length < 2) e.name = 'Scheme name is required';

  if (!money(f.amountMin) || Number(f.amountMin) < 1) e.amountMin = 'Enter a minimum amount';
  if (!money(f.amountMax) || Number(f.amountMax) < 1) e.amountMax = 'Enter a maximum amount';
  if (!e.amountMin && !e.amountMax && Number(f.amountMax) < Number(f.amountMin)) e.amountMax = 'Must not be less than minimum';

  if (!int(f.termMin) || Number(f.termMin) < 1) e.termMin = 'Enter a whole number';
  if (!int(f.termMax) || Number(f.termMax) < 1) e.termMax = 'Enter a whole number';
  if (!e.termMin && !e.termMax && Number(f.termMax) < Number(f.termMin)) e.termMax = 'Must not be less than minimum';

  if (!int(f.ageMin) || Number(f.ageMin) < 18 || Number(f.ageMin) > 100) e.ageMin = '18 to 100';
  if (!int(f.ageMax) || Number(f.ageMax) < 18 || Number(f.ageMax) > 100) e.ageMax = '18 to 100';
  if (!e.ageMin && !e.ageMax && Number(f.ageMax) < Number(f.ageMin)) e.ageMax = 'Must not be less than minimum';

  if (!money(f.roiMin) || Number(f.roiMin) > 100) e.roiMin = '0 to 100';
  if (!money(f.roiMax) || Number(f.roiMax) > 100) e.roiMax = '0 to 100';
  if (!e.roiMin && !e.roiMax && Number(f.roiMax) < Number(f.roiMin)) e.roiMax = 'Max ROI must not be less than Min ROI';

  if (!f.modes.length) e.modes = 'Select at least one loan mode';
  const dep = f.securityDeposit;
  if (!money(dep.value) || (dep.type === 'percentage' && Number(dep.value) > 100)) e.securityDeposit = dep.type === 'percentage' ? '0 to 100' : 'Enter an amount';
  else if (f.securityType === 'none' && Number(dep.value) > 0) e.securityDeposit = 'Choose a security type, or set 0';
  if (!int(f.gracePeriodDays) || Number(f.gracePeriodDays) > 365) e.gracePeriodDays = 'Whole days, 0 to 365';
  for (const k of ['processingFee', 'cost', 'fine']) {
    const c = f[k];
    if (!money(c.value) || (c.type === 'percentage' && Number(c.value) > 100)) e[k] = c.type === 'percentage' ? '0 to 100' : 'Enter an amount';
  }
  return e;
}

function SchemeForm({ item, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const [form, setForm] = useState(item ? toForm(item) : EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const setCharge = (key, part) => (e) => {
    setForm((f) => ({ ...f, [key]: { ...f[key], [part]: e.target.value } }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const toggleMode = (m) => {
    setForm((f) => ({ ...f, modes: f.modes.includes(m) ? f.modes.filter((x) => x !== m) : [...f.modes, m] }));
    setErrors((er) => ({ ...er, modes: undefined }));
  };
  const flat = form.calculationType === 'flat';

  async function submit(e) {
    e.preventDefault();
    const found = validate(form, isEdit);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        code: form.code.trim().toUpperCase(),
        emiType: flat ? 'equal' : form.emiType,
        installmentRounding: Number(form.installmentRounding),
      };
      if (isEdit) await api.loanSchemes.update(item.id, payload);
      else await api.loanSchemes.create(payload);
      toast.success(isEdit ? 'Loan scheme updated' : 'Loan scheme added');
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const ChargeField = ({ id, title, hint }) => (
    <FormField id={id} label={title} error={errors[id]} hint={hint}>
      <div className="inline-pair">
        <select aria-label={`${title} type`} value={form[id].type} onChange={setCharge(id, 'type')}>
          <option value="percentage">%</option>
          <option value="fixed">₹ fixed</option>
        </select>
        <input id={id} inputMode="decimal" value={form[id].value} onChange={setCharge(id, 'value')} />
      </div>
    </FormField>
  );

  return (
    <Modal
      open
      title={isEdit ? `Edit scheme — ${item.code}` : 'Add loan scheme'}
      onClose={onClose}
      busy={saving}
      size="xl"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="scheme-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update scheme' : 'Save scheme'}
          </button>
        </>
      }
    >
      <form id="scheme-form" onSubmit={submit} noValidate>
        <h4 className="form-section">Scheme</h4>
        <div className="form-grid cols-3">
          <FormField id="code" label="Scheme code" required error={errors.code} hint={isEdit ? 'Code cannot be changed' : 'Unique, e.g. GL-01'}>
            <input id="code" value={form.code} onChange={set('code')} disabled={isEdit} maxLength={12} style={{ textTransform: 'uppercase' }} autoFocus={!isEdit} />
          </FormField>
          <FormField id="name" label="Scheme name" required error={errors.name}>
            <input id="name" value={form.name} onChange={set('name')} maxLength={80} autoFocus={isEdit} />
          </FormField>
          <FormField id="loanType" label="Loan type" required error={errors.loanType}>
            <select id="loanType" value={form.loanType} onChange={set('loanType')}>
              {LOAN_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FormField>
        </div>

        <h4 className="form-section">Limits</h4>
        <div className="form-grid cols-4">
          <FormField id="amountMin" label="Amount from (₹)" required error={errors.amountMin}>
            <input id="amountMin" inputMode="decimal" value={form.amountMin} onChange={set('amountMin')} />
          </FormField>
          <FormField id="amountMax" label="Amount to (₹)" required error={errors.amountMax}>
            <input id="amountMax" inputMode="decimal" value={form.amountMax} onChange={set('amountMax')} />
          </FormField>
          <FormField id="ageMin" label="Borrower age from" required error={errors.ageMin}>
            <input id="ageMin" inputMode="numeric" value={form.ageMin} onChange={set('ageMin')} />
          </FormField>
          <FormField id="ageMax" label="Borrower age to" required error={errors.ageMax}>
            <input id="ageMax" inputMode="numeric" value={form.ageMax} onChange={set('ageMax')} />
          </FormField>
          <FormField id="termUnit" label="Term unit" required error={errors.termUnit}>
            <select id="termUnit" value={form.termUnit} onChange={set('termUnit')}>
              {TERM_UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FormField>
          <FormField id="termMin" label={`Term from (${form.termUnit})`} required error={errors.termMin}>
            <input id="termMin" inputMode="numeric" value={form.termMin} onChange={set('termMin')} />
          </FormField>
          <FormField id="termMax" label={`Term to (${form.termUnit})`} required error={errors.termMax}>
            <input id="termMax" inputMode="numeric" value={form.termMax} onChange={set('termMax')} />
          </FormField>
          <div />
          <FormField id="roiMin" label="Min ROI (% p.a.)" required error={errors.roiMin}>
            <input id="roiMin" inputMode="decimal" value={form.roiMin} onChange={set('roiMin')} />
          </FormField>
          <FormField id="roiMax" label="Max ROI (% p.a.)" required error={errors.roiMax}>
            <input id="roiMax" inputMode="decimal" value={form.roiMax} onChange={set('roiMax')} />
          </FormField>
        </div>

        <h4 className="form-section">Repayment</h4>
        <FormField id="modes" label="Loan modes allowed" required error={errors.modes}>
          <div className={`chip-row${errors.modes ? ' has-error' : ''}`}>
            {MODE_OPTIONS.map(([k, l]) => (
              <label key={k} className={`chip${form.modes.includes(k) ? ' on' : ''}`}>
                <input type="checkbox" checked={form.modes.includes(k)} onChange={() => toggleMode(k)} />
                {l}
              </label>
            ))}
          </div>
        </FormField>
        <div className="form-grid cols-3">
          <FormField id="calculationType" label="Calculation type" required error={errors.calculationType}>
            <select id="calculationType" value={form.calculationType} onChange={set('calculationType')}>
              <option value="flat">Flat</option>
              <option value="reducing">Reducing balance</option>
            </select>
          </FormField>
          <FormField id="emiType" label="EMI type" error={errors.emiType} hint={flat ? 'Flat loans always have equal installments' : undefined}>
            <select id="emiType" value={flat ? 'equal' : form.emiType} onChange={set('emiType')} disabled={flat}>
              <option value="equal">Equal installments (EMI)</option>
              <option value="equal_principal">Equal principal (declining)</option>
            </select>
          </FormField>
        </div>

        <h4 className="form-section">Security & charges</h4>
        <div className="form-grid cols-4">
          <FormField id="securityType" label="Security type" error={errors.securityType}>
            <select id="securityType" value={form.securityType} onChange={set('securityType')}>
              {SECURITY_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FormField>
          {ChargeField({ id: 'securityDeposit', title: 'Security deposit', hint: '% of the loan amount, or a fixed ₹' })}
          {ChargeField({ id: 'processingFee', title: 'Processing fee' })}
          {ChargeField({ id: 'cost', title: 'Cost (insurance / other)' })}
        </div>

        <h4 className="form-section">Late payment & rounding</h4>
        <div className="form-grid cols-4">
          <FormField id="gracePeriodDays" label="Grace period (days)" error={errors.gracePeriodDays} hint="No fine until this many days after the due date">
            <input id="gracePeriodDays" inputMode="numeric" value={form.gracePeriodDays} onChange={set('gracePeriodDays')} />
          </FormField>
          {ChargeField({ id: 'fine', title: 'Fine (on overdue installment)', hint: '% of the overdue installment, or a fixed ₹' })}
          <FormField id="fineCounting" label="Fine counting" error={errors.fineCounting} hint="How often the fine is added after the grace period">
            <select
              id="fineCounting"
              value={form.fine.counting}
              onChange={(e) => {
                const counting = e.target.value;
                setForm((f) => ({ ...f, fine: { ...f.fine, counting } }));
              }}
            >
              {FINE_COUNTING.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FormField>
          <FormField id="installmentRounding" label="Round installment to" error={errors.installmentRounding} hint="Whole-rupee installments are easier to collect">
            <select id="installmentRounding" value={form.installmentRounding} onChange={set('installmentRounding')}>
              {ROUNDING.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </FormField>
        </div>
      </form>
    </Modal>
  );
}

export default function LoanScheme() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.loanSchemes.list({ page, limit: LIMIT, q, loanType: typeFilter, status }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, typeFilter, status]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, typeFilter, status]);

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
  const hasFilters = q || typeFilter || status;

  return (
    <>
      <PageHeader
        title="Loan Scheme"
        description="Loan products: amount, term, age and ROI limits, allowed modes, calculation, security and charges."
        actions={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Scheme</button>}
      />

      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by scheme code or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search schemes" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by loan type">
            <option value="">All loan types</option>
            {LOAN_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && <button className="btn" onClick={() => { setSearch(''); setTypeFilter(''); setStatus(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading loan schemes…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No schemes match your filters' : 'No loan schemes yet'}
            description={hasFilters ? 'Try changing or clearing the filters.' : 'Add a scheme such as a group loan or a business loan.'}
            action={!hasFilters && <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Scheme</button>}
          />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Scheme</th>
                    <th>Amount</th>
                    <th>Term</th>
                    <th>ROI</th>
                    <th>Modes</th>
                    <th>Calculation</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id}>
                      <td data-label="Code"><strong>{s.code}</strong></td>
                      <td data-label="Scheme">{s.name}<div className="muted small">{label(LOAN_TYPES, s.loanType)}</div></td>
                      <td data-label="Amount">{formatINR(s.amountMin)} – {formatINR(s.amountMax)}</td>
                      <td data-label="Term">{s.termMin}–{s.termMax} {s.termUnit}</td>
                      <td data-label="ROI">{s.roiMin}% – {s.roiMax}%</td>
                      <td data-label="Modes">{s.modes.map((m) => label(MODE_OPTIONS, m)).join(', ')}</td>
                      <td data-label="Calculation">{s.calculationType === 'flat' ? 'Flat' : 'Reducing'}</td>
                      <td data-label="Status"><StatusBadge active={s.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'view', item: s })}>View</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', item: s })}>Edit</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'status', item: s })}>{s.isActive ? 'Deactivate' : 'Activate'}</button>
                          <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', item: s })}>Delete</button>
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
        <SchemeForm item={dialog.item || null} onClose={closeDialog} onSaved={() => { closeDialog(); load(); }} />
      )}

      <Modal
        open={dialog?.type === 'view'}
        title={dialog?.item ? `${dialog.item.name} (${dialog.item.code})` : ''}
        onClose={closeDialog}
        size="lg"
        footer={<button className="btn" onClick={closeDialog}>Close</button>}
      >
        {dialog?.type === 'view' && (
          <DetailList
            items={[
              ['Scheme code', dialog.item.code],
              ['Scheme name', dialog.item.name],
              ['Loan type', label(LOAN_TYPES, dialog.item.loanType)],
              ['Amount', `${formatINR(dialog.item.amountMin)} to ${formatINR(dialog.item.amountMax)}`],
              ['Term', `${dialog.item.termMin} to ${dialog.item.termMax} ${dialog.item.termUnit}`],
              ['Borrower age', `${dialog.item.ageMin} to ${dialog.item.ageMax} years`],
              ['ROI', `${dialog.item.roiMin}% to ${dialog.item.roiMax}% p.a.`],
              ['Loan modes', dialog.item.modes.map((m) => label(MODE_OPTIONS, m)).join(', ')],
              ['Calculation', dialog.item.calculationType === 'flat' ? 'Flat' : 'Reducing balance'],
              ['EMI type', dialog.item.emiType === 'equal' ? 'Equal installments' : 'Equal principal'],
              ['Security type', label(SECURITY_TYPES, dialog.item.securityType)],
              ['Security deposit', dialog.item.securityDeposit?.type === 'fixed' ? `₹${dialog.item.securityDeposit.value} fixed` : `${dialog.item.securityDeposit?.value ?? dialog.item.securityPercent}% of loan`],
              ['Processing fee', charge(dialog.item.processingFee)],
              ['Cost', charge(dialog.item.cost)],
              ['Installment rounding', dialog.item.installmentRounding ? `Nearest ₹${dialog.item.installmentRounding}` : 'None (exact)'],
              ['Grace period', `${dialog.item.gracePeriodDays} day(s)`],
              ['Fine', dialog.item.fine.value ? `${charge(dialog.item.fine)} · ${label(FINE_COUNTING, dialog.item.fine.counting)}` : 'No fine'],
              ['Status', dialog.item.isActive ? 'Active' : 'Inactive'],
            ]}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.item?.isActive ? 'Deactivate scheme?' : 'Activate scheme?'}
        message={dialog?.item ? (dialog.item.isActive ? `${dialog.item.name} will no longer be offered for new loans.` : `${dialog.item.name} will be offered for new loans again.`) : ''}
        confirmLabel={dialog?.item?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() => run(() => api.loanSchemes.setStatus(dialog.item.id, !dialog.item.isActive), dialog.item.isActive ? 'Scheme deactivated' : 'Scheme activated')}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete loan scheme?"
        message={dialog?.item ? `Delete ${dialog.item.name} (${dialog.item.code})? Its code becomes available again.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.loanSchemes.remove(dialog.item.id), 'Loan scheme deleted')}
        onCancel={closeDialog}
      />
    </>
  );
}



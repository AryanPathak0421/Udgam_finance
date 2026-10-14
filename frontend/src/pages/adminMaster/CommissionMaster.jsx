import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { formatINR } from '../../utils/format.js';

const LIMIT = 10;
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const COUNT_RE = /^\d{1,7}$/;
const COUNT_WORD = { new_group_opening: 'groups', new_member_joining: 'members' };

// Type helpers, built from the list the server sends (single source of truth).
function makeHelpers(typeList, legacy) {
  const all = [...typeList, legacy];
  const meta = (key) => all.find((t) => t.key === key);
  const isCount = (key) => meta(key)?.unit === 'count';
  return {
    meta,
    isCount,
    label: (key) => meta(key)?.label || key,
    target: (c) =>
      c.targetFrom === null
        ? 'Any target'
        : isCount(c.commissionFor)
          ? `${c.targetFrom} – ${c.targetTo} ${COUNT_WORD[c.commissionFor] || ''}`.trim()
          : `${formatINR(c.targetFrom)} – ${formatINR(c.targetTo)}`,
    value: (c) =>
      c.commissionType === 'percentage'
        ? `${c.commissionValue}%`
        : `${formatINR(c.commissionValue)}${isCount(c.commissionFor) ? ' each' : ''}`,
  };
}

// Options grouped as in the commission list (Collection & recovery, Loan disbursement, …).
function TypeOptions({ types, legacyKey, includeLegacy }) {
  const groups = [...new Set(types.map((t) => t.group))];
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {types.filter((t) => t.group === g).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </optgroup>
      ))}
      {includeLegacy && <option value={legacyKey.key}>{legacyKey.label}</option>}
    </>
  );
}

function CommissionForm({ item, types, legacy, years, ranks, helpers, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const activeYear = years.find((y) => y.isActive);
  const isLegacy = item?.commissionFor === legacy.key;
  const [form, setForm] = useState({
    commissionFor: isLegacy ? '' : item?.commissionFor || 'collection',
    financialYear: item?.financialYearId || activeYear?.id || '',
    rank: item?.rankId || '',
    targetFrom: item?.targetFrom === null || item?.targetFrom === undefined ? '' : String(item.targetFrom),
    targetTo: item?.targetTo === null || item?.targetTo === undefined ? '' : String(item.targetTo),
    commissionType: item?.commissionType || 'percentage',
    commissionValue: item ? String(item.commissionValue) : '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const count = helpers.isCount(form.commissionFor);
  const word = COUNT_WORD[form.commissionFor] || 'units';

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const onTypeChange = (e) => {
    const next = e.target.value;
    setForm((f) => ({ ...f, commissionFor: next, commissionType: helpers.isCount(next) ? 'fixed' : f.commissionType }));
    setErrors((er) => ({ ...er, commissionFor: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    const from = form.targetFrom.trim();
    const to = form.targetTo.trim();
    const valid = (x) => (count ? COUNT_RE.test(x) : MONEY_RE.test(x));
    if (!form.commissionFor) found.commissionFor = 'Select what this commission is for';
    if (!form.financialYear) found.financialYear = 'Select a financial year';
    if (Boolean(from) !== Boolean(to)) found[from ? 'targetTo' : 'targetFrom'] = 'Enter both, or leave both empty';
    if (from && !valid(from)) found.targetFrom = count ? 'Whole number' : 'Invalid amount (up to 2 decimals)';
    if (to && !valid(to)) found.targetTo = count ? 'Whole number' : 'Invalid amount (up to 2 decimals)';
    if (!found.targetFrom && !found.targetTo && from && to && Number(to) < Number(from)) found.targetTo = 'Must not be less than the start';
    const value = form.commissionValue.trim();
    if (!MONEY_RE.test(value) || Number(value) <= 0) found.commissionValue = 'Enter a value greater than 0 (up to 2 decimals)';
    else if (form.commissionType === 'percentage' && Number(value) > 100) found.commissionValue = 'Percentage cannot exceed 100';
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const payload = { ...form, targetFrom: from, targetTo: to, commissionValue: value };
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
        <FormField
          id="commissionFor"
          label="Commission for"
          required
          error={errors.commissionFor}
          className="span-2"
          hint={isLegacy ? 'This is an older generic commission. Choose the specific type it belongs to.' : undefined}
        >
          <select id="commissionFor" value={form.commissionFor} onChange={onTypeChange} autoFocus>
            {isLegacy && <option value="">Select commission type</option>}
            <TypeOptions types={types} />
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
        <FormField id="rank" label="Rank" error={errors.rank} hint="Add a separate commission for each rank, or keep All ranks">
          <select id="rank" value={form.rank} onChange={set('rank')}>
            <option value="">All ranks</option>
            {ranks.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </FormField>

        <FormField
          id="targetFrom"
          label={count ? `Target from (no. of ${word})` : 'Target from (₹)'}
          error={errors.targetFrom}
          hint="Leave both target fields empty to apply at any target"
        >
          <input id="targetFrom" inputMode={count ? 'numeric' : 'decimal'} value={form.targetFrom} onChange={set('targetFrom')} placeholder={count ? 'e.g. 1' : 'e.g. 0'} />
        </FormField>
        <FormField id="targetTo" label={count ? `Target to (no. of ${word})` : 'Target to (₹)'} error={errors.targetTo}>
          <input id="targetTo" inputMode={count ? 'numeric' : 'decimal'} value={form.targetTo} onChange={set('targetTo')} placeholder={count ? 'e.g. 10' : 'e.g. 100000'} />
        </FormField>

        <FormField id="commissionType" label="Commission type" required error={errors.commissionType} hint={count ? `A fixed amount for each ${word.replace(/s$/, '')}` : undefined}>
          <select id="commissionType" value={form.commissionType} onChange={set('commissionType')} disabled={count}>
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

const newRow = (prev, count) => {
  const next = prev && prev.targetTo !== '' && (count ? COUNT_RE : MONEY_RE).test(prev.targetTo) ? Number(prev.targetTo) + 1 : '';
  return {
    id: null,
    targetFrom: next === '' ? '' : String(Math.round(next * 100) / 100),
    targetTo: '',
    commissionType: count ? 'fixed' : prev?.commissionType || 'percentage',
    commissionValue: '',
    isActive: true,
  };
};

// Edits every slab of one scope together, so boundaries can be shifted in one save.
function ScopeEditor({ initial, types, legacy, years, ranks, helpers, onClose, onSaved }) {
  const toast = useToast();
  const activeYear = years.find((y) => y.isActive);
  const startType = initial && initial.commissionFor !== legacy.key ? initial.commissionFor : 'collection';
  const [scope, setScope] = useState({
    commissionFor: startType,
    financialYear: initial?.financialYearId || activeYear?.id || '',
    rank: initial?.rankId || '',
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const count = helpers.isCount(scope.commissionFor);
  const word = COUNT_WORD[scope.commissionFor] || 'units';
  const numRe = count ? COUNT_RE : MONEY_RE;

  // Load the slabs of the chosen scope.
  useEffect(() => {
    if (!scope.financialYear) {
      setRows([]);
      return undefined;
    }
    let live = true;
    setLoading(true);
    api.commissions
      .list({ commissionFor: scope.commissionFor, financialYear: scope.financialYear, limit: 100 })
      .then((d) => {
        if (!live) return;
        const mine = d.items
          .filter((c) => (c.rankId || '') === scope.rank)
          .sort((a, b) => (a.targetFrom ?? 0) - (b.targetFrom ?? 0))
          .map((c) => ({
            id: c.id,
            targetFrom: c.targetFrom === null ? '' : String(c.targetFrom),
            targetTo: c.targetTo === null ? '' : String(c.targetTo),
            commissionType: c.commissionType,
            commissionValue: String(c.commissionValue),
            isActive: c.isActive,
          }));
        setRows(mine);
        setErrors({});
      })
      .catch((err) => live && toast.error(err.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [scope.commissionFor, scope.financialYear, scope.rank]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (i, key, value) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
    setErrors((er) => ({ ...er, [`slabs.${i}.${key}`]: undefined }));
  };

  function localCheck() {
    const found = {};
    rows.forEach((r, i) => {
      const k = (f) => `slabs.${i}.${f}`;
      const from = r.targetFrom.trim();
      const to = r.targetTo.trim();
      if (Boolean(from) !== Boolean(to)) found[k(from ? 'targetTo' : 'targetFrom')] = 'Both or none';
      if (from && !numRe.test(from)) found[k('targetFrom')] = count ? 'Whole number' : 'Invalid amount';
      if (to && !numRe.test(to)) found[k('targetTo')] = count ? 'Whole number' : 'Invalid amount';
      if (!found[k('targetFrom')] && !found[k('targetTo')] && from && to && Number(to) < Number(from)) found[k('targetTo')] = 'Less than start';
      const val = r.commissionValue.trim();
      if (!MONEY_RE.test(val) || Number(val) <= 0) found[k('commissionValue')] = 'Required';
      else if (r.commissionType === 'percentage' && Number(val) > 100) found[k('commissionValue')] = 'Max 100';
    });
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = [Number(rows[i].targetFrom || 0), rows[i].targetTo === '' ? Infinity : Number(rows[i].targetTo)];
        const b = [Number(rows[j].targetFrom || 0), rows[j].targetTo === '' ? Infinity : Number(rows[j].targetTo)];
        if (a[0] <= b[1] && b[0] <= a[1]) {
          found[`slabs.${j}.targetFrom`] = `Overlaps row ${i + 1}`;
          found[`slabs.${i}.targetTo`] = `Overlaps row ${j + 1}`;
        }
      }
    }
    return found;
  }

  async function save() {
    const found = localCheck();
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await api.commissions.saveScope({
        ...scope,
        slabs: rows.map((r) => ({
          id: r.id || undefined,
          targetFrom: r.targetFrom.trim(),
          targetTo: r.targetTo.trim(),
          commissionType: r.commissionType,
          commissionValue: r.commissionValue.trim(),
          isActive: r.isActive,
        })),
      });
      toast.success('Commission slabs saved');
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const err = (i, f) => errors[`slabs.${i}.${f}`];

  return (
    <Modal
      open
      title="Edit commission slabs"
      onClose={onClose}
      busy={saving}
      size="xl"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving || loading || !scope.financialYear}>
            {saving ? 'Saving…' : 'Save all slabs'}
          </button>
        </>
      }
    >
      <div className="form-grid cols-3">
        <FormField id="scopeFor" label="Commission for">
          <select id="scopeFor" value={scope.commissionFor} onChange={(e) => setScope((s) => ({ ...s, commissionFor: e.target.value }))}>
            <TypeOptions types={types} />
          </select>
        </FormField>
        <FormField id="scopeYear" label="Financial year">
          <select id="scopeYear" value={scope.financialYear} onChange={(e) => setScope((s) => ({ ...s, financialYear: e.target.value }))}>
            <option value="">Select financial year</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? ' (active)' : ''}</option>)}
          </select>
        </FormField>
        <FormField id="scopeRank" label="Rank">
          <select id="scopeRank" value={scope.rank} onChange={(e) => setScope((s) => ({ ...s, rank: e.target.value }))}>
            <option value="">All ranks</option>
            {ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </FormField>
      </div>

      {errors.slabs && <div className="alert" role="alert" style={{ marginTop: 12 }}>{errors.slabs}</div>}
      <p className="muted small" style={{ margin: '12px 0 6px' }}>
        All rows are saved together, so boundaries can be shifted freely. Rows you remove are deleted when you save.
        {count ? ` Targets are number of ${word}; commission is a fixed amount for each.` : ' Leave both targets empty for a rule that applies at any target.'}
      </p>

      {loading ? (
        <Spinner label="Loading slabs…" />
      ) : (
        <div className="table-wrap">
          <table className="data-table slab-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{count ? `From (${word})` : 'Target from (₹)'}</th>
                <th>{count ? `To (${word})` : 'Target to (₹)'}</th>
                <th>Type</th>
                <th>Value</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: 'center' }}>No slabs yet for this selection. Add the first one.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id || `new-${i}`}>
                  <td data-label="#">{i + 1}</td>
                  <td data-label="From">
                    <input aria-label={`Row ${i + 1} target from`} className={err(i, 'targetFrom') ? 'bad' : ''} inputMode="decimal" value={r.targetFrom} onChange={(e) => setRow(i, 'targetFrom', e.target.value)} placeholder="Any" />
                    {err(i, 'targetFrom') && <div className="field-error">{err(i, 'targetFrom')}</div>}
                  </td>
                  <td data-label="To">
                    <input aria-label={`Row ${i + 1} target to`} className={err(i, 'targetTo') ? 'bad' : ''} inputMode="decimal" value={r.targetTo} onChange={(e) => setRow(i, 'targetTo', e.target.value)} placeholder="Any" />
                    {err(i, 'targetTo') && <div className="field-error">{err(i, 'targetTo')}</div>}
                  </td>
                  <td data-label="Type">
                    <select aria-label={`Row ${i + 1} type`} value={r.commissionType} onChange={(e) => setRow(i, 'commissionType', e.target.value)} disabled={count}>
                      <option value="percentage">%</option>
                      <option value="fixed">₹ fixed</option>
                    </select>
                    {err(i, 'commissionType') && <div className="field-error">{err(i, 'commissionType')}</div>}
                  </td>
                  <td data-label="Value">
                    <input aria-label={`Row ${i + 1} value`} className={err(i, 'commissionValue') ? 'bad' : ''} inputMode="decimal" value={r.commissionValue} onChange={(e) => setRow(i, 'commissionValue', e.target.value)} />
                    {err(i, 'commissionValue') && <div className="field-error">{err(i, 'commissionValue')}</div>}
                  </td>
                  <td className="actions-col">
                    <button className="btn sm danger-outline" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} aria-label={`Remove row ${i + 1}`}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (
        <button className="btn" style={{ marginTop: 12 }} onClick={() => setRows((rs) => [...rs, newRow(rs[rs.length - 1], count)])}>
          + Add slab
        </button>
      )}
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
  const [rankFilter, setRankFilter] = useState('');
  const [status, setStatus] = useState('');
  const [types, setTypes] = useState([]);
  const [legacy, setLegacy] = useState({ key: 'employee', label: 'Employee (legacy)', unit: 'amount', group: 'Legacy' });
  const [years, setYears] = useState([]);
  const [ranks, setRanks] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.commissions.types().then((d) => { setTypes(d.types); setLegacy(d.legacy); }).catch(() => {});
    api.financialYears.list().then((d) => setYears(d.items)).catch(() => {});
    api.ranks.options().then((d) => setRanks(d.items)).catch(() => {});
  }, []);

  const helpers = useMemo(() => makeHelpers(types, legacy), [types, legacy]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.commissions.list({ page, limit: LIMIT, commissionFor: forFilter, financialYear: yearFilter, rank: rankFilter, status }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, forFilter, yearFilter, rankFilter, status]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [forFilter, yearFilter, rankFilter, status]);

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
  const hasFilters = forFilter || yearFilter || rankFilter || status;
  const showLegacyOption = data.items.some((c) => c.commissionFor === legacy.key) || forFilter === legacy.key;

  return (
    <>
      <PageHeader
        title="Commission Master"
        description="Commission by type — collection, NPA recovery, disbursement, new groups and members, group leader — per financial year and rank."
        actions={
          <>
            <button className="btn" onClick={() => setDialog({ type: 'scope' })}>Edit all slabs</button>
            <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Commission</button>
          </>
        }
      />

      <div className="panel">
        <div className="toolbar">
          <select value={forFilter} onChange={(e) => setForFilter(e.target.value)} aria-label="Filter by commission for">
            <option value="">All commission types</option>
            <TypeOptions types={types} legacyKey={legacy} includeLegacy={showLegacyOption} />
          </select>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} aria-label="Filter by financial year">
            <option value="">All financial years</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
          <select value={rankFilter} onChange={(e) => setRankFilter(e.target.value)} aria-label="Filter by rank">
            <option value="">All ranks</option>
            {ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && <button className="btn" onClick={() => { setForFilter(''); setYearFilter(''); setRankFilter(''); setStatus(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading commissions…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No commissions match your filters' : 'No commissions yet'}
            description={hasFilters ? 'Try changing or clearing the filters.' : years.length ? 'Add a commission for a type, financial year and rank.' : 'Create a financial year first, then add commissions.'}
            action={!hasFilters && years.length > 0 && <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Commission</button>}
          />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Commission for</th>
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
                      <td data-label="Commission for">
                        <strong>{helpers.label(c.commissionFor)}</strong>
                        {c.commissionFor === legacy.key && <div className="muted small">Edit to move to a specific type</div>}
                      </td>
                      <td data-label="Financial year">{c.financialYear?.name || '—'}</td>
                      <td data-label="Rank">{c.rank?.name || 'All ranks'}</td>
                      <td data-label="Target range">{helpers.target(c)}</td>
                      <td data-label="Commission"><span className="badge green">{helpers.value(c)}</span></td>
                      <td data-label="Status"><StatusBadge active={c.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', item: c })}>Edit</button>
                          {c.commissionFor !== legacy.key && (
                            <button className="btn sm" onClick={() => setDialog({ type: 'scope', item: c })} title="Edit every slab of this type, year and rank together">Edit slabs</button>
                          )}
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

      {dialog?.type === 'scope' && (
        <ScopeEditor
          initial={dialog.item || null}
          types={types}
          legacy={legacy}
          years={years}
          ranks={ranks}
          helpers={helpers}
          onClose={closeDialog}
          onSaved={() => { closeDialog(); load(); }}
        />
      )}

      {dialog?.type === 'form' && (
        <CommissionForm
          item={dialog.item || null}
          types={types}
          legacy={legacy}
          years={years}
          ranks={ranks}
          helpers={helpers}
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
        message={dialog?.item ? `Delete this ${helpers.label(dialog.item.commissionFor).toLowerCase()} (${helpers.value(dialog.item)}, ${helpers.target(dialog.item)})?` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.commissions.remove(dialog.item.id), 'Commission deleted')}
        onCancel={closeDialog}
      />
    </>
  );
}

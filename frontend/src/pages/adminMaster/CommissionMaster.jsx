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
const UNIT_WORD = { loans: 'loans', members: 'members', groups: 'groups', products: 'products', amount: '₹' };
const SCOPE_LABEL = { own: 'Own activity', branch: 'Whole branch (all staff)', supervised: 'Supervised branches' };
const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const APPLIES_LABEL = {
  all: 'Rate applies to ALL units once the slab is reached',
  incremental: 'Rate applies only to the units inside each slab',
};
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const isCountUnit = (u) => u !== 'amount';
const unitRe = (u) => (isCountUnit(u) ? COUNT_RE : MONEY_RE);
const fmtMeasure = (unit, n) => (n === null || n === undefined ? '—' : unit === 'amount' ? formatINR(n) : `${n} ${UNIT_WORD[unit]}`);
const blankToStr = (n) => (n === null || n === undefined ? '' : String(n));

// ---------------------------------------------------------------------------------------
// Vocabulary from the server (single source of truth): types, bases, units.
function makeHelpers(cfg) {
  const types = cfg?.types || [];
  const legacy = cfg?.legacy || { key: 'employee', label: 'Employee (legacy)', bases: ['loan_amount'], units: ['amount'], group: 'Legacy' };
  const bases = Object.fromEntries((cfg?.bases || []).map((b) => [b.key, b]));
  const units = Object.fromEntries((cfg?.units || []).map((u) => [u.key, u.label]));
  const all = [...types, legacy];
  const meta = (key) => all.find((t) => t.key === key);

  const singular = (unit) => UNIT_WORD[unit]?.replace(/s$/, '') || 'unit';
  return {
    types,
    legacy,
    bases,
    units,
    meta,
    label: (key) => meta(key)?.label || key,
    target: (c) => {
      if (c.commissionFor === 'group_leader') return 'Per loan disbursed';
      if (c.targetFrom === null && c.targetTo === null) return 'Any target';
      return `${fmtMeasure(c.targetUnit, c.targetFrom ?? 0)} – ${c.targetTo === null ? 'no limit' : fmtMeasure(c.targetUnit, c.targetTo)}`;
    },
    value: (c) => {
      if (c.commissionFor === 'group_leader' && c.durationMonths) {
        return `${formatINR(c.commissionValue)} / loan / month × ${c.durationMonths} months${c.startDelayMonths === 0 ? '' : ' (from next month)'}`;
      }
      if (c.commissionType === 'percentage') return `${c.commissionValue}% of ${(bases[c.basis]?.label || 'amount').toLowerCase()}`;
      return bases[c.basis]?.fixedOnly ? `${formatINR(c.commissionValue)} per ${singular(c.targetUnit)}` : `${formatINR(c.commissionValue)} fixed`;
    },
    rules: (c) => {
      if (c.commissionFor === 'group_leader') return null;
      const parts = [];
      if (c.minEligibility !== null) parts.push(`Eligible from ${fmtMeasure(c.targetUnit, c.minEligibility)}`);
      if (c.maxCommission !== null) parts.push(`Max ${formatINR(c.maxCommission)}`);
      parts.push(FREQ_LABEL[c.frequency]);
      return parts.join(' · ');
    },
    firstBasis: (type) => meta(type)?.bases?.[0] || 'loan_amount',
    firstUnit: (type, basis) => {
      const allowed = meta(type)?.units || ['amount'];
      const natural = bases[basis]?.unit;
      return natural && allowed.includes(natural) ? natural : allowed[0];
    },
    singular,
  };
}

// Options grouped as in the commission list (Collection & recovery, Loan disbursement, …).
function TypeOptions({ types, legacy, includeLegacy }) {
  const groups = [...new Set(types.map((t) => t.group))];
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {types.filter((t) => t.group === g).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </optgroup>
      ))}
      {includeLegacy && <option value={legacy.key}>{legacy.label}</option>}
    </>
  );
}

// Pill toggles for choosing several values (financial years, ranks).
function ChipSelect({ options, value, onChange, emptyLabel }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="chip-row">
      {emptyLabel && (
        <label className={`chip${value.length === 0 ? ' on' : ''}`}>
          <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} />
          {emptyLabel}
        </label>
      )}
      {options.map((o) => (
        <label key={o.id} className={`chip${value.includes(o.id) ? ' on' : ''}`}>
          <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// "What would this pay?" using the real engine, with the rule as currently typed.
function TierPreview({ rule, slabs }) {
  const [measure, setMeasure] = useState('35');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const sig = JSON.stringify({ rule, slabs, measure });

  useEffect(() => {
    const usable = slabs.filter((s) => MONEY_RE.test(String(s.commissionValue).trim()) && Number(s.commissionValue) > 0);
    if (!usable.length || !unitRe(rule.targetUnit).test(String(measure).trim())) {
      setResult(null);
      setError('');
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      api.commissions
        .previewTier({ ...rule, slabs: usable, measure: String(measure).trim() })
        .then((r) => live && (setResult(r), setError('')))
        .catch((err) => live && (setResult(null), setError(err.errors ? Object.values(err.errors)[0] : err.message)));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const unit = rule.targetUnit;
  return (
    <div className="gl-preview">
      <div className="gl-preview-head">
        <strong>Try it</strong>
        <span className="muted small">What this rule pays for a given {unit === 'amount' ? 'amount' : `number of ${UNIT_WORD[unit]}`}</span>
      </div>
      <div className="gl-preview-inputs">
        <label>
          {unit === 'amount' ? 'Amount achieved (₹)' : `Number of ${UNIT_WORD[unit]} in the period`}
          <input inputMode={unit === 'amount' ? 'decimal' : 'numeric'} value={measure} onChange={(e) => setMeasure(e.target.value)} />
        </label>
      </div>
      {error && <div className="field-error">{error}</div>}
      {!result && !error && <div className="muted small">Fill in the commission value to see the payout.</div>}
      {result && (
        <>
          {!result.eligible ? (
            <div className="notice">Not eligible yet — below the minimum eligibility. Payout: <strong>{formatINR(0)}</strong></div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead>
                    <tr><th>From</th><th className="num">{unit === 'amount' ? 'Amount' : 'Units'}</th><th className="num">Commission</th></tr>
                  </thead>
                  <tbody>
                    {result.breakdown.map((b, i) => (
                      <tr key={i}>
                        <td>{fmtMeasure(unit, b.from)}</td>
                        <td className="num">{b.bonus ? 'bonus' : b.units !== null ? b.units : fmtMeasure('amount', b.base)}</td>
                        <td className="num">{formatINR(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={2}><strong>Payout{result.capped ? ' (capped)' : ''}</strong></td><td className="num"><strong>{formatINR(result.amount)}</strong></td></tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// "What would the group leader earn?" — runs the real calculation on the server.
function GroupLeaderPreview({ amount, durationMonths, startDelayMonths }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loans, setLoans] = useState('1');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const a = String(amount).trim();
    const m = Number(durationMonths);
    const n = Number(loans);
    if (!MONEY_RE.test(a) || Number(a) <= 0 || !Number.isInteger(m) || m < 1 || m > 36 || !/^\d+$/.test(String(loans)) || !month) {
      setResult(null);
      setError('');
      return undefined;
    }
    let live = true;
    const t = setTimeout(() => {
      api.commissions
        .previewGroupLeader({ amount: a, durationMonths: m, startDelayMonths, disbursements: [{ month, loans: n }] })
        .then((r) => live && (setResult(r), setError('')))
        .catch((err) => live && (setResult(null), setError(err.message)));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [amount, durationMonths, startDelayMonths, month, loans]);

  return (
    <div className="gl-preview">
      <div className="gl-preview-head">
        <strong>Preview</strong>
        <span className="muted small">Loans disbursed in one month, in one group</span>
      </div>
      <div className="gl-preview-inputs">
        <label>
          Disbursement month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <label>
          Loans disbursed
          <input inputMode="numeric" value={loans} onChange={(e) => setLoans(e.target.value)} />
        </label>
      </div>
      {error && <div className="field-error">{error}</div>}
      {!result && !error && <div className="muted small">Enter the amount and duration to see the monthly commission.</div>}
      {result && (
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr><th>Month</th><th className="num">Loans</th><th className="num">Commission</th></tr>
            </thead>
            <tbody>
              <tr className="muted">
                <td>{month ? monthLabel(month) : ''} (disbursement)</td>
                <td className="num">{loans}</td>
                <td className="num">{startDelayMonths === 1 ? formatINR(0) : '—'}</td>
              </tr>
              {result.months.map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month)}</td>
                  <td className="num">{m.eligibleLoans}</td>
                  <td className="num">{formatINR(m.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}><strong>Total</strong></td><td className="num"><strong>{formatINR(result.total)}</strong></td></tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Rule-level fields shared by the single form and the slab editor:
// basis, target unit, whose activity counts, how the rate applies, eligibility, cap, frequency.
function RuleFields({ rule, setRule, helpers, errors, idPrefix = '' }) {
  const meta = helpers.meta(rule.commissionFor);
  const unit = rule.targetUnit;
  const id = (n) => `${idPrefix}${n}`;
  const set = (key) => (e) => setRule((r) => ({ ...r, [key]: e.target.value }));

  return (
    <div className="form-grid cols-3">
      <FormField id={id('basis')} label="Commission basis" required error={errors.basis} hint="What the commission value is applied to">
        <select
          id={id('basis')}
          value={rule.basis}
          onChange={(e) => {
            const basis = e.target.value;
            setRule((r) => ({
              ...r,
              basis,
              targetUnit: helpers.firstUnit(r.commissionFor, basis),
              commissionType: helpers.bases[basis]?.fixedOnly ? 'fixed' : r.commissionType,
            }));
          }}
        >
          {(meta?.bases || []).map((b) => <option key={b} value={b}>{helpers.bases[b]?.label || b}</option>)}
        </select>
      </FormField>
      <FormField id={id('targetUnit')} label="Target unit" required error={errors.targetUnit} hint="What the target and eligibility are measured in">
        <select id={id('targetUnit')} value={unit} onChange={set('targetUnit')}>
          {(meta?.units || ['amount']).map((u) => <option key={u} value={u}>{helpers.units[u] || u}</option>)}
        </select>
      </FormField>
      <FormField id={id('scope')} label="Whose activity counts" error={errors.scope}>
        <select id={id('scope')} value={rule.scope} onChange={set('scope')}>
          {Object.entries(SCOPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </FormField>

      <FormField
        id={id('minEligibility')}
        label={`Minimum eligibility (${unit === 'amount' ? '₹' : UNIT_WORD[unit]})`}
        error={errors.minEligibility}
        hint="Nothing is paid until this much is reached"
      >
        <input id={id('minEligibility')} inputMode={isCountUnit(unit) ? 'numeric' : 'decimal'} value={rule.minEligibility} onChange={set('minEligibility')} placeholder="e.g. 30" />
      </FormField>
      <FormField id={id('maxCommission')} label="Maximum commission (₹)" error={errors.maxCommission} hint="Payout limit per period, if any">
        <input id={id('maxCommission')} inputMode="decimal" value={rule.maxCommission} onChange={set('maxCommission')} placeholder="No limit" />
      </FormField>
      <FormField id={id('frequency')} label="Commission frequency" required error={errors.frequency} hint="How often it is calculated and paid">
        <select id={id('frequency')} value={rule.frequency} onChange={set('frequency')}>
          {Object.entries(FREQ_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </FormField>

      <FormField id={id('rateAppliesTo')} label="How the rate applies" error={errors.rateAppliesTo} className="span-3">
        <select id={id('rateAppliesTo')} value={rule.rateAppliesTo} onChange={set('rateAppliesTo')}>
          {Object.entries(APPLIES_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </FormField>
    </div>
  );
}

const ruleDefaults = (helpers, type = 'collection') => {
  const basis = helpers.firstBasis(type);
  return {
    commissionFor: type,
    basis,
    targetUnit: helpers.firstUnit(type, basis),
    scope: 'own',
    frequency: 'monthly',
    rateAppliesTo: 'all',
    minEligibility: '',
    maxCommission: '',
    commissionType: helpers.bases[basis]?.fixedOnly ? 'fixed' : 'percentage',
  };
};

// ---------------------------------------------------------------------------------------
function CommissionForm({ item, helpers, years, ranks, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const activeYear = years.find((y) => y.isActive);
  const isLegacy = item?.commissionFor === helpers.legacy.key;
  const startType = isLegacy ? 'collection' : item?.commissionFor || 'collection';

  const [rule, setRule] = useState(() =>
    item
      ? {
          commissionFor: isLegacy ? '' : item.commissionFor,
          basis: item.basis,
          targetUnit: item.targetUnit,
          scope: item.scope,
          frequency: item.frequency,
          rateAppliesTo: item.rateAppliesTo,
          minEligibility: blankToStr(item.minEligibility),
          maxCommission: blankToStr(item.maxCommission),
          commissionType: item.commissionType,
        }
      : ruleDefaults(helpers, startType)
  );
  const [slab, setSlab] = useState({
    targetFrom: blankToStr(item?.targetFrom),
    targetTo: blankToStr(item?.targetTo),
    commissionValue: item ? String(item.commissionValue) : '',
    durationMonths: item?.durationMonths ? String(item.durationMonths) : '4',
    startDelayMonths: item?.startDelayMonths === 0 ? 0 : 1,
  });
  const [yearIds, setYearIds] = useState(item ? [item.financialYearId] : activeYear ? [activeYear.id] : []);
  const [rankIds, setRankIds] = useState(item?.rankId ? [item.rankId] : []);
  const [isActive, setIsActive] = useState(item ? item.isActive : true);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const isGL = rule.commissionFor === 'group_leader';
  const fixedOnly = helpers.bases[rule.basis]?.fixedOnly;
  const unit = rule.targetUnit;
  const setSlabField = (key) => (e) => {
    setSlab((s) => ({ ...s, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  function onTypeChange(e) {
    const next = e.target.value;
    setRule((r) => ({ ...ruleDefaults(helpers, next), scope: r.scope, frequency: r.frequency }));
    setErrors((er) => ({ ...er, commissionFor: undefined }));
  }

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!rule.commissionFor) found.commissionFor = 'Select what this commission is for';
    if (!yearIds.length) found.financialYear = 'Select at least one financial year';
    if (isEdit && yearIds.length !== 1) found.financialYear = 'Select one financial year';

    const value = slab.commissionValue.trim();
    if (isGL) {
      const m = Number(slab.durationMonths);
      if (!Number.isInteger(m) || m < 1 || m > 36) found.durationMonths = 'Whole months, 1 to 36';
      if (!MONEY_RE.test(value) || Number(value) <= 0) found.commissionValue = 'Enter the amount per loan per month';
    } else {
      const re = unitRe(unit);
      const from = slab.targetFrom.trim();
      const to = slab.targetTo.trim();
      if (from && !re.test(from)) found.targetFrom = isCountUnit(unit) ? 'Whole number' : 'Invalid amount (up to 2 decimals)';
      if (to && !re.test(to)) found.targetTo = isCountUnit(unit) ? 'Whole number' : 'Invalid amount (up to 2 decimals)';
      if (!found.targetFrom && !found.targetTo && from && to && Number(to) < Number(from)) found.targetTo = 'Must not be less than the start';
      if (rule.minEligibility.trim() && !re.test(rule.minEligibility.trim())) found.minEligibility = isCountUnit(unit) ? 'Whole number' : 'Invalid amount';
      if (rule.maxCommission.trim() && (!MONEY_RE.test(rule.maxCommission.trim()) || Number(rule.maxCommission) <= 0)) found.maxCommission = 'Invalid amount';
      if (!MONEY_RE.test(value) || Number(value) <= 0) found.commissionValue = 'Enter a value greater than 0 (up to 2 decimals)';
      else if (rule.commissionType === 'percentage' && Number(value) > 100) found.commissionValue = 'Percentage cannot exceed 100';
    }
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const common = { commissionFor: rule.commissionFor, isActive };
      let payload;
      if (isGL) {
        payload = {
          ...common,
          commissionType: 'fixed',
          commissionValue: value,
          durationMonths: Number(slab.durationMonths),
          startDelayMonths: slab.startDelayMonths,
        };
      } else {
        payload = {
          ...common,
          basis: rule.basis,
          targetUnit: rule.targetUnit,
          scope: rule.scope,
          frequency: rule.frequency,
          rateAppliesTo: rule.rateAppliesTo,
          minEligibility: rule.minEligibility.trim(),
          maxCommission: rule.maxCommission.trim(),
          commissionType: rule.commissionType,
          commissionValue: value,
          targetFrom: slab.targetFrom.trim(),
          targetTo: slab.targetTo.trim(),
        };
      }
      if (isEdit) {
        await api.commissions.update(item.id, { ...payload, financialYear: yearIds[0], rank: rankIds[0] || '' });
        toast.success('Commission updated');
      } else {
        const res = await api.commissions.create({ ...payload, financialYears: yearIds, ranks: rankIds });
        toast.success(res.commissions.length > 1 ? `${res.commissions.length} commissions added` : 'Commission added');
      }
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
      size="xl"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="commission-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update' : 'Save commission'}
          </button>
        </>
      }
    >
      <form id="commission-form" onSubmit={submit} noValidate>
        <h4 className="form-section">Who and when</h4>
        <div className="form-grid cols-3">
          <FormField
            id="commissionFor"
            label="Commission for"
            required
            error={errors.commissionFor}
            className="span-2"
            hint={isLegacy ? 'This is an older generic commission. Choose the specific type it belongs to.' : undefined}
          >
            <select id="commissionFor" value={rule.commissionFor} onChange={onTypeChange} autoFocus>
              {isLegacy && <option value="">Select commission type</option>}
              <TypeOptions types={helpers.types} />
            </select>
          </FormField>
          <FormField id="status" label="Status">
            <select id="status" value={isActive ? 'active' : 'inactive'} onChange={(e) => setIsActive(e.target.value === 'active')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FormField>

          <FormField
            id="financialYear"
            label={isEdit ? 'Financial year' : 'Financial year (select one or more)'}
            required
            error={errors.financialYear}
            className="span-3"
          >
            {isEdit ? (
              <select id="financialYear" value={yearIds[0] || ''} onChange={(e) => setYearIds([e.target.value])}>
                <option value="">Select financial year</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? ' (active)' : ''}</option>)}
              </select>
            ) : (
              <ChipSelect options={years.map((y) => ({ id: y.id, label: `${y.name}${y.isActive ? ' (active)' : ''}` }))} value={yearIds} onChange={setYearIds} />
            )}
          </FormField>

          <FormField
            id="rank"
            label={isEdit ? 'Rank' : 'Rank (select one or more)'}
            error={errors.rank}
            className="span-3"
            hint={isEdit ? undefined : 'The same commission is created for every selected rank. "All ranks" applies to everyone.'}
          >
            {isEdit ? (
              <select id="rank" value={rankIds[0] || ''} onChange={(e) => setRankIds(e.target.value ? [e.target.value] : [])}>
                <option value="">All ranks</option>
                {ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            ) : (
              <ChipSelect options={ranks.map((r) => ({ id: r.id, label: r.name }))} value={rankIds} onChange={setRankIds} emptyLabel="All ranks" />
            )}
          </FormField>
        </div>

        {isGL ? (
          <>
            <h4 className="form-section">Group leader rule</h4>
            <div className="form-grid">
              <FormField id="commissionValue" label="Commission per loan, per month (₹)" required error={errors.commissionValue} hint="Paid to the group leader for every loan disbursed in the group">
                <input id="commissionValue" inputMode="decimal" value={slab.commissionValue} onChange={setSlabField('commissionValue')} placeholder="e.g. 25" />
              </FormField>
              <FormField id="durationMonths" label="Commission duration (months)" required error={errors.durationMonths} hint="How many months each loan earns commission">
                <input id="durationMonths" inputMode="numeric" value={slab.durationMonths} onChange={setSlabField('durationMonths')} />
              </FormField>
              <div className="span-2">
                <label className="check-row">
                  <input type="checkbox" checked={slab.startDelayMonths === 1} onChange={(e) => setSlab((s) => ({ ...s, startDelayMonths: e.target.checked ? 1 : 0 }))} />
                  <span>
                    <strong>No commission in the disbursement month</strong>
                    <small className="muted">Commission starts from the month after the loan is disbursed</small>
                  </span>
                </label>
              </div>
              <div className="span-2">
                <GroupLeaderPreview amount={slab.commissionValue} durationMonths={slab.durationMonths} startDelayMonths={slab.startDelayMonths} />
              </div>
            </div>
          </>
        ) : (
          <>
            <h4 className="form-section">How it is calculated</h4>
            <RuleFields rule={rule} setRule={setRule} helpers={helpers} errors={errors} />

            <h4 className="form-section">Target and value</h4>
            <div className="form-grid cols-4">
              <FormField
                id="targetFrom"
                label={`Target from (${unit === 'amount' ? '₹' : UNIT_WORD[unit]})`}
                error={errors.targetFrom}
                hint="Empty = from the start"
              >
                <input id="targetFrom" inputMode={isCountUnit(unit) ? 'numeric' : 'decimal'} value={slab.targetFrom} onChange={setSlabField('targetFrom')} placeholder="e.g. 30" />
              </FormField>
              <FormField
                id="targetTo"
                label={`Target to (${unit === 'amount' ? '₹' : UNIT_WORD[unit]})`}
                error={errors.targetTo}
                hint="Empty = no upper limit"
              >
                <input id="targetTo" inputMode={isCountUnit(unit) ? 'numeric' : 'decimal'} value={slab.targetTo} onChange={setSlabField('targetTo')} placeholder="e.g. 49" />
              </FormField>
              <FormField id="commissionType" label="Commission type" required error={errors.commissionType} hint={fixedOnly ? `A fixed amount for each ${helpers.singular(unit)}` : undefined}>
                <select id="commissionType" value={rule.commissionType} onChange={(e) => setRule((r) => ({ ...r, commissionType: e.target.value }))} disabled={fixedOnly}>
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">{fixedOnly ? 'Fixed amount (₹) per unit' : 'Fixed amount (₹)'}</option>
                </select>
              </FormField>
              <FormField
                id="commissionValue"
                label={rule.commissionType === 'percentage' ? 'Commission value (%)' : 'Commission value (₹)'}
                required
                error={errors.commissionValue}
              >
                <input id="commissionValue" inputMode="decimal" value={slab.commissionValue} onChange={setSlabField('commissionValue')} placeholder={rule.commissionType === 'percentage' ? 'e.g. 1.5' : 'e.g. 50'} />
              </FormField>
            </div>

            <TierPreview
              rule={{
                basis: rule.basis,
                targetUnit: rule.targetUnit,
                rateAppliesTo: rule.rateAppliesTo,
                minEligibility: rule.minEligibility.trim(),
                maxCommission: rule.maxCommission.trim(),
              }}
              slabs={[{ targetFrom: slab.targetFrom, targetTo: slab.targetTo, commissionType: rule.commissionType, commissionValue: slab.commissionValue }]}
            />
          </>
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------
const newRow = (prev) => {
  const next = prev && prev.targetTo !== '' && MONEY_RE.test(prev.targetTo) ? Number(prev.targetTo) + 1 : '';
  return {
    id: null,
    targetFrom: next === '' ? '' : String(Math.round(next * 100) / 100),
    targetTo: '',
    commissionType: prev?.commissionType || 'percentage',
    commissionValue: '',
    durationMonths: '4',
    startDelayMonths: 1,
    isActive: true,
  };
};

// Edits every slab of one rule together, so boundaries can be shifted in one save.
function ScopeEditor({ initial, helpers, years, ranks, onClose, onSaved }) {
  const toast = useToast();
  const activeYear = years.find((y) => y.isActive);
  const startType = initial && initial.commissionFor !== helpers.legacy.key ? initial.commissionFor : 'collection';
  const [financialYear, setFinancialYear] = useState(initial?.financialYearId || activeYear?.id || '');
  const [rank, setRank] = useState(initial?.rankId || '');
  const [rule, setRule] = useState(() =>
    initial && initial.commissionFor !== helpers.legacy.key
      ? {
          commissionFor: initial.commissionFor,
          basis: initial.basis,
          targetUnit: initial.targetUnit,
          scope: initial.scope,
          frequency: initial.frequency,
          rateAppliesTo: initial.rateAppliesTo,
          minEligibility: blankToStr(initial.minEligibility),
          maxCommission: blankToStr(initial.maxCommission),
          commissionType: initial.commissionType,
        }
      : ruleDefaults(helpers, startType)
  );
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const isGL = rule.commissionFor === 'group_leader';
  const unit = rule.targetUnit;
  const fixedOnly = helpers.bases[rule.basis]?.fixedOnly;

  // Load the slabs of the chosen rule (type + year + rank + basis + whose activity).
  useEffect(() => {
    if (!financialYear) {
      setRows([]);
      return undefined;
    }
    let live = true;
    setLoading(true);
    api.commissions
      .list({ commissionFor: rule.commissionFor, financialYear, limit: 100 })
      .then((d) => {
        if (!live) return;
        const mine = d.items
          .filter((c) => (c.rankId || '') === rank && c.basis === rule.basis && c.scope === rule.scope)
          .sort((a, b) => (a.targetFrom ?? 0) - (b.targetFrom ?? 0))
          .map((c) => ({
            id: c.id,
            targetFrom: blankToStr(c.targetFrom),
            targetTo: blankToStr(c.targetTo),
            commissionType: c.commissionType,
            commissionValue: String(c.commissionValue),
            durationMonths: c.durationMonths ? String(c.durationMonths) : '4',
            startDelayMonths: c.startDelayMonths === 0 ? 0 : 1,
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
  }, [rule.commissionFor, rule.basis, rule.scope, financialYear, rank]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (i, key, value) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
    setErrors((er) => ({ ...er, [`slabs.${i}.${key}`]: undefined }));
  };

  function localCheck() {
    const found = {};
    if (!isGL) {
      const re = unitRe(unit);
      if (rule.minEligibility.trim() && !re.test(rule.minEligibility.trim())) found.minEligibility = 'Invalid value';
      if (rule.maxCommission.trim() && (!MONEY_RE.test(rule.maxCommission.trim()) || Number(rule.maxCommission) <= 0)) found.maxCommission = 'Invalid amount';
    }
    if (isGL && rows.length > 1) found.slabs = 'A group leader has one commission rule per financial year and rank';
    rows.forEach((r, i) => {
      const k = (f) => `slabs.${i}.${f}`;
      const val = r.commissionValue.trim();
      if (!MONEY_RE.test(val) || Number(val) <= 0) found[k('commissionValue')] = 'Required';
      if (isGL) {
        const m = Number(r.durationMonths);
        if (!Number.isInteger(m) || m < 1 || m > 36) found[k('durationMonths')] = 'Whole months, 1 to 36';
        return;
      }
      const re = unitRe(unit);
      const from = r.targetFrom.trim();
      const to = r.targetTo.trim();
      if (from && !re.test(from)) found[k('targetFrom')] = 'Invalid';
      if (to && !re.test(to)) found[k('targetTo')] = 'Invalid';
      if (!found[k('targetFrom')] && !found[k('targetTo')] && from && to && Number(to) < Number(from)) found[k('targetTo')] = 'Less than start';
      if (r.commissionType === 'percentage' && Number(val) > 100) found[k('commissionValue')] = 'Max 100';
    });
    if (!isGL) {
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
        commissionFor: rule.commissionFor,
        financialYear,
        rank,
        basis: rule.basis,
        targetUnit: rule.targetUnit,
        scope: rule.scope,
        frequency: rule.frequency,
        rateAppliesTo: rule.rateAppliesTo,
        minEligibility: rule.minEligibility.trim(),
        maxCommission: rule.maxCommission.trim(),
        slabs: rows.map((r) =>
          isGL
            ? { id: r.id || undefined, commissionType: 'fixed', commissionValue: r.commissionValue.trim(), durationMonths: Number(r.durationMonths), startDelayMonths: r.startDelayMonths, isActive: r.isActive }
            : { id: r.id || undefined, targetFrom: r.targetFrom.trim(), targetTo: r.targetTo.trim(), commissionType: fixedOnly ? 'fixed' : r.commissionType, commissionValue: r.commissionValue.trim(), isActive: r.isActive }
        ),
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
  const word = unit === 'amount' ? '₹' : UNIT_WORD[unit];

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
          <button className="btn primary" onClick={save} disabled={saving || loading || !financialYear}>
            {saving ? 'Saving…' : 'Save all slabs'}
          </button>
        </>
      }
    >
      <div className="form-grid cols-3">
        <FormField id="scopeFor" label="Commission for">
          <select id="scopeFor" value={rule.commissionFor} onChange={(e) => setRule(ruleDefaults(helpers, e.target.value))}>
            <TypeOptions types={helpers.types} />
          </select>
        </FormField>
        <FormField id="scopeYear" label="Financial year">
          <select id="scopeYear" value={financialYear} onChange={(e) => setFinancialYear(e.target.value)}>
            <option value="">Select financial year</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? ' (active)' : ''}</option>)}
          </select>
        </FormField>
        <FormField id="scopeRank" label="Rank">
          <select id="scopeRank" value={rank} onChange={(e) => setRank(e.target.value)}>
            <option value="">All ranks</option>
            {ranks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </FormField>
      </div>

      {!isGL && (
        <>
          <h4 className="form-section">Rule settings (apply to every slab below)</h4>
          <RuleFields rule={rule} setRule={setRule} helpers={helpers} errors={errors} idPrefix="ed-" />
        </>
      )}

      {errors.slabs && <div className="alert" role="alert" style={{ marginTop: 12 }}>{errors.slabs}</div>}
      <h4 className="form-section">{isGL ? 'Group leader rule' : 'Slabs'}</h4>

      {loading ? (
        <Spinner label="Loading slabs…" />
      ) : isGL ? (
        <div className="gl-rule">
          {rows.length === 0 ? (
            <button className="btn" onClick={() => setRows([newRow(null)])}>+ Add rule</button>
          ) : (
            rows.map((r, i) => (
              <div key={r.id || 'new'} className="form-grid">
                <FormField id="glAmount" label="Commission per loan, per month (₹)" required error={err(i, 'commissionValue')}>
                  <input id="glAmount" inputMode="decimal" value={r.commissionValue} onChange={(e) => setRow(i, 'commissionValue', e.target.value)} placeholder="e.g. 25" />
                </FormField>
                <FormField id="glMonths" label="Commission duration (months)" required error={err(i, 'durationMonths')}>
                  <input id="glMonths" inputMode="numeric" value={r.durationMonths} onChange={(e) => setRow(i, 'durationMonths', e.target.value)} />
                </FormField>
                <div className="span-2">
                  <label className="check-row">
                    <input type="checkbox" checked={r.startDelayMonths === 1} onChange={(e) => setRow(i, 'startDelayMonths', e.target.checked ? 1 : 0)} />
                    <span>
                      <strong>No commission in the disbursement month</strong>
                      <small className="muted">Commission starts from the month after the loan is disbursed</small>
                    </span>
                  </label>
                </div>
                <div className="span-2">
                  <GroupLeaderPreview amount={r.commissionValue} durationMonths={r.durationMonths} startDelayMonths={r.startDelayMonths} />
                </div>
                <div className="span-2">
                  <button className="btn sm danger-outline" onClick={() => setRows([])}>Remove rule</button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <p className="muted small" style={{ margin: '0 0 6px' }}>
            All rows are saved together, so boundaries can be shifted freely. Leave "from" empty to start at 0 and "to" empty for no upper limit. Rows you remove are deleted when you save.
          </p>
          <div className="table-wrap">
            <table className="data-table slab-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>From ({word})</th>
                  <th>To ({word})</th>
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
                      <input aria-label={`Row ${i + 1} target from`} className={err(i, 'targetFrom') ? 'bad' : ''} inputMode="decimal" value={r.targetFrom} onChange={(e) => setRow(i, 'targetFrom', e.target.value)} placeholder="0" />
                      {err(i, 'targetFrom') && <div className="field-error">{err(i, 'targetFrom')}</div>}
                    </td>
                    <td data-label="To">
                      <input aria-label={`Row ${i + 1} target to`} className={err(i, 'targetTo') ? 'bad' : ''} inputMode="decimal" value={r.targetTo} onChange={(e) => setRow(i, 'targetTo', e.target.value)} placeholder="No limit" />
                      {err(i, 'targetTo') && <div className="field-error">{err(i, 'targetTo')}</div>}
                    </td>
                    <td data-label="Type">
                      <select aria-label={`Row ${i + 1} type`} value={fixedOnly ? 'fixed' : r.commissionType} onChange={(e) => setRow(i, 'commissionType', e.target.value)} disabled={fixedOnly}>
                        <option value="percentage">%</option>
                        <option value="fixed">₹ fixed</option>
                      </select>
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
          <button className="btn" style={{ marginTop: 12 }} onClick={() => setRows((rs) => [...rs, newRow(rs[rs.length - 1])])}>+ Add slab</button>
          <TierPreview
            rule={{
              basis: rule.basis,
              targetUnit: rule.targetUnit,
              rateAppliesTo: rule.rateAppliesTo,
              minEligibility: rule.minEligibility.trim(),
              maxCommission: rule.maxCommission.trim(),
            }}
            slabs={rows.map((r) => ({ targetFrom: r.targetFrom, targetTo: r.targetTo, commissionType: fixedOnly ? 'fixed' : r.commissionType, commissionValue: r.commissionValue }))}
          />
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------
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
  const [cfg, setCfg] = useState(null);
  const [years, setYears] = useState([]);
  const [ranks, setRanks] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.commissions.types().then(setCfg).catch((err) => setError(err.message));
    api.financialYears.list().then((d) => setYears(d.items)).catch(() => {});
    api.ranks.options().then((d) => setRanks(d.items)).catch(() => {});
  }, []);

  const helpers = useMemo(() => makeHelpers(cfg), [cfg]);

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
  const showLegacyOption = data.items.some((c) => c.commissionFor === helpers.legacy.key) || forFilter === helpers.legacy.key;
  const ready = Boolean(cfg);

  return (
    <>
      <PageHeader
        title="Commission Master"
        description="Commission by type, basis, target and rank — with minimum eligibility, maximum payout, frequency and whose activity counts."
        actions={
          <>
            <button className="btn" onClick={() => setDialog({ type: 'scope' })} disabled={!ready}>Edit all slabs</button>
            <button className="btn primary" onClick={() => setDialog({ type: 'form' })} disabled={!ready}>+ Add Commission</button>
          </>
        }
      />

      <div className="panel">
        <div className="toolbar">
          <select value={forFilter} onChange={(e) => setForFilter(e.target.value)} aria-label="Filter by commission for">
            <option value="">All commission types</option>
            <TypeOptions types={helpers.types} legacy={helpers.legacy} includeLegacy={showLegacyOption} />
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
                    <th>Year</th>
                    <th>Rank</th>
                    <th>Target range</th>
                    <th>Commission</th>
                    <th>Rules</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Commission for">
                        <strong>{helpers.label(c.commissionFor)}</strong>
                        {c.commissionFor !== 'group_leader' && c.scope !== 'own' && <div className="muted small">{SCOPE_LABEL[c.scope]}</div>}
                        {c.commissionFor === helpers.legacy.key && <div className="muted small">Edit to move to a specific type</div>}
                      </td>
                      <td data-label="Year">{c.financialYear?.name || '—'}</td>
                      <td data-label="Rank">{c.rank?.name || 'All ranks'}</td>
                      <td data-label="Target range">{helpers.target(c)}</td>
                      <td data-label="Commission"><span className="badge green">{helpers.value(c)}</span></td>
                      <td data-label="Rules" className="muted small">{helpers.rules(c) || '—'}</td>
                      <td data-label="Status"><StatusBadge active={c.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', item: c })}>Edit</button>
                          {c.commissionFor !== helpers.legacy.key && (
                            <button className="btn sm" onClick={() => setDialog({ type: 'scope', item: c })} title="Edit every slab of this rule together">Edit slabs</button>
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

      {dialog?.type === 'scope' && ready && (
        <ScopeEditor initial={dialog.item || null} helpers={helpers} years={years} ranks={ranks} onClose={closeDialog} onSaved={() => { closeDialog(); load(); }} />
      )}

      {dialog?.type === 'form' && ready && (
        <CommissionForm item={dialog.item || null} helpers={helpers} years={years} ranks={ranks} onClose={closeDialog} onSaved={() => { closeDialog(); load(); }} />
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

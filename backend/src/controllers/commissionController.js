import mongoose from 'mongoose';
import { Commission, COMMISSION_TYPES } from '../models/Commission.js';
import { FinancialYear } from '../models/FinancialYear.js';
import { Rank } from '../models/Rank.js';
import {
  COMMISSION_TYPE_LIST,
  LEGACY_COMMISSION_TYPE,
  SELECTABLE_TYPES,
  BASES,
  UNITS,
  FREQUENCIES,
  LOAN_SCOPES,
  RATE_APPLIES,
  typeMeta,
  isCountUnit,
  legacyUnit,
  legacyBasis,
} from '../config/commissionTypes.js';
import { createValidator, parsePaging, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { generateGroupLeaderCommission, parseMonth } from '../services/groupLeaderCommission.js';
import { computeTierCommission } from '../services/tierCommission.js';

const MAX_PAISE = 100_000_000_000 * 100; // 1,000 crore rupees
const MAX_COUNT = 1_000_000;
const MAX_BP = 10_000; // 100.00 %
const NONE = Number.MAX_SAFE_INTEGER;
const POPULATE = [
  { path: 'financialYear', select: 'name financialYearId startDate endDate isActive' },
  { path: 'rank', select: 'name code' },
];

const isBlank = (x) => x === undefined || x === null || String(x).trim() === '';

// What a stored record means. Records created before basis/unit existed are inferred.
const effective = (c) => ({
  unit: c.targetUnit || legacyUnit(c.commissionFor),
  basis: c.basis || legacyBasis(c.commissionFor),
  scope: c.scope || 'own',
  frequency: c.frequency || 'monthly',
  appliesTo: c.rateAppliesTo || 'all',
});

// Stored value -> API value (rupees for the amount unit, the plain count otherwise).
const outVal = (unit, n) => (n === undefined || n === null ? null : isCountUnit(unit) ? n : n / 100);

const present = (c) => {
  const e = effective(c);
  return {
    id: c._id,
    commissionFor: c.commissionFor,
    basis: e.basis,
    targetUnit: e.unit,
    scope: e.scope,
    frequency: e.frequency,
    rateAppliesTo: e.appliesTo,
    financialYear: c.financialYear?._id
      ? { id: c.financialYear._id, name: c.financialYear.name, financialYearId: c.financialYear.financialYearId }
      : null,
    financialYearId: String(c.financialYear?._id || c.financialYear),
    rank: c.rank?._id ? { id: c.rank._id, name: c.rank.name, code: c.rank.code } : null,
    rankId: c.rank?._id ? String(c.rank._id) : '',
    targetFrom: outVal(e.unit, c.targetFromPaise),
    targetTo: outVal(e.unit, c.targetToPaise),
    minEligibility: outVal(e.unit, c.minEligibilityValue),
    maxCommission: c.maxCommissionPaise === undefined || c.maxCommissionPaise === null ? null : c.maxCommissionPaise / 100,
    commissionType: c.commissionType,
    // percentage is returned as a percent (2.5), fixed as rupees.
    commissionValue: c.commissionValue / 100,
    // Group leader rule only (null for other types).
    durationMonths: c.durationMonths ?? null,
    startDelayMonths: c.startDelayMonths ?? null,
    isActive: c.isActive,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
};

export function commissionTypes(_req, res) {
  res.json({
    types: COMMISSION_TYPE_LIST,
    legacy: LEGACY_COMMISSION_TYPE,
    bases: Object.entries(BASES).map(([key, b]) => ({ key, ...b })),
    units: Object.entries(UNITS).map(([key, label]) => ({ key, label })),
    frequencies: FREQUENCIES,
    scopes: LOAN_SCOPES,
    rateApplies: RATE_APPLIES,
  });
}

// ---- parsing ---------------------------------------------------------------------------

// A target / eligibility value in the rule's unit: a whole count, or rupees -> paise.
function parseByUnit(raw, unit) {
  if (isCountUnit(unit)) {
    const s = String(raw).trim();
    const n = /^\d{1,7}$/.test(s) ? Number(s) : null;
    return n !== null && n <= MAX_COUNT ? n : null;
  }
  const p = toMinor(raw);
  return p !== null && p <= MAX_PAISE ? p : null;
}
const badValue = (unit) => (isCountUnit(unit) ? 'Enter a whole number' : 'Enter a valid amount (up to 2 decimals)');

/**
 * Rule-level fields shared by every slab of a rule: commission for, year(s), rank(s),
 * basis, target unit, scope, frequency, how the rate applies, eligibility and the cap.
 * `multi` allows several financial years / ranks (create); otherwise exactly one of each.
 */
async function readRule(b, v, { multi }) {
  const commissionFor = String(b.commissionFor || '');
  const meta = SELECTABLE_TYPES.includes(commissionFor) ? typeMeta(commissionFor) : null;
  if (!meta) v.add('commissionFor', 'Select what the commission is for');
  const gl = commissionFor === 'group_leader';

  // Financial year(s)
  const fyIds = [...new Set((Array.isArray(b.financialYears) ? b.financialYears : [b.financialYear]).filter((x) => !isBlank(x)).map(String))];
  let fys = [];
  if (!fyIds.length) v.add('financialYear', 'Select a financial year');
  else if (!multi && fyIds.length > 1) v.add('financialYear', 'Select a single financial year');
  else if (!fyIds.every((id) => mongoose.isValidObjectId(id))) v.add('financialYear', 'Select a valid financial year');
  else {
    fys = await FinancialYear.find({ _id: { $in: fyIds } });
    if (fys.length !== fyIds.length) v.add('financialYear', 'A selected financial year does not exist');
  }

  // Rank(s); none selected = all ranks
  const rankIds = [...new Set((Array.isArray(b.ranks) ? b.ranks : [b.rank]).filter((x) => !isBlank(x)).map(String))];
  let ranks = [null];
  if (rankIds.length) {
    if (!multi && rankIds.length > 1) v.add('rank', 'Select a single rank');
    else if (!rankIds.every((id) => mongoose.isValidObjectId(id))) v.add('rank', 'Select a valid rank');
    else {
      const found = await Rank.find({ _id: { $in: rankIds }, isDeleted: false });
      if (found.length !== rankIds.length) v.add('rank', 'A selected rank does not exist');
      else ranks = found;
    }
  }

  const out = { commissionFor, fys, ranks, gl };
  if (gl) {
    // Dedicated per-loan monthly rule (see the group leader fields on each slab).
    return { ...out, basis: 'per_loan', unit: 'loans', scope: 'own', frequency: 'monthly', appliesTo: 'all' };
  }

  // Basis and unit must make sense for the commission type.
  out.basis = String(b.basis || meta?.bases[0] || '');
  if (meta && !meta.bases.includes(out.basis)) v.add('basis', `Choose one of: ${meta.bases.map((x) => BASES[x].label).join(', ')}`);
  out.unit = String(b.targetUnit || BASES[out.basis]?.unit || '');
  if (meta && !meta.units.includes(out.unit)) v.add('targetUnit', `Choose one of: ${meta.units.map((x) => UNITS[x]).join(', ')}`);

  out.scope = String(b.scope || 'own');
  if (!LOAN_SCOPES.includes(out.scope)) v.add('scope', 'Select own, branch or supervised branches');
  out.frequency = String(b.frequency || 'monthly');
  if (!FREQUENCIES.includes(out.frequency)) v.add('frequency', 'Select daily, weekly, monthly or yearly');
  out.appliesTo = String(b.rateAppliesTo || 'all');
  if (!RATE_APPLIES.includes(out.appliesTo)) v.add('rateAppliesTo', 'Select how the rate applies');

  if (!isBlank(b.minEligibility)) {
    const n = parseByUnit(b.minEligibility, out.unit);
    if (n === null) v.add('minEligibility', badValue(out.unit));
    else out.minEligibilityValue = n;
  }
  if (!isBlank(b.maxCommission)) {
    const p = toMinor(b.maxCommission);
    if (p === null || p < 1 || p > MAX_PAISE) v.add('maxCommission', 'Enter a valid amount (up to 2 decimals)');
    else out.maxCommissionPaise = p;
  }
  return out;
}

// One slab: target range and commission value (or the group leader's per-loan rule).
// `k` maps a field name to the error key (rows of a bulk save use "slabs.<i>.<field>").
function readSlab(raw, rule, v, k = (f) => f) {
  const out = {};

  if (rule.gl) {
    out.commissionType = 'fixed';
    const amount = toMinor(raw.commissionValue);
    if (amount === null || amount < 1 || amount > MAX_PAISE) {
      v.add(k('commissionValue'), 'Enter the amount per loan per month (more than 0, up to 2 decimals)');
    } else out.commissionValue = amount;

    const months = Number(raw.durationMonths);
    if (!Number.isInteger(months) || months < 1 || months > 36) v.add(k('durationMonths'), 'Enter whole months from 1 to 36');
    else out.durationMonths = months;

    const delay = isBlank(raw.startDelayMonths) ? 1 : Number(raw.startDelayMonths);
    if (![0, 1].includes(delay)) v.add(k('startDelayMonths'), 'Choose the disbursement month or the next month');
    else out.startDelayMonths = delay;
    return out;
  }

  // Either end may be empty: empty "from" starts at 0, empty "to" has no upper limit.
  const hasFrom = !isBlank(raw.targetFrom);
  const hasTo = !isBlank(raw.targetTo);
  let from = null;
  let to = null;
  if (hasFrom) {
    from = parseByUnit(raw.targetFrom, rule.unit);
    if (from === null) v.add(k('targetFrom'), badValue(rule.unit));
  }
  if (hasTo) {
    to = parseByUnit(raw.targetTo, rule.unit);
    if (to === null) v.add(k('targetTo'), badValue(rule.unit));
  }
  if (from !== null && to !== null && to < from) v.add(k('targetTo'), 'Target end must not be less than target start');
  if (from !== null || to !== null) {
    out.targetFromPaise = from ?? 0;
    if (to !== null) out.targetToPaise = to;
  }

  out.commissionType = String(raw.commissionType || '');
  if (!COMMISSION_TYPES.includes(out.commissionType)) v.add(k('commissionType'), 'Select percentage or fixed amount');
  else if (BASES[rule.basis]?.fixedOnly && out.commissionType !== 'fixed') {
    v.add(k('commissionType'), `${BASES[rule.basis].label} commission is a fixed amount for each unit`);
  }

  const value = toMinor(raw.commissionValue);
  if (value === null || value < 1) v.add(k('commissionValue'), 'Enter a value greater than 0 (up to 2 decimals)');
  else if (out.commissionType === 'percentage' && value > MAX_BP) v.add(k('commissionValue'), 'Percentage cannot exceed 100');
  else if (value > MAX_PAISE) v.add(k('commissionValue'), 'Amount is too large');
  else out.commissionValue = value;
  return out;
}

const scopeFields = (rule) => ({
  basis: rule.basis,
  targetUnit: rule.unit,
  scope: rule.scope,
  frequency: rule.frequency,
  rateAppliesTo: rule.appliesTo,
  minEligibilityValue: rule.minEligibilityValue,
  maxCommissionPaise: rule.maxCommissionPaise,
});

// Slabs of the same rule (type + year + rank + basis + whose loans) must not overlap.
async function loadRuleSlabs(rule, fyId, rankId) {
  const docs = await Commission.find({
    isDeleted: false,
    commissionFor: rule.commissionFor,
    financialYear: fyId,
    rank: rankId || { $exists: false },
  });
  return docs.filter((d) => {
    const e = effective(d);
    return e.basis === rule.basis && e.scope === rule.scope;
  });
}

const spanOf = (d) => [d.targetFromPaise ?? 0, d.targetToPaise ?? NONE];

async function assertNoClash(rule, fy, rank, slab, excludeId) {
  const others = (await loadRuleSlabs(rule, fy._id, rank?._id)).filter((o) => String(o._id) !== String(excludeId));
  const [lo, hi] = spanOf(slab);
  const clash = others.find((o) => {
    const [oLo, oHi] = spanOf(o);
    return lo <= oHi && oLo <= hi;
  });
  if (clash) {
    const where = `${fy.name}${rank ? ` / ${rank.name}` : ''}`;
    const covers =
      clash.targetFromPaise === undefined && clash.targetToPaise === undefined
        ? 'covers every target'
        : `covers ${outVal(rule.unit, clash.targetFromPaise ?? 0)} – ${clash.targetToPaise === undefined ? 'no limit' : outVal(rule.unit, clash.targetToPaise)}`;
    throw new HttpError(409, 'This overlaps with an existing commission slab', {
      targetFrom: `${where}: overlaps an existing slab that ${covers}`,
    });
  }
}

// ---- CRUD ------------------------------------------------------------------------------

export async function listCommissions(req, res) {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { isDeleted: false };
  if (typeMeta(req.query.commissionFor)) filter.commissionFor = req.query.commissionFor;
  if (mongoose.isValidObjectId(req.query.financialYear)) filter.financialYear = req.query.financialYear;
  if (mongoose.isValidObjectId(req.query.rank)) filter.rank = req.query.rank;
  if (LOAN_SCOPES.includes(req.query.scope)) filter.scope = req.query.scope;
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;

  const [items, total] = await Promise.all([
    Commission.find(filter)
      .populate(POPULATE)
      .sort({ commissionFor: 1, financialYear: -1, rank: 1, scope: 1, targetFromPaise: 1, _id: 1 })
      .skip(skip)
      .limit(limit),
    Commission.countDocuments(filter),
  ]);
  res.json({ items: items.map(present), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

// Creates the same slab for every selected financial year and rank.
export async function createCommission(req, res) {
  const b = req.body || {};
  const v = createValidator();
  const rule = await readRule(b, v, { multi: true });
  const slab = readSlab(b, rule, v);
  v.throwIfAny();

  for (const fy of rule.fys) {
    for (const rank of rule.ranks) {
      // eslint-disable-next-line no-await-in-loop
      await assertNoClash(rule, fy, rank, slab);
    }
  }
  const docs = [];
  for (const fy of rule.fys) {
    for (const rank of rule.ranks) {
      docs.push({
        commissionFor: rule.commissionFor,
        financialYear: fy._id,
        rank: rank?._id,
        ...scopeFields(rule),
        ...slab,
        isActive: b.isActive !== false,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      });
    }
  }
  const created = await Commission.insertMany(docs);
  const populated = await Commission.find({ _id: { $in: created.map((c) => c._id) } }).populate(POPULATE);
  await audit(req, {
    action: 'commission.create',
    entity: 'Commission',
    entityId: created.map((c) => c._id).join(','),
    after: { count: created.length, commissionFor: rule.commissionFor },
  });
  res.status(201).json({ commission: present(populated[0]), commissions: populated.map(present) });
}

export async function updateCommission(req, res) {
  const doc = await Commission.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Commission not found');
  const b = req.body || {};
  const v = createValidator();
  const rule = await readRule(b, v, { multi: false });
  const slab = readSlab(b, rule, v);
  v.throwIfAny();

  await assertNoClash(rule, rule.fys[0], rule.ranks[0], slab, doc._id);

  const before = doc.toObject();
  doc.commissionFor = rule.commissionFor;
  doc.financialYear = rule.fys[0]._id;
  doc.rank = rule.ranks[0]?._id;
  Object.assign(doc, scopeFields(rule));
  doc.targetFromPaise = slab.targetFromPaise;
  doc.targetToPaise = slab.targetToPaise;
  doc.commissionType = slab.commissionType;
  doc.commissionValue = slab.commissionValue;
  doc.durationMonths = slab.durationMonths;
  doc.startDelayMonths = slab.startDelayMonths;
  if (typeof b.isActive === 'boolean') doc.isActive = b.isActive;
  doc.updatedBy = req.user._id;
  await doc.save();
  await doc.populate(POPULATE);
  await audit(req, { action: 'commission.update', entity: 'Commission', entityId: doc._id, before, after: doc });
  res.json({ commission: present(doc) });
}

export async function setCommissionStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const doc = await Commission.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Commission not found');
  doc.isActive = req.body.isActive;
  doc.updatedBy = req.user._id;
  await doc.save();
  await doc.populate(POPULATE);
  await audit(req, { action: doc.isActive ? 'commission.activate' : 'commission.deactivate', entity: 'Commission', entityId: doc._id });
  res.json({ commission: present(doc) });
}

export async function deleteCommission(req, res) {
  const doc = await Commission.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Commission not found');
  const before = doc.toObject();
  doc.isDeleted = true;
  doc.isActive = false;
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: 'commission.delete', entity: 'Commission', entityId: doc._id, before });
  res.json({ message: 'Commission deleted' });
}

/**
 * Replaces ALL slabs of one rule (commission for + financial year + rank + basis + scope)
 * in a single save, so boundaries can be shifted together instead of one by one.
 *
 * body: { commissionFor, financialYear, rank?, basis?, targetUnit?, scope?, frequency?,
 *         rateAppliesTo?, minEligibility?, maxCommission?,
 *         slabs: [{ id?, targetFrom, targetTo, commissionType, commissionValue, isActive? }] }
 * Rows with an id are updated, rows without one are created, existing rows that are not
 * sent are deleted.
 */
export async function saveCommissionScope(req, res) {
  const b = req.body || {};
  const v = createValidator();
  const rule = await readRule(b, v, { multi: false });

  const rows = Array.isArray(b.slabs) ? b.slabs : null;
  if (!rows) v.add('slabs', 'Provide the list of slabs');
  else if (rows.length > 50) v.add('slabs', 'A scope can have up to 50 slabs');
  v.throwIfAny();

  const fy = rule.fys[0];
  const rank = rule.ranks[0];
  const existing = await loadRuleSlabs(rule, fy._id, rank?._id);
  const existingIds = new Set(existing.map((e) => String(e._id)));

  const parsed = rows.map((row, i) => {
    const r = row || {};
    const k = (f) => `slabs.${i}.${f}`;
    const out = readSlab(r, rule, v, k);
    out.id = r.id ? String(r.id) : null;
    if (out.id && !existingIds.has(out.id)) v.add(k('id'), 'This slab no longer belongs to the selected scope. Reload and try again.');
    out.isActive = typeof r.isActive === 'boolean' ? r.isActive : true;
    return out;
  });
  v.throwIfAny();

  // The final set must not overlap (a row without a range covers every target).
  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const [aLo, aHi] = spanOf(parsed[i]);
      const [bLo, bHi] = spanOf(parsed[j]);
      if (aLo <= bHi && bLo <= aHi) {
        v.add(`slabs.${j}.targetFrom`, `Overlaps slab ${i + 1}`);
        v.add(`slabs.${i}.targetTo`, `Overlaps slab ${j + 1}`);
      }
    }
  }
  v.throwIfAny(); // 422 with per-row messages, e.g. slabs.2.targetFrom

  const common = scopeFields(rule);
  const ruleSet = {};
  const ruleUnset = {};
  for (const [key, val] of Object.entries(common)) {
    if (val === undefined) ruleUnset[key] = '';
    else ruleSet[key] = val;
  }

  const keep = new Set(parsed.filter((p) => p.id).map((p) => p.id));
  const ops = [];
  for (const p of parsed) {
    const set = { ...ruleSet, commissionType: p.commissionType, commissionValue: p.commissionValue, isActive: p.isActive, updatedBy: req.user._id };
    const unset = { ...ruleUnset };
    if (p.targetFromPaise !== undefined) set.targetFromPaise = p.targetFromPaise;
    else unset.targetFromPaise = '';
    if (p.targetToPaise !== undefined) set.targetToPaise = p.targetToPaise;
    else unset.targetToPaise = '';
    if (p.durationMonths !== undefined) {
      set.durationMonths = p.durationMonths;
      set.startDelayMonths = p.startDelayMonths;
    } else {
      unset.durationMonths = '';
      unset.startDelayMonths = '';
    }

    if (p.id) {
      ops.push({ updateOne: { filter: { _id: p.id }, update: { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) } } });
    } else {
      ops.push({
        insertOne: {
          document: {
            commissionFor: rule.commissionFor,
            financialYear: fy._id,
            ...(rank ? { rank: rank._id } : {}),
            ...set,
            createdBy: req.user._id,
          },
        },
      });
    }
  }
  for (const e of existing) {
    if (!keep.has(String(e._id))) {
      ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { isDeleted: true, isActive: false, updatedBy: req.user._id } } } });
    }
  }
  if (ops.length) await Commission.bulkWrite(ops, { ordered: true });

  const fresh = await loadRuleSlabs(rule, fy._id, rank?._id);
  const populated = await Commission.find({ _id: { $in: fresh.map((f) => f._id) } }).populate(POPULATE).sort({ targetFromPaise: 1, _id: 1 });
  await audit(req, {
    action: 'commission.saveScope',
    entity: 'Commission',
    entityId: `${rule.commissionFor}:${fy.financialYearId}:${rank ? rank._id : 'all'}:${rule.basis}:${rule.scope}`,
    before: { count: existing.length },
    after: { count: populated.length },
  });
  res.json({ items: populated.map(present) });
}

// ---- previews ----------------------------------------------------------------------------

/**
 * "What would this rule pay for this much activity?" Runs the same engine the payout will
 * use, with the rule exactly as typed in the form.
 *
 * body: { basis?, targetUnit, rateAppliesTo, minEligibility?, maxCommission?,
 *         slabs: [{ targetFrom, targetTo, commissionType, commissionValue }], measure }
 */
export function previewTierCommission(req, res) {
  const b = req.body || {};
  const v = createValidator();

  const unit = String(b.targetUnit || '');
  if (!UNITS[unit]) v.add('targetUnit', 'Select the target unit');
  const appliesTo = String(b.rateAppliesTo || 'all');
  if (!RATE_APPLIES.includes(appliesTo)) v.add('rateAppliesTo', 'Select how the rate applies');
  const basis = String(b.basis || '');

  const measure = UNITS[unit] ? parseByUnit(b.measure, unit) : null;
  if (UNITS[unit] && measure === null) v.add('measure', badValue(unit));

  let minEligibility;
  if (!isBlank(b.minEligibility) && UNITS[unit]) {
    minEligibility = parseByUnit(b.minEligibility, unit);
    if (minEligibility === null) v.add('minEligibility', badValue(unit));
  }
  let maxCommissionPaise;
  if (!isBlank(b.maxCommission)) {
    maxCommissionPaise = toMinor(b.maxCommission);
    if (maxCommissionPaise === null || maxCommissionPaise < 1) v.add('maxCommission', 'Enter a valid amount');
  }

  const list = Array.isArray(b.slabs) ? b.slabs : [];
  if (!list.length || list.length > 50) v.add('slabs', 'Add at least one slab');
  const rule = { unit, basis: BASES[basis] ? basis : 'per_loan', gl: false };
  const slabs = [];
  list.forEach((s, i) => {
    const out = readSlab(s || {}, rule, v, (f) => `slabs.${i}.${f}`);
    if (out.commissionValue !== undefined && out.commissionType) {
      slabs.push({ from: out.targetFromPaise, to: out.targetToPaise, kind: out.commissionType, value: out.commissionValue });
    }
  });
  v.throwIfAny();

  const r = computeTierCommission({ slabs, unit, measure, minEligibility, appliesTo, maxCommissionPaise });
  res.json({
    eligible: r.eligible,
    capped: r.capped,
    amount: r.amountPaise / 100,
    breakdown: r.breakdown.map((x) => ({
      from: outVal(unit, x.from),
      units: x.units ?? null,
      base: x.base === undefined ? null : outVal(unit, x.base),
      bonus: Boolean(x.bonus),
      amount: x.amountPaise / 100,
    })),
  });
}

/**
 * Shows what a group leader would earn under a rule, for loans disbursed in given months.
 * body: { amount, durationMonths, startDelayMonths?, disbursements: [{ month: 'YYYY-MM', loans }] }
 */
export function previewGroupLeaderCommission(req, res) {
  const b = req.body || {};
  const v = createValidator();

  const amountPaise = toMinor(b.amount);
  if (amountPaise === null || amountPaise < 1 || amountPaise > MAX_PAISE) v.add('amount', 'Enter the amount per loan per month (more than 0, up to 2 decimals)');

  const durationMonths = Number(b.durationMonths);
  if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 36) v.add('durationMonths', 'Enter whole months from 1 to 36');

  const delay = isBlank(b.startDelayMonths) ? 1 : Number(b.startDelayMonths);
  if (![0, 1].includes(delay)) v.add('startDelayMonths', 'Choose the disbursement month or the next month');

  const list = Array.isArray(b.disbursements) ? b.disbursements : null;
  if (!list || list.length === 0) v.add('disbursements', 'Add at least one disbursement month');
  else if (list.length > 36) v.add('disbursements', 'Up to 36 disbursement months');
  else {
    list.forEach((d, i) => {
      if (parseMonth(d?.month) === null) v.add(`disbursements.${i}.month`, 'Use a valid month');
      if (!Number.isInteger(d?.loans) || d.loans < 0 || d.loans > 100000) v.add(`disbursements.${i}.loans`, 'Enter a whole number of loans');
    });
  }
  v.throwIfAny();

  const r = generateGroupLeaderCommission({ disbursements: list, amountPaise, durationMonths, startDelayMonths: delay });
  res.json({
    rule: { amount: amountPaise / 100, durationMonths, startDelayMonths: delay },
    totalLoans: r.totalLoans,
    total: r.totalPaise / 100,
    months: r.months.map((m) => ({
      month: m.month,
      eligibleLoans: m.eligibleLoans,
      perLoan: m.perLoanPaise / 100,
      amount: m.amountPaise / 100,
    })),
  });
}


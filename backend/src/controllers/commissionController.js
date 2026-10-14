import mongoose from 'mongoose';
import { Commission, COMMISSION_FOR, COMMISSION_TYPES } from '../models/Commission.js';
import { FinancialYear } from '../models/FinancialYear.js';
import { Rank } from '../models/Rank.js';
import { COMMISSION_TYPE_LIST, LEGACY_COMMISSION_TYPE, SELECTABLE_TYPES, typeMeta } from '../config/commissionTypes.js';
import { createValidator, parsePaging, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { generateGroupLeaderCommission, parseMonth } from '../services/groupLeaderCommission.js';

const MAX_PAISE = 100_000_000_000 * 100; // 1,000 crore rupees
const MAX_COUNT = 1_000_000;
const MAX_BP = 10_000; // 100.00 %
const POPULATE = [
  { path: 'financialYear', select: 'name financialYearId startDate endDate isActive' },
  { path: 'rank', select: 'name code' },
];
const NONE = Number.MAX_SAFE_INTEGER;

const unitOf = (type) => typeMeta(type)?.unit || 'amount';
// Stored target -> API value (rupees for amount types, the count itself for count types).
const outTarget = (type, n) => (n === undefined || n === null ? null : unitOf(type) === 'count' ? n : n / 100);

const present = (c) => ({
  id: c._id,
  commissionFor: c.commissionFor,
  targetUnit: unitOf(c.commissionFor),
  financialYear: c.financialYear?._id
    ? { id: c.financialYear._id, name: c.financialYear.name, financialYearId: c.financialYear.financialYearId }
    : null,
  financialYearId: String(c.financialYear?._id || c.financialYear),
  rank: c.rank?._id ? { id: c.rank._id, name: c.rank.name, code: c.rank.code } : null,
  rankId: c.rank?._id ? String(c.rank._id) : '',
  targetFrom: outTarget(c.commissionFor, c.targetFromPaise),
  targetTo: outTarget(c.commissionFor, c.targetToPaise),
  commissionType: c.commissionType,
  // percentage is returned as a percent (2.5), fixed as rupees.
  commissionValue: c.commissionValue / 100,
  // Group leader rule only (null for other types).
  durationMonths: c.durationMonths ?? null,
  startDelayMonths: c.startDelayMonths ?? null,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

export function commissionTypes(_req, res) {
  res.json({ types: COMMISSION_TYPE_LIST, legacy: LEGACY_COMMISSION_TYPE });
}

const isBlank = (x) => x === undefined || x === null || String(x).trim() === '';

// Parses and validates one slab's target range and commission value.
// `k` maps a field name to the error key (rows of a bulk save use "slabs.<i>.<field>").
function readSlabFields(raw, commissionFor, v, k = (f) => f) {
  const out = {};
  const count = unitOf(commissionFor) === 'count';

  if (commissionFor === 'group_leader') {
    // A per-loan monthly rule: a fixed amount for every loan disbursed in the group, paid for
    // `durationMonths` months, starting next month. There is no target range.
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

  const hasFrom = !isBlank(raw.targetFrom);
  const hasTo = !isBlank(raw.targetTo);
  if (hasFrom !== hasTo) {
    v.add(k(hasFrom ? 'targetTo' : 'targetFrom'), 'Enter both target values, or leave both empty');
  } else if (hasFrom && hasTo) {
    const parse = (x) => {
      if (count) return /^\d{1,7}$/.test(String(x).trim()) ? Number(String(x).trim()) : null;
      return toMinor(x);
    };
    const max = count ? MAX_COUNT : MAX_PAISE;
    const from = parse(raw.targetFrom);
    const to = parse(raw.targetTo);
    const bad = count ? 'Enter a whole number' : 'Enter a valid amount (up to 2 decimals)';
    if (from === null || from > max) v.add(k('targetFrom'), bad);
    if (to === null || to > max) v.add(k('targetTo'), bad);
    if (from !== null && to !== null) {
      if (to < from) v.add(k('targetTo'), 'Target end must not be less than target start');
      out.targetFromPaise = from;
      out.targetToPaise = to;
    }
  }

  out.commissionType = String(raw.commissionType || '');
  if (!COMMISSION_TYPES.includes(out.commissionType)) v.add(k('commissionType'), 'Select percentage or fixed amount');
  else if (count && out.commissionType !== 'fixed') v.add(k('commissionType'), 'This commission is a fixed amount per group / member');

  const value = toMinor(raw.commissionValue);
  if (value === null || value < 1) v.add(k('commissionValue'), 'Enter a value greater than 0 (up to 2 decimals)');
  else if (out.commissionType === 'percentage' && value > MAX_BP) v.add(k('commissionValue'), 'Percentage cannot exceed 100');
  else if (value > MAX_PAISE) v.add(k('commissionValue'), 'Amount is too large');
  else out.commissionValue = value;
  return out;
}

async function readScope(b, v) {
  const commissionFor = String(b.commissionFor || '');
  if (!SELECTABLE_TYPES.includes(commissionFor)) v.add('commissionFor', 'Select what the commission is for');

  const fyId = String(b.financialYear || '');
  const fy = mongoose.isValidObjectId(fyId) ? await FinancialYear.findById(fyId) : null;
  if (!fy) v.add('financialYear', fyId ? 'Selected financial year does not exist' : 'Select a financial year');

  // Rank is optional for every type; empty means all ranks.
  let rank = null;
  if (b.rank) {
    const rankId = String(b.rank);
    rank = mongoose.isValidObjectId(rankId) ? await Rank.findOne({ _id: rankId, isDeleted: false }) : null;
    if (!rank) v.add('rank', 'Selected rank does not exist');
  }
  return { commissionFor, fy, rank };
}

async function readCommission(b) {
  const v = createValidator();
  const { commissionFor, fy, rank } = await readScope(b, v);
  const slab = readSlabFields(b, commissionFor, v);
  v.throwIfAny();
  return { commissionFor, financialYear: fy._id, rank: rank?._id, ...slab };
}

const scopeFilter = (commissionFor, fyId, rankId) => ({
  isDeleted: false,
  commissionFor,
  financialYear: fyId,
  rank: rankId || { $exists: false },
});

// Slabs in the same scope (type + financial year + rank) must not overlap.
// A rule without a target range covers every target.
async function assertNoOverlap(data, excludeId) {
  const filter = scopeFilter(data.commissionFor, data.financialYear, data.rank);
  if (excludeId) filter._id = { $ne: excludeId };

  const lo = data.targetFromPaise ?? 0;
  const hi = data.targetToPaise ?? NONE;
  const others = await Commission.find(filter);
  const clash = others.find((o) => lo <= (o.targetToPaise ?? NONE) && (o.targetFromPaise ?? 0) <= hi);
  if (clash) {
    const range =
      clash.targetFromPaise === undefined || clash.targetFromPaise === null
        ? 'covers every target'
        : `covers ${outTarget(data.commissionFor, clash.targetFromPaise)} – ${outTarget(data.commissionFor, clash.targetToPaise)}`;
    throw new HttpError(409, 'This overlaps with an existing commission slab', {
      targetFrom: `Overlaps an existing slab that ${range}`,
    });
  }
}

export async function listCommissions(req, res) {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { isDeleted: false };
  if (COMMISSION_FOR.includes(req.query.commissionFor)) filter.commissionFor = req.query.commissionFor;
  if (mongoose.isValidObjectId(req.query.financialYear)) filter.financialYear = req.query.financialYear;
  if (mongoose.isValidObjectId(req.query.rank)) filter.rank = req.query.rank;
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;

  const [items, total] = await Promise.all([
    Commission.find(filter)
      .populate(POPULATE)
      .sort({ commissionFor: 1, financialYear: -1, rank: 1, targetFromPaise: 1, _id: 1 })
      .skip(skip)
      .limit(limit),
    Commission.countDocuments(filter),
  ]);
  res.json({ items: items.map(present), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

export async function createCommission(req, res) {
  const data = await readCommission(req.body || {});
  await assertNoOverlap(data);
  const doc = await Commission.create({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
  await doc.populate(POPULATE);
  await audit(req, { action: 'commission.create', entity: 'Commission', entityId: doc._id, after: doc });
  res.status(201).json({ commission: present(doc) });
}

export async function updateCommission(req, res) {
  const doc = await Commission.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Commission not found');
  const data = await readCommission(req.body || {});
  await assertNoOverlap(data, doc._id);

  const before = doc.toObject();
  doc.commissionFor = data.commissionFor;
  doc.financialYear = data.financialYear;
  doc.rank = data.rank;
  doc.targetFromPaise = data.targetFromPaise;
  doc.targetToPaise = data.targetToPaise;
  doc.commissionType = data.commissionType;
  doc.commissionValue = data.commissionValue;
  doc.durationMonths = data.durationMonths;
  doc.startDelayMonths = data.startDelayMonths;
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
 * Replaces ALL slabs of one scope (commission for + financial year + rank) in a single save.
 * Editing slabs one by one forces an awkward order (a slab cannot grow into its neighbour
 * until the neighbour has moved); here the whole set is validated together instead.
 *
 * body: { commissionFor, financialYear, rank?, slabs: [{ id?, targetFrom, targetTo,
 *         commissionType, commissionValue, isActive? }] }
 * Rows with an id are updated, rows without one are created, existing rows that are
 * not sent are deleted.
 */
export async function saveCommissionScope(req, res) {
  const b = req.body || {};
  const v = createValidator();
  const { commissionFor, fy, rank } = await readScope(b, v);

  const rows = Array.isArray(b.slabs) ? b.slabs : null;
  if (!rows) v.add('slabs', 'Provide the list of slabs');
  else if (rows.length > 50) v.add('slabs', 'A scope can have up to 50 slabs');
  v.throwIfAny();

  const filter = scopeFilter(commissionFor, fy._id, rank?._id);
  const existing = await Commission.find(filter);
  const existingIds = new Set(existing.map((e) => String(e._id)));

  const parsed = rows.map((row, i) => {
    const r = row || {};
    const k = (f) => `slabs.${i}.${f}`;
    const out = readSlabFields(r, commissionFor, v, k);
    out.id = r.id ? String(r.id) : null;
    if (out.id && !existingIds.has(out.id)) v.add(k('id'), 'This slab no longer belongs to the selected scope. Reload and try again.');
    out.isActive = typeof r.isActive === 'boolean' ? r.isActive : true;
    return out;
  });
  v.throwIfAny();

  // The final set must not overlap (a row without a range covers every target).
  for (let i = 0; i < parsed.length; i += 1) {
    for (let j = i + 1; j < parsed.length; j += 1) {
      const aLo = parsed[i].targetFromPaise ?? 0;
      const aHi = parsed[i].targetToPaise ?? NONE;
      const bLo = parsed[j].targetFromPaise ?? 0;
      const bHi = parsed[j].targetToPaise ?? NONE;
      if (aLo <= bHi && bLo <= aHi) {
        v.add(`slabs.${j}.targetFrom`, `Overlaps slab ${i + 1}`);
        v.add(`slabs.${i}.targetTo`, `Overlaps slab ${j + 1}`);
      }
    }
  }
  v.throwIfAny(); // 422 with per-row messages, e.g. slabs.2.targetFrom

  const keep = new Set(parsed.filter((p) => p.id).map((p) => p.id));
  const ops = [];
  for (const p of parsed) {
    const hasRange = p.targetFromPaise !== undefined;
    const set = { commissionType: p.commissionType, commissionValue: p.commissionValue, isActive: p.isActive, updatedBy: req.user._id };
    if (hasRange) {
      set.targetFromPaise = p.targetFromPaise;
      set.targetToPaise = p.targetToPaise;
    }
    const unset = {};
    if (!hasRange) Object.assign(unset, { targetFromPaise: '', targetToPaise: '' });
    if (p.durationMonths !== undefined) {
      set.durationMonths = p.durationMonths;
      set.startDelayMonths = p.startDelayMonths;
    } else Object.assign(unset, { durationMonths: '', startDelayMonths: '' });
    if (p.id) {
      ops.push({
        updateOne: {
          filter: { _id: p.id },
          update: { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
        },
      });
    } else {
      ops.push({
        insertOne: {
          document: {
            commissionFor,
            financialYear: fy._id,
            ...(rank ? { rank: rank._id } : {}),
            ...(hasRange ? { targetFromPaise: p.targetFromPaise, targetToPaise: p.targetToPaise } : {}),
            commissionType: p.commissionType,
            commissionValue: p.commissionValue,
            ...(p.durationMonths !== undefined ? { durationMonths: p.durationMonths, startDelayMonths: p.startDelayMonths } : {}),
            isActive: p.isActive,
            createdBy: req.user._id,
            updatedBy: req.user._id,
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

  const fresh = await Commission.find(filter).populate(POPULATE).sort({ targetFromPaise: 1, _id: 1 });
  await audit(req, {
    action: 'commission.saveScope',
    entity: 'Commission',
    entityId: `${commissionFor}:${fy.financialYearId}:${rank ? rank._id : 'all'}`,
    before: { count: existing.length },
    after: { count: fresh.length },
  });
  res.json({ items: fresh.map(present) });
}


/**
 * Shows what a group leader would earn under a rule, for loans disbursed in given months.
 * Uses the same engine the monthly report will use, so the preview is the real calculation.
 *
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

import mongoose from 'mongoose';
import { Commission, COMMISSION_FOR, COMMISSION_TYPES } from '../models/Commission.js';
import { FinancialYear } from '../models/FinancialYear.js';
import { Rank } from '../models/Rank.js';
import { createValidator, parsePaging, HttpError } from '../utils/http.js';
import { toMinor, fromMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';

const MAX_PAISE = 100_000_000_000 * 100; // 1,000 crore rupees
const MAX_BP = 10_000; // 100.00 %
const POPULATE = [
  { path: 'financialYear', select: 'name financialYearId startDate endDate isActive' },
  { path: 'rank', select: 'name code' },
];

const present = (c) => ({
  id: c._id,
  commissionFor: c.commissionFor,
  financialYear: c.financialYear?._id
    ? { id: c.financialYear._id, name: c.financialYear.name, financialYearId: c.financialYear.financialYearId }
    : null,
  financialYearId: String(c.financialYear?._id || c.financialYear),
  rank: c.rank?._id ? { id: c.rank._id, name: c.rank.name, code: c.rank.code } : null,
  rankId: c.rank?._id ? String(c.rank._id) : '',
  targetFrom: fromMinor(c.targetFromPaise ?? null),
  targetTo: fromMinor(c.targetToPaise ?? null),
  commissionType: c.commissionType,
  // percentage is returned as a percent (2.5), fixed as rupees.
  commissionValue: c.commissionValue / 100,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

async function readCommission(b) {
  const v = createValidator();
  const out = {};

  out.commissionFor = String(b.commissionFor || '');
  if (!COMMISSION_FOR.includes(out.commissionFor)) v.add('commissionFor', 'Select who the commission is for');

  const fyId = String(b.financialYear || '');
  let fy = null;
  if (!mongoose.isValidObjectId(fyId)) v.add('financialYear', 'Select a financial year');
  else {
    fy = await FinancialYear.findById(fyId);
    if (!fy) v.add('financialYear', 'Selected financial year does not exist');
  }
  out.financialYear = fy?._id;

  // Rank applies to employee commission only; empty means every rank.
  out.rank = undefined;
  if (out.commissionFor === 'employee' && b.rank) {
    const rankId = String(b.rank);
    const rank = mongoose.isValidObjectId(rankId) ? await Rank.findOne({ _id: rankId, isDeleted: false }) : null;
    if (!rank) v.add('rank', 'Selected rank does not exist');
    else out.rank = rank._id;
  }

  const hasFrom = b.targetFrom !== undefined && b.targetFrom !== null && String(b.targetFrom).trim() !== '';
  const hasTo = b.targetTo !== undefined && b.targetTo !== null && String(b.targetTo).trim() !== '';
  if (out.commissionFor === 'employee' && !(hasFrom && hasTo)) {
    if (!hasFrom) v.add('targetFrom', 'Enter the target start amount');
    if (!hasTo) v.add('targetTo', 'Enter the target end amount');
  } else if (hasFrom !== hasTo) {
    v.add(hasFrom ? 'targetTo' : 'targetFrom', 'Enter both target amounts, or leave both empty');
  }
  if (hasFrom && hasTo) {
    const from = toMinor(b.targetFrom);
    const to = toMinor(b.targetTo);
    if (from === null || from > MAX_PAISE) v.add('targetFrom', 'Enter a valid amount (up to 2 decimals)');
    if (to === null || to > MAX_PAISE) v.add('targetTo', 'Enter a valid amount (up to 2 decimals)');
    if (from !== null && to !== null) {
      if (to < from) v.add('targetTo', 'Target end must not be less than target start');
      out.targetFromPaise = from;
      out.targetToPaise = to;
    }
  }

  out.commissionType = String(b.commissionType || '');
  if (!COMMISSION_TYPES.includes(out.commissionType)) v.add('commissionType', 'Select percentage or fixed amount');
  const value = toMinor(b.commissionValue);
  if (value === null || value < 1) v.add('commissionValue', 'Enter a value greater than 0 (up to 2 decimals)');
  else if (out.commissionType === 'percentage' && value > MAX_BP) v.add('commissionValue', 'Percentage cannot exceed 100');
  else if (value > MAX_PAISE) v.add('commissionValue', 'Amount is too large');
  else out.commissionValue = value;

  v.throwIfAny();
  return out;
}

// Slabs in the same scope (type + financial year + rank) must not overlap.
// A rule without a target range covers every target.
async function assertNoOverlap(data, excludeId) {
  const filter = {
    isDeleted: false,
    commissionFor: data.commissionFor,
    financialYear: data.financialYear,
    rank: data.rank || { $exists: false },
  };
  if (excludeId) filter._id = { $ne: excludeId };

  const lo = data.targetFromPaise ?? 0;
  const hi = data.targetToPaise ?? Number.MAX_SAFE_INTEGER;
  const others = await Commission.find(filter);
  const clash = others.find((o) => {
    const oLo = o.targetFromPaise ?? 0;
    const oHi = o.targetToPaise ?? Number.MAX_SAFE_INTEGER;
    return lo <= oHi && oLo <= hi;
  });
  if (clash) {
    const range =
      clash.targetFromPaise === undefined || clash.targetFromPaise === null
        ? 'covers every target'
        : `covers ${clash.targetFromPaise / 100} – ${clash.targetToPaise / 100}`;
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
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;

  const [items, total] = await Promise.all([
    Commission.find(filter)
      .populate(POPULATE)
      .sort({ commissionFor: 1, financialYear: -1, targetFromPaise: 1, _id: 1 })
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

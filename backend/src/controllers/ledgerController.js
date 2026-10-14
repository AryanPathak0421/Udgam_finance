import mongoose from 'mongoose';
import { Ledger, BALANCE_TYPES } from '../models/Ledger.js';
import { AccountGroup } from '../models/AccountGroup.js';
import { ensureDefaultGroups, loadGroupTree } from '../services/accountGroups.js';
import { asString, createValidator, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';

const MAX_PAISE = 100_000_000_000 * 100; // 1,000 crore rupees
const iso = (d) => d.toISOString().slice(0, 10);

function present(l, tree) {
  const gid = String(l.group?._id || l.group);
  const group = tree.byId.get(gid);
  return {
    id: l._id,
    name: l.name,
    groupId: gid,
    group: group ? { id: group._id, name: group.name, nature: group.nature, path: tree.pathOf(gid).join(' › ') } : null,
    type: l.type,
    openingDate: iso(l.openingDate),
    openingAmount: l.openingAmountPaise / 100,
    isActive: l.isActive,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

async function readLedger(b) {
  const v = createValidator();
  const out = {};

  out.name = asString(b.name);
  if (out.name.length < 2 || out.name.length > 80) v.add('name', 'Ledger name must be 2–80 characters');

  const groupId = String(b.group || '');
  let group = null;
  if (!mongoose.isValidObjectId(groupId)) v.add('group', 'Select the group this ledger belongs to');
  else {
    group = await AccountGroup.findOne({ _id: groupId, isDeleted: false });
    if (!group) v.add('group', 'Selected group does not exist');
    else if (!group.isActive) v.add('group', 'Selected group is inactive');
  }
  out.group = group?._id;

  out.type = String(b.type || '');
  if (!BALANCE_TYPES.includes(out.type)) v.add('type', 'Select debit or credit');

  const date = parseDateOnly(b.openingDate);
  if (!date) v.add('openingDate', 'Enter a valid opening date');
  else if (date > new Date()) v.add('openingDate', 'Opening date cannot be in the future');
  out.openingDate = date;

  const paise = toMinor(b.openingAmount === '' || b.openingAmount === undefined ? '0' : b.openingAmount);
  if (paise === null || paise > MAX_PAISE) v.add('openingAmount', 'Enter a valid amount (0 or more, up to 2 decimals)');
  out.openingAmountPaise = paise;

  v.throwIfAny();
  return out;
}

const duplicate = () => new HttpError(409, 'Ledger name already exists', { name: 'This ledger name is already in use' });

export async function listLedgers(req, res) {
  await ensureDefaultGroups();
  const { page, limit, skip } = parsePaging(req.query);
  const tree = await loadGroupTree();
  const filter = { isDeleted: false };

  const q = asString(req.query.q);
  if (q) filter.name = new RegExp(escapeRegex(q), 'i');
  if (mongoose.isValidObjectId(req.query.group)) {
    // A group filter includes everything beneath it.
    filter.group = { $in: [req.query.group, ...tree.descendantIds(req.query.group)] };
  }
  if (BALANCE_TYPES.includes(req.query.type)) filter.type = req.query.type;
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;

  const [items, total, sums] = await Promise.all([
    Ledger.find(filter).sort({ name: 1 }).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit),
    Ledger.countDocuments(filter),
    Ledger.aggregate([
      { $match: { ...filter, group: filter.group ? { $in: filter.group.$in.map((i) => new mongoose.Types.ObjectId(String(i))) } : { $exists: true } } },
      { $group: { _id: '$type', paise: { $sum: '$openingAmountPaise' } } },
    ]),
  ]);

  const dr = sums.find((s) => s._id === 'debit')?.paise || 0;
  const cr = sums.find((s) => s._id === 'credit')?.paise || 0;
  res.json({
    items: items.map((l) => present(l, tree)),
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
    // Totals over the whole filtered set (not just this page).
    totals: { debit: dr / 100, credit: cr / 100, difference: (dr - cr) / 100 },
  });
}

export async function createLedger(req, res) {
  const data = await readLedger(req.body || {});
  let doc;
  try {
    doc = await Ledger.create({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  await audit(req, { action: 'ledger.create', entity: 'Ledger', entityId: doc._id, after: doc });
  res.status(201).json({ ledger: present(doc, await loadGroupTree()) });
}

export async function updateLedger(req, res) {
  const doc = await Ledger.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Ledger not found');
  const data = await readLedger(req.body || {});
  const before = doc.toObject();
  Object.assign(doc, { ...data, updatedBy: req.user._id });
  try {
    await doc.save();
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  await audit(req, { action: 'ledger.update', entity: 'Ledger', entityId: doc._id, before, after: doc });
  res.json({ ledger: present(doc, await loadGroupTree()) });
}

export async function setLedgerStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const doc = await Ledger.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Ledger not found');
  doc.isActive = req.body.isActive;
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: doc.isActive ? 'ledger.activate' : 'ledger.deactivate', entity: 'Ledger', entityId: doc._id });
  res.json({ ledger: present(doc, await loadGroupTree()) });
}

// Soft delete. Once vouchers/transactions post to a ledger this must be blocked.
export async function deleteLedger(req, res) {
  const doc = await Ledger.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Ledger not found');
  const before = doc.toObject();
  doc.isDeleted = true;
  doc.isActive = false;
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: 'ledger.delete', entity: 'Ledger', entityId: doc._id, before });
  res.json({ message: 'Ledger deleted' });
}

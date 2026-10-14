import mongoose from 'mongoose';
import { Voucher } from '../models/Voucher.js';
import { FinancialYear } from '../models/FinancialYear.js';
import { asString, createValidator, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const POPULATE = { path: 'financialYear', select: 'name financialYearId startDate endDate' };
const iso = (d) => d.toISOString().slice(0, 10);

const present = (x) => ({
  id: x._id,
  name: x.name,
  financialYear: x.financialYear?._id
    ? { id: x.financialYear._id, name: x.financialYear.name, financialYearId: x.financialYear.financialYearId }
    : null,
  financialYearId: String(x.financialYear?._id || x.financialYear),
  month: x.month,
  fromDate: iso(x.fromDate),
  toDate: iso(x.toDate),
  isActive: x.isActive,
  createdAt: x.createdAt,
  updatedAt: x.updatedAt,
});

async function readVoucher(b, excludeId) {
  const v = createValidator();
  const name = asString(b.name);
  const month = Number(b.month);
  const fromDate = parseDateOnly(b.fromDate);
  const toDate = parseDateOnly(b.toDate);

  if (name.length < 2 || name.length > 80) v.add('name', 'Voucher name must be 2–80 characters');
  if (!Number.isInteger(month) || month < 1 || month > 12) v.add('month', 'Select a month');
  if (!fromDate) v.add('fromDate', 'Enter a valid from date');
  if (!toDate) v.add('toDate', 'Enter a valid to date');
  if (fromDate && toDate && toDate < fromDate) v.add('toDate', 'To date must not be before from date');

  const fyId = String(b.financialYear || '');
  let fy = null;
  if (!mongoose.isValidObjectId(fyId)) v.add('financialYear', 'Select a financial year');
  else {
    fy = await FinancialYear.findById(fyId);
    if (!fy) v.add('financialYear', 'Selected financial year does not exist');
  }
  // The window must sit inside the financial year.
  if (fy && fromDate && fromDate < fy.startDate) v.add('fromDate', `Must be on or after ${iso(fy.startDate)} (start of ${fy.name})`);
  if (fy && toDate && toDate > fy.endDate) v.add('toDate', `Must be on or before ${iso(fy.endDate)} (end of ${fy.name})`);
  v.throwIfAny();

  // Voucher windows must not overlap within a financial year.
  const filter = { isDeleted: false, financialYear: fy._id, fromDate: { $lte: toDate }, toDate: { $gte: fromDate } };
  if (excludeId) filter._id = { $ne: excludeId };
  const clash = await Voucher.findOne(filter);
  if (clash) {
    throw new HttpError(409, `Dates overlap with voucher "${clash.name}"`, {
      fromDate: `Overlaps "${clash.name}" (${iso(clash.fromDate)} to ${iso(clash.toDate)})`,
    });
  }
  return { name, month, fromDate, toDate, financialYear: fy._id };
}

const duplicate = (err) => {
  const key = Object.keys(err.keyPattern || {});
  if (key.includes('name')) return new HttpError(409, 'Voucher name already exists', { name: 'This name is already used in this financial year' });
  return new HttpError(409, 'A voucher for this month already exists', { month: 'This month already has a voucher in this financial year' });
};

export async function listVouchers(req, res) {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { isDeleted: false };
  const q = asString(req.query.q);
  if (q) filter.name = new RegExp(escapeRegex(q), 'i');
  if (mongoose.isValidObjectId(req.query.financialYear)) filter.financialYear = req.query.financialYear;
  const month = Number(req.query.month);
  if (Number.isInteger(month) && month >= 1 && month <= 12) filter.month = month;
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;

  const [items, total] = await Promise.all([
    Voucher.find(filter).populate(POPULATE).sort({ fromDate: -1, _id: 1 }).skip(skip).limit(limit),
    Voucher.countDocuments(filter),
  ]);
  res.json({ items: items.map(present), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

export async function createVoucher(req, res) {
  const data = await readVoucher(req.body || {});
  let doc;
  try {
    doc = await Voucher.create({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw duplicate(err);
    throw err;
  }
  await doc.populate(POPULATE);
  await audit(req, { action: 'voucher.create', entity: 'Voucher', entityId: doc._id, after: doc });
  res.status(201).json({ voucher: present(doc) });
}

export async function updateVoucher(req, res) {
  const doc = await Voucher.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Voucher not found');
  const data = await readVoucher(req.body || {}, doc._id);
  const before = doc.toObject();
  Object.assign(doc, { ...data, updatedBy: req.user._id });
  try {
    await doc.save();
  } catch (err) {
    if (err.code === 11000) throw duplicate(err);
    throw err;
  }
  await doc.populate(POPULATE);
  await audit(req, { action: 'voucher.update', entity: 'Voucher', entityId: doc._id, before, after: doc });
  res.json({ voucher: present(doc) });
}

export async function setVoucherStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const doc = await Voucher.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Voucher not found');
  doc.isActive = req.body.isActive;
  doc.updatedBy = req.user._id;
  await doc.save();
  await doc.populate(POPULATE);
  await audit(req, { action: doc.isActive ? 'voucher.activate' : 'voucher.deactivate', entity: 'Voucher', entityId: doc._id });
  res.json({ voucher: present(doc) });
}

export async function deleteVoucher(req, res) {
  const doc = await Voucher.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Voucher not found');
  const before = doc.toObject();
  doc.isDeleted = true;
  doc.isActive = false;
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: 'voucher.delete', entity: 'Voucher', entityId: doc._id, before });
  res.json({ message: 'Voucher deleted' });
}

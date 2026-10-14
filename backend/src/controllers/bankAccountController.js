import mongoose from 'mongoose';
import { BankAccount } from '../models/BankAccount.js';
import { Branch } from '../models/Branch.js';
import { asString, createValidator, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';

const ACCOUNT_RE = /^\d{9,18}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const MAX_PAISE = 100_000_000_000 * 100; // 1,000 crore rupees
const toPaise = toMinor;

const present = (a) => ({
  id: a._id,
  accountHolderName: a.accountHolderName,
  accountNumber: a.accountNumber,
  bankName: a.bankName,
  ifsc: a.ifsc || '',
  address: a.address,
  openingAmount: a.openingAmountPaise / 100, // rupees; stored as integer paise
  openDate: a.openDate.toISOString().slice(0, 10),
  branches: (a.branches || []).map((b) => (b._id ? { id: b._id, code: b.code, name: b.name } : { id: b })),
  isActive: a.isActive,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

const populate = { path: 'branches', select: 'code name' };

async function validateAccount(b) {
  const v = createValidator();
  const out = {
    accountHolderName: asString(b.accountHolderName),
    accountNumber: asString(b.accountNumber),
    bankName: asString(b.bankName),
    ifsc: asString(b.ifsc).toUpperCase(),
    address: asString(b.address),
    openDate: parseDateOnly(b.openDate),
  };
  if (out.accountHolderName.length < 2 || out.accountHolderName.length > 100) v.add('accountHolderName', 'Account holder name must be 2–100 characters');
  if (!ACCOUNT_RE.test(out.accountNumber)) v.add('accountNumber', 'Account number must be 9–18 digits');
  if (out.bankName.length < 2 || out.bankName.length > 100) v.add('bankName', 'Bank name must be 2–100 characters');
  if (out.ifsc && !IFSC_RE.test(out.ifsc)) v.add('ifsc', 'Enter a valid IFSC (e.g. SBIN0001234)');
  if (out.address.length < 5 || out.address.length > 300) v.add('address', 'Address must be 5–300 characters');
  const paise = toPaise(b.openingAmount);
  if (paise === null || paise > MAX_PAISE) v.add('openingAmount', 'Enter a valid amount (0 or more, up to 2 decimal places)');
  else out.openingAmountPaise = paise;
  if (!out.openDate) v.add('openDate', 'Enter a valid open date');

  const raw = Array.isArray(b.branches) ? b.branches.map(String) : [];
  let branchIds = [];
  if (!raw.length) v.add('branches', 'Select at least one branch');
  else if (!raw.every((id) => mongoose.isValidObjectId(id))) v.add('branches', 'Invalid branch selection');
  else {
    branchIds = [...new Set(raw)];
    const found = await Branch.countDocuments({ _id: { $in: branchIds }, isDeleted: false });
    if (found !== branchIds.length) v.add('branches', 'One or more selected branches no longer exist');
  }
  v.throwIfAny();
  return { ...out, branches: branchIds };
}

const duplicate = () =>
  new HttpError(409, 'Account already exists', { accountNumber: 'This account number is already registered for this bank' });

export async function listBankAccounts(req, res) {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { isDeleted: false };
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ accountHolderName: rx }, { accountNumber: rx }, { bankName: rx }];
  }
  if (mongoose.isValidObjectId(req.query.branch)) filter.branches = req.query.branch;
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;

  const [items, total] = await Promise.all([
    BankAccount.find(filter).populate(populate).sort({ createdAt: -1, _id: 1 }).skip(skip).limit(limit),
    BankAccount.countDocuments(filter),
  ]);
  res.json({ items: items.map(present), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

export async function createBankAccount(req, res) {
  const data = await validateAccount(req.body || {});
  let acc;
  try {
    acc = await BankAccount.create({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  await acc.populate(populate);
  await audit(req, { action: 'bankAccount.create', entity: 'BankAccount', entityId: acc._id, after: acc });
  res.status(201).json({ account: present(acc) });
}

export async function updateBankAccount(req, res) {
  const acc = await BankAccount.findOne({ _id: req.params.id, isDeleted: false });
  if (!acc) throw new HttpError(404, 'Bank account not found');
  const data = await validateAccount(req.body || {});
  const before = acc.toObject();
  Object.assign(acc, { ...data, updatedBy: req.user._id });
  try {
    await acc.save();
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  await acc.populate(populate);
  await audit(req, { action: 'bankAccount.update', entity: 'BankAccount', entityId: acc._id, before, after: acc });
  res.json({ account: present(acc) });
}

export async function setBankAccountStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const acc = await BankAccount.findOne({ _id: req.params.id, isDeleted: false });
  if (!acc) throw new HttpError(404, 'Bank account not found');
  acc.isActive = req.body.isActive;
  acc.updatedBy = req.user._id;
  await acc.save();
  await acc.populate(populate);
  await audit(req, { action: acc.isActive ? 'bankAccount.activate' : 'bankAccount.deactivate', entity: 'BankAccount', entityId: acc._id });
  res.json({ account: present(acc) });
}

export async function deleteBankAccount(req, res) {
  const acc = await BankAccount.findOne({ _id: req.params.id, isDeleted: false });
  if (!acc) throw new HttpError(404, 'Bank account not found');
  const before = acc.toObject();
  acc.isDeleted = true;
  acc.isActive = false;
  acc.updatedBy = req.user._id;
  await acc.save();
  await audit(req, { action: 'bankAccount.delete', entity: 'BankAccount', entityId: acc._id, before });
  res.json({ message: 'Bank account deleted' });
}


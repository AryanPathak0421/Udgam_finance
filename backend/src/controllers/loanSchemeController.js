import { LoanScheme, LOAN_TYPES, TERM_UNITS, SECURITY_TYPES, CHARGE_TYPES, FINE_COUNTING, ROUNDING_OPTIONS } from '../models/LoanScheme.js';
import { MODES, CALCULATION_TYPES, EMI_TYPES } from '../services/loanCalculator.js';
import { asString, createValidator, escapeRegex, parsePaging, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';

const CODE_RE = /^[A-Z0-9-]{2,12}$/;
const MAX_AMOUNT_PAISE = 100_000_000 * 100; // ₹10 crore
const MAX_BP = 10_000; // 100.00 %
const MAX_FIXED_PAISE = 10_000_000 * 100; // ₹1 crore per charge
const TERM_LIMIT = { days: 10950, weeks: 1560, months: 360 }; // 30 years

const pct = (bp) => bp / 100;
const rs = (paise) => paise / 100;

export const presentScheme = (s) => ({
  id: s._id,
  code: s.code,
  name: s.name,
  loanType: s.loanType,
  amountMin: rs(s.amountMinPaise),
  amountMax: rs(s.amountMaxPaise),
  termUnit: s.termUnit,
  termMin: s.termMin,
  termMax: s.termMax,
  ageMin: s.ageMin,
  ageMax: s.ageMax,
  roiMin: pct(s.roiMinBp),
  roiMax: pct(s.roiMaxBp),
  modes: s.modes,
  calculationType: s.calculationType,
  emiType: s.emiType,
  securityType: s.securityType,
  securityPercent: pct(s.securityBp),
  processingFee: { type: s.processingFee.type, value: s.processingFee.type === 'percentage' ? pct(s.processingFee.value) : rs(s.processingFee.value) },
  cost: { type: s.cost.type, value: s.cost.type === 'percentage' ? pct(s.cost.value) : rs(s.cost.value) },
  installmentRounding: s.installmentRounding ?? 1,
  gracePeriodDays: s.gracePeriodDays ?? 0,
  fine: {
    type: s.fine?.type || 'fixed',
    value: (s.fine?.type || 'fixed') === 'percentage' ? pct(s.fine?.value || 0) : rs(s.fine?.value || 0),
    counting: s.fine?.counting || 'per_day',
  },
  isActive: s.isActive,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

function readCharge(raw, field, label, v) {
  const type = String(raw?.type || '');
  if (!CHARGE_TYPES.includes(type)) {
    v.add(field, `Select ${label} type`);
    return null;
  }
  const value = toMinor(raw?.value === '' || raw?.value === undefined ? '0' : raw.value);
  const max = type === 'percentage' ? MAX_BP : MAX_FIXED_PAISE;
  if (value === null || value > max) {
    v.add(field, type === 'percentage' ? `${label} must be 0–100 (up to 2 decimals)` : `Enter a valid ${label} amount (up to 2 decimals)`);
    return null;
  }
  return { type, value };
}

function readScheme(b) {
  const v = createValidator();
  const out = {};

  out.code = asString(b.code).toUpperCase();
  if (!CODE_RE.test(out.code)) v.add('code', 'Code must be 2–12 characters: letters, numbers or hyphen');
  out.name = asString(b.name);
  if (out.name.length < 2 || out.name.length > 80) v.add('name', 'Scheme name must be 2–80 characters');
  out.loanType = String(b.loanType || '');
  if (!LOAN_TYPES.includes(out.loanType)) v.add('loanType', 'Select a loan type');

  const amountMin = toMinor(b.amountMin);
  const amountMax = toMinor(b.amountMax);
  if (amountMin === null || amountMin < 100 || amountMin > MAX_AMOUNT_PAISE) v.add('amountMin', 'Enter a minimum amount of ₹1 or more');
  if (amountMax === null || amountMax < 100 || amountMax > MAX_AMOUNT_PAISE) v.add('amountMax', 'Enter a maximum amount up to ₹10,00,00,000');
  if (amountMin !== null && amountMax !== null && amountMax < amountMin) v.add('amountMax', 'Maximum must not be less than minimum');
  out.amountMinPaise = amountMin;
  out.amountMaxPaise = amountMax;

  out.termUnit = String(b.termUnit || '');
  if (!TERM_UNITS.includes(out.termUnit)) v.add('termUnit', 'Select the term unit');
  const termMin = Number(b.termMin);
  const termMax = Number(b.termMax);
  const limit = TERM_LIMIT[out.termUnit] || 0;
  if (!Number.isInteger(termMin) || termMin < 1) v.add('termMin', 'Enter a whole number of 1 or more');
  if (!Number.isInteger(termMax) || termMax < 1) v.add('termMax', 'Enter a whole number of 1 or more');
  else if (limit && termMax > limit) v.add('termMax', `Cannot exceed ${limit} ${out.termUnit} (30 years)`);
  if (Number.isInteger(termMin) && Number.isInteger(termMax) && termMax < termMin) v.add('termMax', 'Maximum must not be less than minimum');
  out.termMin = termMin;
  out.termMax = termMax;

  const ageMin = Number(b.ageMin);
  const ageMax = Number(b.ageMax);
  if (!Number.isInteger(ageMin) || ageMin < 18 || ageMin > 100) v.add('ageMin', 'Age must be between 18 and 100');
  if (!Number.isInteger(ageMax) || ageMax < 18 || ageMax > 100) v.add('ageMax', 'Age must be between 18 and 100');
  if (Number.isInteger(ageMin) && Number.isInteger(ageMax) && ageMax < ageMin) v.add('ageMax', 'Maximum age must not be less than minimum');
  out.ageMin = ageMin;
  out.ageMax = ageMax;

  const roiMin = toMinor(b.roiMin);
  const roiMax = toMinor(b.roiMax);
  if (roiMin === null || roiMin > MAX_BP) v.add('roiMin', 'Enter a rate from 0 to 100 (up to 2 decimals)');
  if (roiMax === null || roiMax > MAX_BP) v.add('roiMax', 'Enter a rate from 0 to 100 (up to 2 decimals)');
  if (roiMin !== null && roiMax !== null && roiMax < roiMin) v.add('roiMax', 'Max ROI must not be less than Min ROI');
  out.roiMinBp = roiMin;
  out.roiMaxBp = roiMax;

  const modes = Array.isArray(b.modes) ? [...new Set(b.modes.map(String))] : [];
  if (!modes.length) v.add('modes', 'Select at least one loan mode');
  else if (!modes.every((m) => MODES[m])) v.add('modes', 'Invalid loan mode selected');
  out.modes = modes;

  out.calculationType = String(b.calculationType || '');
  if (!CALCULATION_TYPES.includes(out.calculationType)) v.add('calculationType', 'Select flat or reducing');
  out.emiType = String(b.emiType || 'equal');
  if (!EMI_TYPES.includes(out.emiType)) v.add('emiType', 'Select an EMI type');
  // A flat loan always has equal installments; the pattern only varies for reducing balance.
  if (out.calculationType === 'flat') out.emiType = 'equal';

  out.securityType = String(b.securityType || 'none');
  if (!SECURITY_TYPES.includes(out.securityType)) v.add('securityType', 'Select a security type');
  const sec = toMinor(b.securityPercent === '' || b.securityPercent === undefined ? '0' : b.securityPercent);
  if (sec === null || sec > MAX_BP) v.add('securityPercent', 'Enter a percentage from 0 to 100 (up to 2 decimals)');
  else if (out.securityType === 'none' && sec > 0) v.add('securityPercent', 'Choose a security type, or set this to 0');
  out.securityBp = sec ?? 0;

  out.processingFee = readCharge(b.processingFee, 'processingFee', 'processing fee', v);
  out.cost = readCharge(b.cost, 'cost', 'cost', v);

  // Installment rounding
  const rounding = Number(b.installmentRounding === undefined || b.installmentRounding === '' ? 1 : b.installmentRounding);
  if (!ROUNDING_OPTIONS.includes(rounding)) v.add('installmentRounding', 'Choose none, ₹1, ₹5 or ₹10');
  out.installmentRounding = rounding;

  // Late payment: grace period and fine
  const grace = Number(b.gracePeriodDays === undefined || b.gracePeriodDays === '' ? 0 : b.gracePeriodDays);
  if (!Number.isInteger(grace) || grace < 0 || grace > 365) v.add('gracePeriodDays', 'Enter whole days from 0 to 365');
  out.gracePeriodDays = grace;

  const fine = readCharge(b.fine, 'fine', 'fine', v);
  const counting = String(b.fine?.counting || 'per_day');
  if (!FINE_COUNTING.includes(counting)) v.add('fineCounting', 'Select how the fine is counted');
  out.fine = fine ? { ...fine, counting } : null;

  v.throwIfAny();
  return out;
}

const duplicate = (err) => {
  const key = Object.keys(err.keyPattern || {})[0];
  return key === 'name'
    ? new HttpError(409, 'Scheme name already exists', { name: 'This scheme name is already in use' })
    : new HttpError(409, 'Scheme code already exists', { code: 'This scheme code is already in use' });
};

export async function listSchemes(req, res) {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { isDeleted: false };
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }];
  }
  if (LOAN_TYPES.includes(req.query.loanType)) filter.loanType = req.query.loanType;
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;

  const [items, total] = await Promise.all([
    LoanScheme.find(filter).sort({ code: 1 }).skip(skip).limit(limit),
    LoanScheme.countDocuments(filter),
  ]);
  res.json({ items: items.map(presentScheme), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

// Active schemes, for dropdowns (calculator, and later loan applications).
export async function schemeOptions(_req, res) {
  const items = await LoanScheme.find({ isDeleted: false, isActive: true }).sort({ code: 1 });
  res.json({ items: items.map(presentScheme) });
}

export async function createScheme(req, res) {
  const data = readScheme(req.body || {});
  let doc;
  try {
    doc = await LoanScheme.create({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw duplicate(err);
    throw err;
  }
  await audit(req, { action: 'loanScheme.create', entity: 'LoanScheme', entityId: doc._id, after: doc });
  res.status(201).json({ scheme: presentScheme(doc) });
}

export async function updateScheme(req, res) {
  const doc = await LoanScheme.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Loan scheme not found');
  const data = readScheme(req.body || {});
  delete data.code; // immutable once created
  const before = doc.toObject();
  Object.assign(doc, { ...data, updatedBy: req.user._id });
  try {
    await doc.save();
  } catch (err) {
    if (err.code === 11000) throw duplicate(err);
    throw err;
  }
  await audit(req, { action: 'loanScheme.update', entity: 'LoanScheme', entityId: doc._id, before, after: doc });
  res.json({ scheme: presentScheme(doc) });
}

export async function setSchemeStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const doc = await LoanScheme.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Loan scheme not found');
  doc.isActive = req.body.isActive;
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: doc.isActive ? 'loanScheme.activate' : 'loanScheme.deactivate', entity: 'LoanScheme', entityId: doc._id });
  res.json({ scheme: presentScheme(doc) });
}

export async function deleteScheme(req, res) {
  const doc = await LoanScheme.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Loan scheme not found');
  const before = doc.toObject();
  doc.isDeleted = true;
  doc.isActive = false;
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: 'loanScheme.delete', entity: 'LoanScheme', entityId: doc._id, before });
  res.json({ message: 'Loan scheme deleted' });
}


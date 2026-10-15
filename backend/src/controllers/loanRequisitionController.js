import mongoose from 'mongoose';
import { LoanRequisition } from '../models/LoanRequisition.js';
import { LoanScheme } from '../models/LoanScheme.js';
import { Member } from '../models/Member.js';
import { User } from '../models/User.js';
import { generateCode } from '../services/codeSequence.js';
import { MODES } from '../services/loanCalculator.js';
import { evaluateLoan } from './loanCalculatorController.js';
import { branchFilter, isAdmin, maskMobile } from './groupController.js';
import { asString, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const FULL_MOBILE_ROLES = ['super_admin', 'admin', 'accountant'];
const POPULATE = [{ path: 'branch', select: 'code name' }];
const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const rupees = (p) => (p === undefined || p === null ? null : p / 100);

const ageOn = (dob, on) => {
  let a = on.getUTCFullYear() - dob.getUTCFullYear();
  const m = on.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate())) a -= 1;
  return a;
};

const presentScheme = (s) => ({
  id: s._id,
  code: s.code,
  name: s.name,
  loanType: s.loanType,
  amountMin: s.amountMinPaise / 100,
  amountMax: s.amountMaxPaise / 100,
  termUnit: s.termUnit,
  termMin: s.termMin,
  termMax: s.termMax,
  ageMin: s.ageMin,
  ageMax: s.ageMax,
  roiMin: s.roiMinBp / 100,
  roiMax: s.roiMaxBp / 100,
  modes: s.modes.map((m) => ({ value: m, label: MODES[m]?.label || m, unit: MODES[m]?.unit || '' })),
  calculationType: s.calculationType,
  emiType: s.emiType,
  securityType: s.securityType,
  securityPercent: s.securityBp / 100,
  processingFee: { type: s.processingFee.type, value: s.processingFee.type === 'fixed' ? s.processingFee.value / 100 : s.processingFee.value / 100 },
  gracePeriodDays: s.gracePeriodDays || 0,
});

/** Active personal-loan schemes the requisition form can choose from. */
export async function schemes(_req, res) {
  const items = await LoanScheme.find({ isDeleted: false, isActive: true, loanType: 'personal' }).sort({ name: 1 });
  res.json({ items: items.map(presentScheme) });
}

// ---- borrower -------------------------------------------------------------------------------------------------
/** Members of a branch that can be picked on the form. */
export async function borrowers(req, res) {
  const branch = req.query.branch;
  if (!mongoose.isValidObjectId(branch)) throw new HttpError(422, 'Select the branch first');
  if (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === String(branch))) {
    throw new HttpError(403, 'You can only use branches assigned to you');
  }
  const filter = { isDeleted: false, branch, isBlocked: { $ne: true } };
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }, { mobile: rx }];
  }
  const items = await Member.find(filter).select('code name mobile').sort({ code: 1 }).limit(30);
  res.json({ items: items.map((m) => ({ id: m._id, code: m.code, name: m.name, mobile: m.mobile })) });
}

async function previousLoanPaise(memberId) {
  const last = await LoanRequisition.findOne({ member: memberId, isDeleted: false, status: { $ne: 'cancelled' } })
    .sort({ createdAt: -1 })
    .select('amountPaise');
  return last ? last.amountPaise : 0;
}

/** Everything the form fills in by itself once a borrower is chosen. */
export async function borrowerDetail(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Borrower not found');
  const m = await Member.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) });
  if (!m) throw new HttpError(404, 'Borrower not found');

  const pending = await LoanRequisition.findOne({ member: m._id, isDeleted: false, status: 'pending' }).select('formId');
  const issues = [];
  if (m.isBlocked) issues.push('This borrower is blocked');
  if (!m.guarantor?.name) issues.push('Add the guarantor first (Member Details → Guarantor Detail)');
  if (pending) issues.push(`A requisition (${pending.formId}) is already pending for this borrower`);

  const today = new Date();
  res.json({
    borrower: {
      id: m._id,
      code: m.code,
      name: m.name,
      dob: dateOnly(m.dob),
      age: ageOn(m.dob, today),
      gender: m.gender,
      address: m.address,
      pincode: m.pincode,
      district: m.district,
      state: m.state,
      mobile: FULL_MOBILE_ROLES.includes(req.user.role) ? m.mobile : maskMobile(m.mobile),
      guarantorName: m.guarantor?.name || '',
      previousLoanAmount: rupees(await previousLoanPaise(m._id)),
    },
    issues,
  });
}

// ---- EMI preview ----------------------------------------------------------------------------------------------
const calcInput = (b, loanDate) => ({
  schemeId: b.schemeId,
  amount: b.amount,
  rate: b.rate,
  mode: b.mode,
  term: b.term,
  startDate: loanDate ? dateOnly(loanDate) : undefined,
});

export async function preview(req, res) {
  const r = await evaluateLoan(calcInput(req.body || {}, null));
  res.json({ summary: r.summary, charges: r.charges, input: r.input });
}

// ---- create / list / view ---------------------------------------------------------------------------------------
const present = (r, user, { detail = false } = {}) => {
  const out = {
    id: r._id,
    formId: r.formId,
    branch: r.branch?._id ? { id: r.branch._id, code: r.branch.code, name: r.branch.name } : null,
    loanDate: dateOnly(r.loanDate),
    borrowerId: String(r.member),
    borrowerCode: r.borrower?.code,
    borrowerName: r.borrower?.name,
    schemeName: r.schemeName,
    amount: rupees(r.amountPaise),
    mode: r.mode,
    modeLabel: MODES[r.mode]?.label || r.mode,
    term: r.term,
    emi: rupees(r.installmentPaise),
    status: r.status,
    employeeCode: r.employeeCode,
    createdAt: r.createdAt,
  };
  if (detail) {
    Object.assign(out, {
      borrower: {
        ...r.borrower,
        dob: dateOnly(r.borrower?.dob),
        mobile: FULL_MOBILE_ROLES.includes(user.role) ? r.borrower?.mobile : maskMobile(r.borrower?.mobile),
      },
      previousLoanAmount: rupees(r.previousLoanPaise),
      schemeCode: r.schemeCode,
      rate: r.annualRateBp / 100,
      calculationType: r.calculationType,
      emiType: r.emiType,
      totalInterest: rupees(r.totalInterestPaise),
      totalPayable: rupees(r.totalPayablePaise),
      processingFee: rupees(r.processingFeePaise),
    });
  }
  return out;
};

export async function createRequisition(req, res) {
  const b = req.body || {};

  // Branch + borrower
  const branchId = String(b.branch || '');
  if (!mongoose.isValidObjectId(branchId)) throw new HttpError(422, 'Please correct the highlighted fields', { branch: 'Select a branch' });
  if (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === branchId)) {
    throw new HttpError(403, 'You can only use branches assigned to you');
  }
  if (!mongoose.isValidObjectId(String(b.member || ''))) throw new HttpError(422, 'Please correct the highlighted fields', { member: 'Select the borrower' });
  const m = await Member.findOne({ _id: b.member, isDeleted: false, branch: branchId });
  if (!m) throw new HttpError(422, 'Please correct the highlighted fields', { member: 'Borrower not found in this branch' });
  if (m.isBlocked) throw new HttpError(409, 'This borrower is blocked', { member: 'This borrower is blocked' });
  if (!m.guarantor?.name) throw new HttpError(409, 'The borrower has no guarantor yet', { member: 'Add the guarantor first' });
  const pending = await LoanRequisition.findOne({ member: m._id, isDeleted: false, status: 'pending' }).select('formId');
  if (pending) throw new HttpError(409, `A requisition (${pending.formId}) is already pending for this borrower`, { member: 'A requisition is already pending' });

  // Loan date: today by default; not in the future; staff can go back at most 30 days.
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  let loanDate = today;
  if (b.loanDate !== undefined && b.loanDate !== null && String(b.loanDate).trim() !== '') {
    const d = parseDateOnly(asString(b.loanDate));
    if (!d) throw new HttpError(422, 'Please correct the highlighted fields', { loanDate: 'Enter a valid date' });
    if (d > today) throw new HttpError(422, 'Please correct the highlighted fields', { loanDate: 'Loan date cannot be in the future' });
    if (!isAdmin(req.user) && today.getTime() - d.getTime() > 30 * 24 * 3600 * 1000) {
      throw new HttpError(422, 'Please correct the highlighted fields', { loanDate: 'Loan date cannot be older than 30 days' });
    }
    loanDate = d;
  }

  if (!mongoose.isValidObjectId(String(b.schemeId || ''))) throw new HttpError(422, 'Please correct the highlighted fields', { schemeId: 'Select a loan scheme' });
  // Scheme limits (amount, term, rate, mode) and the EMI come from the shared loan engine.
  const r = await evaluateLoan(calcInput(b, loanDate));
  const scheme = await LoanScheme.findById(r.input.scheme.id);
  if (scheme.loanType !== 'personal') throw new HttpError(422, 'Please correct the highlighted fields', { schemeId: 'Select a personal loan scheme' });
  const age = ageOn(m.dob, loanDate);
  if (age < scheme.ageMin || age > scheme.ageMax) {
    throw new HttpError(422, 'Please correct the highlighted fields', {
      schemeId: `${scheme.name} is for ages ${scheme.ageMin} to ${scheme.ageMax}; the borrower is ${age}`,
    });
  }

  // Employee: chosen on the web form, otherwise the signed-in employee.
  let employeeCode = asString(b.employeeCode).toUpperCase();
  if (employeeCode) {
    const emp = await User.findOne({ employeeCode, isActive: true }).select('role branches');
    const ok = emp && (['super_admin', 'admin'].includes(emp.role) || (emp.branches || []).some((x) => String(x) === branchId));
    if (!ok) throw new HttpError(422, 'Please correct the highlighted fields', { employeeCode: 'Select a valid employee of this branch' });
  } else {
    employeeCode = req.user.employeeCode;
    if (!employeeCode) {
      employeeCode = await generateCode('employee');
      await User.updateOne({ _id: req.user._id, employeeCode: { $exists: false } }, { $set: { employeeCode } });
    }
  }

  const principalPaise = Math.round(r.input.amount * 100);
  const doc = await LoanRequisition.create({
    formId: await generateCode('loanRequisition'),
    branch: branchId,
    loanDate,
    member: m._id,
    borrower: {
      code: m.code,
      name: m.name,
      dob: m.dob,
      age,
      gender: m.gender,
      address: m.address,
      pincode: m.pincode,
      district: m.district,
      state: m.state,
      mobile: m.mobile,
      guarantorName: m.guarantor.name,
    },
    previousLoanPaise: await previousLoanPaise(m._id),
    scheme: scheme._id,
    schemeCode: scheme.code,
    schemeName: scheme.name,
    amountPaise: principalPaise,
    mode: r.input.mode,
    term: r.input.term,
    annualRateBp: Math.round(r.input.rate * 100),
    calculationType: r.input.calculationType,
    emiType: r.input.emiType,
    installmentPaise: Math.round(r.summary.installmentAmount * 100),
    totalInterestPaise: Math.round(r.summary.totalInterest * 100),
    totalPayablePaise: Math.round(r.summary.totalPayable * 100),
    processingFeePaise: r.charges ? Math.round(r.charges.processingFee * 100) : 0,
    employeeCode,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  await doc.populate(POPULATE);
  await audit(req, {
    action: 'loanRequisition.create',
    entity: 'LoanRequisition',
    entityId: doc._id,
    after: { formId: doc.formId, member: m.code, scheme: scheme.code, amount: r.input.amount, term: r.input.term },
  });
  res.status(201).json({ requisition: present(doc, req.user, { detail: true }) });
}

export async function listRequisitions(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { isDeleted: false, ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const status = asString(req.query.status);
  if (['pending', 'approved', 'rejected', 'cancelled'].includes(status)) filter.status = status;
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) {
    filter.loanDate = {};
    if (from) filter.loanDate.$gte = from;
    if (to) filter.loanDate.$lte = to;
  }
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ formId: rx }, { 'borrower.code': rx }, { 'borrower.name': rx }];
  }
  const [items, total] = await Promise.all([
    LoanRequisition.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    LoanRequisition.countDocuments(filter),
  ]);
  res.json({ items: items.map((r) => present(r, req.user)), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

export async function getRequisition(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Requisition not found');
  const r = await LoanRequisition.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) }).populate(POPULATE);
  if (!r) throw new HttpError(404, 'Requisition not found');
  res.json({ requisition: present(r, req.user, { detail: true }) });
}

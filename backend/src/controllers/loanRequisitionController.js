import mongoose from 'mongoose';
import { LoanRequisition, REQUISITION_KINDS } from '../models/LoanRequisition.js';
import { LoanScheme } from '../models/LoanScheme.js';
import { Member } from '../models/Member.js';
import { Group } from '../models/Group.js';
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
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);

const KIND_LABEL = { personal: 'Personal loan', group: 'Group loan', business: 'Business / MSME loan', product: 'Product loan' };
// The scheme type each kind of requisition is made under.
const SCHEME_TYPES = { personal: ['personal'], group: ['group'], business: ['business', 'msme'], product: ['product'] };

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
  processingFee: { type: s.processingFee.type, value: s.processingFee.value / 100 },
  gracePeriodDays: s.gracePeriodDays || 0,
});

/** Active schemes the requisition form of a kind can choose from. */
export async function schemes(req, res) {
  const kind = REQUISITION_KINDS.includes(req.query.kind) ? req.query.kind : 'personal';
  let types = SCHEME_TYPES[kind];
  // Business / MSME: the user first chooses which of the two.
  if (kind === 'business' && ['business', 'msme'].includes(req.query.type)) types = [req.query.type];
  const items = await LoanScheme.find({ isDeleted: false, isActive: true, loanType: { $in: types } }).sort({ name: 1 });
  res.json({ items: items.map(presentScheme) });
}

// ---- borrower (personal / business / product) ----------------------------------------------------------------
function assertBranchAccess(user, branch) {
  if (!mongoose.isValidObjectId(branch)) throw new HttpError(422, 'Select the branch first');
  if (!isAdmin(user) && !(user.branches || []).some((x) => String(x) === String(branch))) {
    throw new HttpError(403, 'You can only use branches assigned to you');
  }
}

/** Members of a branch that can be picked on the form. */
export async function borrowers(req, res) {
  assertBranchAccess(req.user, req.query.branch);
  const filter = { isDeleted: false, branch: req.query.branch, isBlocked: { $ne: true } };
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

  res.json({
    borrower: {
      id: m._id,
      code: m.code,
      name: m.name,
      dob: dateOnly(m.dob),
      age: ageOn(m.dob, new Date()),
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

// ---- group ----------------------------------------------------------------------------------------------------
/** Groups of a branch, optionally narrowed to one employee. */
export async function groups(req, res) {
  assertBranchAccess(req.user, req.query.branch);
  const filter = { isDeleted: false, isActive: true, branch: req.query.branch };
  const emp = asString(req.query.employeeCode).toUpperCase();
  if (emp) filter.employeeCode = emp;
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }, { leaderName: rx }];
  }
  const items = await Group.find(filter).sort({ code: 1 }).limit(50);
  res.json({
    items: items.map((g) => ({
      id: g._id,
      code: g.code,
      name: g.name,
      leaderName: g.leaderName,
      employeeCode: g.employeeCode || '',
      memberCount: (g.members || []).length,
    })),
  });
}

async function loadGroup(req, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Group not found');
  const g = await Group.findOne({ _id: id, isDeleted: false, ...branchFilter(req.user) }).populate('members.member', 'code name isBlocked');
  if (!g) throw new HttpError(404, 'Group not found');
  return g;
}

export async function groupDetail(req, res) {
  const g = await loadGroup(req, req.params.id);
  const members = g.members.filter((x) => x.member).map((x) => x.member);
  const blocked = members.filter((m) => m.isBlocked);
  const pending = await LoanRequisition.findOne({ group: g._id, isDeleted: false, status: 'pending' }).select('formId');
  const issues = [];
  if (!g.isActive) issues.push('This group is inactive');
  if (members.length === 0) issues.push('The group has no members. Add members under Group Master → Group Members');
  if (blocked.length) issues.push(`Blocked members must be removed from the group first: ${blocked.map((m) => m.code).join(', ')}`);
  if (pending) issues.push(`A requisition (${pending.formId}) is already pending for this group`);

  const emp = g.employeeCode ? await User.findOne({ employeeCode: g.employeeCode }).select('name') : null;
  res.json({
    group: {
      id: g._id,
      code: g.code,
      name: g.name,
      leaderName: g.leaderName,
      employeeCode: g.employeeCode || '',
      employeeName: emp?.name || '',
      meetingType: g.meetingType || '',
      memberCount: members.length,
      members: members.map((m) => ({ id: m._id, code: m.code, name: m.name, isBlocked: Boolean(m.isBlocked) })),
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
  const kind = r.kind || 'personal';
  const isGroup = kind === 'group';
  const out = {
    id: r._id,
    kind,
    kindLabel: KIND_LABEL[kind],
    formId: r.formId,
    branch: r.branch?._id ? { id: r.branch._id, code: r.branch.code, name: r.branch.name } : null,
    loanDate: dateOnly(r.loanDate),
    // The "who": the borrower, or the group for a group loan.
    subjectCode: isGroup ? r.groupInfo?.code : r.borrower?.code,
    subjectName: isGroup ? r.groupInfo?.name : r.borrower?.name,
    schemeName: r.schemeName,
    amount: rupees(r.amountPaise),
    memberCount: isGroup ? r.memberCount : null,
    totalAmount: isGroup ? rupees(r.totalAmountPaise) : rupees(r.amountPaise),
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
      borrower: isGroup
        ? null
        : { ...r.borrower, dob: dateOnly(r.borrower?.dob), mobile: FULL_MOBILE_ROLES.includes(user.role) ? r.borrower?.mobile : maskMobile(r.borrower?.mobile) },
      group: isGroup ? r.groupInfo : null,
      business: r.business
        ? {
            loanType: r.business.loanType,
            businessName: r.business.businessName || '',
            gstNumber: r.business.gstNumber || '',
            udgamNumber: r.business.udgamNumber || '',
            civilScore: r.business.civilScore ?? null,
            shopPhoto: r.business.shopPhoto || null,
            bankStatement: r.business.bankStatement || null,
          }
        : null,
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

const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const DOC_RE = /^data:(application\/pdf|image\/png|image\/jpeg);base64,[A-Za-z0-9+/=]+$/;
const GST_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
// Udgam number: letters, digits, hyphen or slash (no fixed format is assumed).
const UDGAM_RE = /^[A-Z0-9][A-Z0-9/-]{4,29}$/;
const MAX_PHOTO_CHARS = 300_000;
const MAX_DOC_CHARS = 1_100_000; // ~800 KB file

function readBusiness(b, errors) {
  const x = b.business || {};
  const out = {};
  out.loanType = asString(x.loanType);
  if (!['business', 'msme'].includes(out.loanType)) errors.loanType = 'Select Business or MSME';
  out.businessName = asString(x.businessName);
  if (out.businessName.length < 2 || out.businessName.length > 100) errors.businessName = 'Enter the business name';
  out.gstNumber = asString(x.gstNumber).toUpperCase();
  if (out.gstNumber && !GST_RE.test(out.gstNumber)) errors.gstNumber = 'Enter a valid 15-character GST number';
  out.udgamNumber = asString(x.udgamNumber).toUpperCase();
  if (out.udgamNumber && !UDGAM_RE.test(out.udgamNumber)) errors.udgamNumber = 'Enter a valid Udgam number (5 to 30 letters or digits)';
  if (out.loanType === 'msme' && !out.udgamNumber) errors.udgamNumber = 'Udgam number is required for an MSME loan';
  const score = Number(x.civilScore);
  if (!Number.isInteger(score) || score < 300 || score > 900) errors.civilScore = 'Enter the civil score (300 to 900)';
  else out.civilScore = score;

  out.shopPhoto = typeof x.shopPhoto === 'string' ? x.shopPhoto : '';
  if (!out.shopPhoto) errors.shopPhoto = 'Shop photo is required';
  else if (!IMAGE_RE.test(out.shopPhoto)) errors.shopPhoto = 'Shop photo must be a PNG or JPEG image';
  else if (out.shopPhoto.length > MAX_PHOTO_CHARS) errors.shopPhoto = 'Shop photo is too large';

  out.bankStatement = typeof x.bankStatement === 'string' ? x.bankStatement : '';
  if (!out.bankStatement) errors.bankStatement = 'Upload the bank statement';
  else if (!DOC_RE.test(out.bankStatement)) errors.bankStatement = 'Bank statement must be a PDF or image';
  else if (out.bankStatement.length > MAX_DOC_CHARS) errors.bankStatement = 'Bank statement must be 800 KB or smaller';
  return out;
}

/** Shared by all four forms. `kind` decides who the loan is for and which scheme types apply. */
export function createRequisition(kind) {
  return async (req, res) => {
    const b = req.body || {};

    // Branch
    const branchId = String(b.branch || '');
    if (!mongoose.isValidObjectId(branchId)) throw invalid({ branch: 'Select a branch' });
    if (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === branchId)) {
      throw new HttpError(403, 'You can only use branches assigned to you');
    }

    // Loan date: today by default; not in the future; staff can go back at most 30 days.
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    let loanDate = today;
    if (b.loanDate !== undefined && b.loanDate !== null && String(b.loanDate).trim() !== '') {
      const d = parseDateOnly(asString(b.loanDate));
      if (!d) throw invalid({ loanDate: 'Enter a valid date' });
      if (d > today) throw invalid({ loanDate: 'Loan date cannot be in the future' });
      if (!isAdmin(req.user) && today.getTime() - d.getTime() > 30 * 24 * 3600 * 1000) {
        throw invalid({ loanDate: 'Loan date cannot be older than 30 days' });
      }
      loanDate = d;
    }

    // Who the loan is for
    let m = null;
    let g = null;
    let groupMembers = [];
    if (kind === 'group') {
      if (!mongoose.isValidObjectId(String(b.group || ''))) throw invalid({ group: 'Select the group' });
      g = await Group.findOne({ _id: b.group, isDeleted: false, branch: branchId }).populate('members.member', 'code name isBlocked');
      if (!g) throw invalid({ group: 'Group not found in this branch' });
      if (!g.isActive) throw new HttpError(409, 'This group is inactive', { group: 'This group is inactive' });
      groupMembers = g.members.filter((x) => x.member).map((x) => x.member);
      if (!groupMembers.length) throw new HttpError(409, 'The group has no members', { group: 'The group has no members' });
      const blocked = groupMembers.filter((x) => x.isBlocked);
      if (blocked.length) {
        throw new HttpError(409, `Blocked members must be removed from the group first: ${blocked.map((x) => x.code).join(', ')}`, { group: 'The group has blocked members' });
      }
      const pending = await LoanRequisition.findOne({ group: g._id, isDeleted: false, status: 'pending' }).select('formId');
      if (pending) throw new HttpError(409, `A requisition (${pending.formId}) is already pending for this group`, { group: 'A requisition is already pending' });
    } else {
      if (!mongoose.isValidObjectId(String(b.member || ''))) throw invalid({ member: 'Select the borrower' });
      m = await Member.findOne({ _id: b.member, isDeleted: false, branch: branchId });
      if (!m) throw invalid({ member: 'Borrower not found in this branch' });
      if (m.isBlocked) throw new HttpError(409, 'This borrower is blocked', { member: 'This borrower is blocked' });
      if (!m.guarantor?.name) throw new HttpError(409, 'The borrower has no guarantor yet', { member: 'Add the guarantor first' });
      const pending = await LoanRequisition.findOne({ member: m._id, isDeleted: false, status: 'pending' }).select('formId');
      if (pending) throw new HttpError(409, `A requisition (${pending.formId}) is already pending for this borrower`, { member: 'A requisition is already pending' });
    }

    // Business / MSME extras
    let business = null;
    if (kind === 'business') {
      const errors = {};
      business = readBusiness(b, errors);
      if (Object.keys(errors).length) throw invalid(Object.fromEntries(Object.entries(errors).map(([k, v]) => [`business.${k}`, v])));
    }

    // Scheme limits and the EMI come from the shared loan engine.
    if (!mongoose.isValidObjectId(String(b.schemeId || ''))) throw invalid({ schemeId: 'Select a loan scheme' });
    const r = await evaluateLoan(calcInput(b, loanDate));
    const scheme = await LoanScheme.findById(r.input.scheme.id);
    if (!SCHEME_TYPES[kind].includes(scheme.loanType)) throw invalid({ schemeId: `Select a ${KIND_LABEL[kind].toLowerCase()} scheme` });
    if (business && scheme.loanType !== business.loanType) {
      throw invalid({ schemeId: `This scheme is a ${scheme.loanType.toUpperCase()} scheme; choose a ${business.loanType.toUpperCase()} scheme` });
    }
    let age = null;
    if (m) {
      age = ageOn(m.dob, loanDate);
      if (age < scheme.ageMin || age > scheme.ageMax) {
        throw invalid({ schemeId: `${scheme.name} is for ages ${scheme.ageMin} to ${scheme.ageMax}; the borrower is ${age}` });
      }
    }

    // Employee: chosen on the web form, otherwise the signed-in employee.
    let employeeCode = asString(b.employeeCode).toUpperCase();
    if (employeeCode) {
      const emp = await User.findOne({ employeeCode, isActive: true }).select('role branches');
      const ok = emp && (['super_admin', 'admin'].includes(emp.role) || (emp.branches || []).some((x) => String(x) === branchId));
      if (!ok) throw invalid({ employeeCode: 'Select a valid employee of this branch' });
    } else {
      employeeCode = req.user.employeeCode;
      if (!employeeCode) {
        employeeCode = await generateCode('employee');
        await User.updateOne({ _id: req.user._id, employeeCode: { $exists: false } }, { $set: { employeeCode } });
      }
    }

    const amountPaise = Math.round(r.input.amount * 100);
    const memberCount = g ? groupMembers.length : undefined;
    const doc = await LoanRequisition.create({
      kind,
      formId: await generateCode('loanRequisition'),
      branch: branchId,
      loanDate,
      ...(m
        ? {
            member: m._id,
            borrower: {
              code: m.code, name: m.name, dob: m.dob, age, gender: m.gender, address: m.address, pincode: m.pincode,
              district: m.district, state: m.state, mobile: m.mobile, guarantorName: m.guarantor.name,
            },
            previousLoanPaise: await previousLoanPaise(m._id),
          }
        : {}),
      ...(g
        ? {
            group: g._id,
            groupInfo: {
              code: g.code, name: g.name, leaderName: g.leaderName, employeeCode: g.employeeCode,
              members: groupMembers.map((x) => ({ code: x.code, name: x.name })),
            },
            memberCount,
            totalAmountPaise: amountPaise * memberCount,
          }
        : {}),
      ...(business ? { business } : {}),
      scheme: scheme._id,
      schemeCode: scheme.code,
      schemeName: scheme.name,
      amountPaise,
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
      after: {
        formId: doc.formId,
        kind,
        for: m ? m.code : g.code,
        scheme: scheme.code,
        amount: r.input.amount,
        term: r.input.term,
        ...(business ? { business: { loanType: business.loanType, civilScore: business.civilScore } } : {}),
      },
    });
    res.status(201).json({ requisition: present(doc, req.user, { detail: true }) });
  };
}

export async function listRequisitions(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { isDeleted: false, ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const status = asString(req.query.status);
  if (['pending', 'approved', 'rejected', 'cancelled'].includes(status)) filter.status = status;
  const kind = asString(req.query.kind);
  if (kind === 'personal') filter.kind = { $in: ['personal', null] };
  else if (REQUISITION_KINDS.includes(kind)) filter.kind = kind;
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
    filter.$or = [{ formId: rx }, { 'borrower.code': rx }, { 'borrower.name': rx }, { 'groupInfo.code': rx }, { 'groupInfo.name': rx }];
  }
  const [items, total] = await Promise.all([
    LoanRequisition.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    LoanRequisition.countDocuments(filter),
  ]);
  res.json({ items: items.map((r) => present(r, req.user)), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

export async function getRequisition(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Requisition not found');
  const r = await LoanRequisition.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) })
    .select('+business.shopPhoto +business.bankStatement')
    .populate(POPULATE);
  if (!r) throw new HttpError(404, 'Requisition not found');
  res.json({ requisition: present(r, req.user, { detail: true }) });
}

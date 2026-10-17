import mongoose from 'mongoose';
import { LoanRequisition, REQUISITION_KINDS } from '../models/LoanRequisition.js';
import { LoanScheme } from '../models/LoanScheme.js';
import { Member } from '../models/Member.js';
import { Group } from '../models/Group.js';
import { User } from '../models/User.js';
import { generateCode } from '../services/codeSequence.js';
import { MODES, calculateLoan } from '../services/loanCalculator.js';
import { evaluateLoan } from './loanCalculatorController.js';
import { branchFilter, isAdmin, maskMobile } from './groupController.js';
import { asString, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { checkGstin, verifyGstin } from '../services/gstVerify.js';
import { StockProduct } from '../models/StockProduct.js';
import { CivilCheck } from '../models/CivilCheck.js';
import { checkPanFormat, kycProviderConfigured } from '../services/kycVerify.js';
import { takeVerified, consumeChallenge, issueOtp } from '../services/otpChallenges.js';
import { sendSms } from '../services/sms.js';
import { verhoeff } from './memberController.js';

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
  securityDeposit: s.securityDeposit?.type === 'fixed'
    ? { type: 'fixed', value: s.securityDeposit.value / 100 }
    : { type: 'percentage', value: (s.securityDeposit?.value ?? s.securityBp ?? 0) / 100 },
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

/** Products in stock that a product loan can be taken for. */
export async function stockProducts(req, res) {
  // Loans are given from the stock of the branch of the requisition.
  if (!mongoose.isValidObjectId(String(req.query.branch || ''))) return res.json({ items: [] });
  assertBranchAccess(req.user, req.query.branch);
  const items = await StockProduct.find({ isDeleted: false, isActive: true, stockQty: { $gt: 0 }, branch: req.query.branch }).sort({ name: 1 });
  res.json({ items: items.map((p) => ({ id: p._id, code: p.code, name: p.name, category: p.category || '', unitPrice: p.unitPricePaise / 100, stockQty: p.stockQty })) });
}

/** What can be verified for a business / MSME requisition: the borrower's PAN and the Aadhaar OTP service. */
export async function verificationStatus(req, res) {
  if (!mongoose.isValidObjectId(req.params.memberId)) throw new HttpError(404, 'Borrower not found');
  const m = await Member.findOne({ _id: req.params.memberId, isDeleted: false, ...branchFilter(req.user) }).select('pan panVerifiedAt name aadhaar');
  if (!m) throw new HttpError(404, 'Borrower not found');
  const fmt = m.pan ? checkPanFormat(m.pan) : { ok: false };
  res.json({
    pan: { present: Boolean(m.pan), formatOk: Boolean(fmt.ok), verified: Boolean(m.panVerifiedAt) },
    aadhaar: { present: Boolean(m.aadhaar), otpServiceConnected: kycProviderConfigured() },
  });
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

// A loan is still running while its requisition is pending or approved (there is no loan closing yet).
const RUNNING = ['pending', 'approved'];

/** member id -> ids of the schemes the member has a loan in that is not finished. */
async function runningSchemes(memberIds) {
  const rows = await LoanRequisition.find({
    isDeleted: false,
    status: { $in: RUNNING },
    $or: [{ member: { $in: memberIds } }, { members: { $in: memberIds } }],
  }).select('member members scheme');
  const map = new Map(memberIds.map((id) => [String(id), new Set()]));
  rows.forEach((r) => {
    const ids = [r.member, ...(r.members || [])].filter(Boolean).map(String);
    ids.forEach((id) => map.get(id)?.add(String(r.scheme)));
  });
  return map;
}

// The newest civil check of a member, for the forms and as a snapshot on a requisition.
async function civilSnapshot(memberId) {
  const c = await CivilCheck.findOne({ member: memberId, isDeleted: false }).sort({ reportDate: -1, createdAt: -1 });
  return c ? { score: c.score, reportDate: dateOnly(c.reportDate), bureau: c.bureau, daysOld: Math.floor((Date.now() - c.reportDate.getTime()) / 86_400_000) } : null;
}

async function civilFor(memberId) {
  const c = await civilSnapshot(memberId);
  return c ? { civilCheck: { score: c.score, reportDate: new Date(c.reportDate), bureau: c.bureau } } : {};
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

  const issues = [];
  if (m.isBlocked) issues.push('This borrower is blocked');
  if (!m.guarantor?.name) issues.push('Add the guarantor first (Member Details → Guarantor Detail)');
  // Schemes this borrower already has an unfinished loan in are not offered again.
  const running = (await runningSchemes([m._id])).get(String(m._id));

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
      runningSchemeIds: [...(running || [])],
      civilCheck: await civilSnapshot(m._id),
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
  const issues = [];
  if (!g.isActive) issues.push('This group is inactive');
  if (members.length === 0) issues.push('The group has no members. Add members under Group Master → Group Members');
  const running = await runningSchemes(members.map((m) => m._id));
  const ids = members.map((m) => m._id);
  const groupLoans = await LoanRequisition.find({ isDeleted: false, kind: 'group', group: g._id, status: { $in: RUNNING }, members: { $in: ids } })
    .select('formId members amountPaise additionalProducts schemeName');
  const loanOf = (mid) => {
    const l = groupLoans.find((x) => x.members.some((id) => String(id) === String(mid)));
    if (!l) return null;
    const used = (l.additionalProducts || []).filter((a) => String(a.member) === String(mid)).reduce((s, a) => s + a.valuePaise, 0);
    const max = Math.floor((l.amountPaise * ADDITIONAL_PRODUCT_PERCENT) / 100);
    return { requisitionId: l._id, formId: l.formId, schemeName: l.schemeName, amount: l.amountPaise / 100, topUpUsed: used / 100, topUpMax: max / 100, topUpLeft: Math.max(max - used, 0) / 100 };
  };

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
      members: members.map((m) => ({
        id: m._id,
        code: m.code,
        name: m.name,
        isBlocked: Boolean(m.isBlocked),
        // schemes in which this member still has an unfinished loan
        runningSchemeIds: [...(running.get(String(m._id)) || [])],
        // the loan this member has running in this group (one per member); more is only a product top-up
        runningInGroup: loanOf(m._id),
      })),
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

// A member of a group loan may take a product (goods) on top of the loan, up to this share of the loan.
export const ADDITIONAL_PRODUCT_PERCENT = 25;

// EMI of the additional product: the same scheme rules, mode, term and rate, on the value of the goods only.
function additionalEmi(scheme, input, valuePaise, startDate) {
  return calculateLoan({
    principalPaise: valuePaise,
    annualRateBp: Math.round(input.rate * 100),
    calculationType: scheme.calculationType,
    emiType: scheme.calculationType === 'flat' ? 'equal' : scheme.emiType,
    mode: input.mode,
    term: input.term,
    startDate,
    roundingPaise: (scheme.installmentRounding ?? 1) * 100,
  });
}

// Cash in hand = loan amount - security - processing fee - insurance fee.
const cashAfterCharges = (amountPaise, charges) =>
  amountPaise
  - (charges ? Math.round(charges.processingFee * 100) + Math.round(charges.cost * 100) + Math.round(charges.securityAmount * 100) : 0);

/**
 * Validates product(s) a member of a group loan takes on top of the loan. `capFor(memberId)` is how much (paise)
 * that member may still take; each member gets one product here.
 */
async function buildAdditional({ items, members, capFor, scheme, input, loanDate, branchId }) {
  const out = [];
  const used = new Map();
  const seen = new Set();
  for (const a of items) {
    const mid = String(a?.member || '');
    const gm = members.find((x) => String(x._id) === mid);
    if (!gm) throw invalid({ additional: 'An additional product is for a member who is not getting the loan' });
    if (seen.has(mid)) throw invalid({ additional: `${gm.code} has more than one additional product` });
    seen.add(mid);
    if (!mongoose.isValidObjectId(String(a.stockProduct || ''))) throw invalid({ additional: `Select the product for ${gm.code}` });
    const p = await StockProduct.findOne({ _id: a.stockProduct, isDeleted: false, isActive: true, branch: branchId });
    if (!p) throw invalid({ additional: `The product chosen for ${gm.code} is not available in this branch` });
    const qty = Number(a.quantity);
    if (!Number.isInteger(qty) || qty < 1) throw invalid({ additional: `Enter the number of units for ${gm.code}` });
    used.set(String(p._id), (used.get(String(p._id)) || 0) + qty);
    if (used.get(String(p._id)) > p.stockQty) throw invalid({ additional: `Only ${p.stockQty} unit${p.stockQty === 1 ? '' : 's'} of ${p.name} in stock` });
    const valuePaise = p.unitPricePaise * qty;
    const maxPaise = capFor(mid);
    if (valuePaise > maxPaise) {
      throw invalid({ additional: `${gm.code}: the product (₹${valuePaise / 100}) is more than the ${ADDITIONAL_PRODUCT_PERCENT}% of the loan that is allowed (₹${maxPaise / 100})` });
    }
    let e;
    try {
      e = additionalEmi(scheme, input, valuePaise, loanDate);
    } catch (err) {
      throw invalid({ additional: `${gm.code}: ${err.message}` });
    }
    out.push({
      member: gm._id,
      memberCode: gm.code,
      memberName: gm.name,
      product: { code: p.code, name: p.name, unitPricePaise: p.unitPricePaise, quantity: qty },
      valuePaise,
      installmentPaise: e.installmentAmount,
      totalInterestPaise: e.totalInterest,
      totalPayablePaise: e.totalPayable,
    });
  }
  return out;
}

export async function preview(req, res) {
  const r = await evaluateLoan(calcInput(req.body || {}, null));
  const amountPaise = Math.round(r.input.amount * 100);
  // EMI of additional products (values in rupees) under the same scheme, mode, term and rate.
  let extras;
  if (Array.isArray(req.body?.extras) && req.body.extras.length) {
    const scheme = await LoanScheme.findById(r.input.scheme.id);
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    extras = req.body.extras.slice(0, 100).map((v) => {
      const paise = Math.round(Number(v) * 100);
      if (!Number.isFinite(paise) || paise < 100) return { value: Number(v) || 0, error: 'Too small' };
      try {
        const e = additionalEmi(scheme, r.input, paise, today);
        return { value: paise / 100, installmentAmount: rupees(e.installmentAmount), totalInterest: rupees(e.totalInterest), totalPayable: rupees(e.totalPayable) };
      } catch (err) {
        return { value: paise / 100, error: err.message };
      }
    });
  }
  res.json({
    summary: r.summary,
    charges: r.charges,
    input: r.input,
    cash: cashAfterCharges(amountPaise, r.charges) / 100,
    additionalMaxPercent: ADDITIONAL_PRODUCT_PERCENT,
    additionalMax: Math.floor((amountPaise * ADDITIONAL_PRODUCT_PERCENT) / 100) / 100,
    ...(extras ? { extras } : {}),
  });
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
    cash: rupees(r.cashPaise),
    totalCash: r.cashPaise === undefined || r.cashPaise === null ? null : isGroup ? (r.cashPaise * (r.memberCount || 1)) / 100 : r.cashPaise / 100,
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
            gstVerified: Boolean(r.business.gstVerifiedAt),
            udgamNumber: r.business.udgamNumber || '',
            civilScore: r.business.civilScore ?? null,
            shopPhoto: r.business.shopPhoto || null,
            bankStatement: r.business.bankStatement || null,
            itr: r.business.itr || null,
            agreement: r.business.agreement || null,
            udyamCertificate: r.business.udyamCertificate || null,
          }
        : null,
      product: r.product?.name
        ? { code: r.product.code, name: r.product.name, unitPrice: rupees(r.product.unitPricePaise), quantity: r.product.quantity }
        : null,
      civilCheck: r.civilCheck?.score ? { score: r.civilCheck.score, reportDate: dateOnly(r.civilCheck.reportDate), bureau: r.civilCheck.bureau } : null,
      verification: r.verification?.panPresent !== undefined && r.verification?.panPresent !== null ? r.verification : null,
      additionalProducts: (r.additionalProducts || []).map((a) => ({
        memberCode: a.memberCode,
        memberName: a.memberName,
        product: { code: a.product?.code, name: a.product?.name, unitPrice: rupees(a.product?.unitPricePaise), quantity: a.product?.quantity },
        value: rupees(a.valuePaise),
        emi: rupees(a.installmentPaise),
        totalPayable: rupees(a.totalPayablePaise),
      })),
      formFrontPhoto: r.formFrontPhoto || null,
      formBackPhoto: r.formBackPhoto || null,
      memberForms: (r.memberForms || []).map((f) => ({
        memberCode: f.memberCode,
        member: f.member,
        front: f.front || null,
        back: f.back || null,
        topUp: Boolean(f.topUp),
      })),
      previousLoanAmount: rupees(r.previousLoanPaise),
      schemeCode: r.schemeCode,
      rate: r.annualRateBp / 100,
      calculationType: r.calculationType,
      emiType: r.emiType,
      totalInterest: rupees(r.totalInterestPaise),
      totalPayable: rupees(r.totalPayablePaise),
      processingFee: rupees(r.processingFeePaise),
      insuranceFee: rupees(r.insuranceFeePaise ?? 0),
      securityAmount: rupees(r.securityAmountPaise ?? 0),
      securityType: r.securityType || 'none',
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

async function readBusiness(b, errors, member, req) {
  const x = b.business || {};
  const out = {};
  out.loanType = asString(x.loanType);
  if (!['business', 'msme'].includes(out.loanType)) errors.loanType = 'Select Business or MSME';
  out.businessName = asString(x.businessName);
  if (out.businessName.length < 2 || out.businessName.length > 100) errors.businessName = 'Enter the business name';
  // GST number: required for a business loan, optional for MSME. It is checked as a GSTIN (state, check
  // character) and against the borrower's PAN; the GST network confirms the registration when connected.
  out.gstNumber = asString(x.gstNumber).toUpperCase();
  if (out.loanType === 'business' && !out.gstNumber) errors.gstNumber = 'GST number is required for a business loan';
  if (out.gstNumber) {
    const c = checkGstin(out.gstNumber, { pan: member?.pan });
    if (!c.ok) errors.gstNumber = c.message;
    else {
      out.gstStateCode = c.stateCode;
      const v = await verifyGstin(out.gstNumber);
      if (v.status === 'verified') out.gstVerifiedAt = new Date();
      else if (v.status === 'not_found') errors.gstNumber = 'This GST number was not found';
    }
  }
  // The Udgam number belongs to an MSME loan only; a business loan has none.
  out.udgamNumber = out.loanType === 'msme' ? asString(x.udgamNumber).toUpperCase() : '';
  if (out.loanType === 'msme') {
    if (!out.udgamNumber) errors.udgamNumber = 'Udgam number is required for an MSME loan';
    else if (!UDGAM_RE.test(out.udgamNumber)) errors.udgamNumber = 'Enter a valid Udgam number (5 to 30 letters or digits)';
  }
  const score = Number(x.civilScore);
  if (!Number.isInteger(score) || score < 300 || score > 900) errors.civilScore = 'Enter the civil score (300 to 900)';
  else out.civilScore = score;

  out.shopPhoto = typeof x.shopPhoto === 'string' ? x.shopPhoto : '';
  if (!out.shopPhoto) errors.shopPhoto = 'Shop photo is required';
  else if (!IMAGE_RE.test(out.shopPhoto)) errors.shopPhoto = 'Shop photo must be a PNG or JPEG image';
  else if (out.shopPhoto.length > MAX_PHOTO_CHARS) errors.shopPhoto = 'Shop photo is too large';

  const doc = (field, label, required) => {
    const v = typeof x[field] === 'string' ? x[field] : '';
    if (!v) {
      if (required) errors[field] = `Upload the ${label}`;
    } else if (!DOC_RE.test(v)) errors[field] = `${label[0].toUpperCase()}${label.slice(1)} must be a PDF or image`;
    else if (v.length > MAX_DOC_CHARS) errors[field] = `${label[0].toUpperCase()}${label.slice(1)} must be 800 KB or smaller`;
    out[field] = v;
  };
  doc('bankStatement', 'bank statement', true);
  // Documents of the business: income tax return, shop / business agreement, Udyam certificate (needed for MSME).
  doc('itr', 'income tax return (ITR)', false);
  doc('agreement', 'shop / business agreement', false);
  doc('udyamCertificate', 'Udyam certificate', out.loanType === 'msme');

  // The borrower's Aadhaar number is filled in and the borrower confirms with an OTP sent to the mobile registered on the member.
  const aadhaar = asString(x.aadhaarNumber).replace(/\s/g, '');
  if (!/^\d{12}$/.test(aadhaar) || !verhoeff(aadhaar)) errors.aadhaarNumber = 'Enter the 12-digit Aadhaar number';
  else if (member && aadhaar !== member.aadhaar) errors.aadhaarNumber = 'This is not the Aadhaar number of the borrower';
  out.aadhaarMatched = Boolean(member && aadhaar === member.aadhaar);
  out.otpChallenge = member ? await takeVerified(x.otpChallengeId, req.user, 'member_mobile', member.mobile) : null;
  if (!out.otpChallenge) errors.otp = "Verify the OTP sent to the borrower's registered mobile number";
  return out;
}

function checkFormPhoto(value, field, label, errors) {
  if (typeof value !== 'string' || !value) errors[field] = `${label} is required`;
  else if (!IMAGE_RE.test(value)) errors[field] = `${label} must be a PNG or JPEG image`;
  else if (value.length > MAX_PHOTO_CHARS) errors[field] = `${label} is too large`;
  return value;
}

/** Front and back form photo of every member getting a loan. */
function readMemberForms(items, members, errors) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (const m of members) {
    const f = list.find((x) => String(x?.member) === String(m._id)) || {};
    const front = checkFormPhoto(f.front, `memberForms.${m._id}.front`, `Form front photo of ${m.code}`, errors);
    const back = checkFormPhoto(f.back, `memberForms.${m._id}.back`, `Form back photo of ${m.code}`, errors);
    out.push({ member: m._id, memberCode: m.code, front, back });
  }
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
      // The loan goes to the members that were ticked.
      const ids = [...new Set((Array.isArray(b.memberIds) ? b.memberIds : []).map(String))];
      if (!ids.length) throw invalid({ memberIds: 'Select the members who get the loan' });
      const chosen = groupMembers.filter((x) => ids.includes(String(x._id)));
      if (chosen.length !== ids.length) throw invalid({ memberIds: 'A selected member is not in this group' });
      const blocked = chosen.filter((x) => x.isBlocked);
      if (blocked.length) throw new HttpError(409, `Blocked members cannot get a loan: ${blocked.map((x) => x.code).join(', ')}`, { memberIds: 'A selected member is blocked' });
      groupMembers = chosen;
    } else {
      if (!mongoose.isValidObjectId(String(b.member || ''))) throw invalid({ member: 'Select the borrower' });
      m = await Member.findOne({ _id: b.member, isDeleted: false, branch: branchId });
      if (!m) throw invalid({ member: 'Borrower not found in this branch' });
      if (m.isBlocked) throw new HttpError(409, 'This borrower is blocked', { member: 'This borrower is blocked' });
      if (!m.guarantor?.name) throw new HttpError(409, 'The borrower has no guarantor yet', { member: 'Add the guarantor first' });
    }

    // The application form, front and back.
    const formErrors = {};
    const formPhoto = (value, field, label) => checkFormPhoto(value, field, label, formErrors);
    // A group loan has one requisition but each member's loan has its own form: front and back photos per member.
    let formFrontPhoto;
    let formBackPhoto;
    let memberForms;
    if (kind === 'group') {
      memberForms = readMemberForms(b.memberForms, groupMembers, formErrors);
    } else {
      formFrontPhoto = formPhoto(b.formFrontPhoto, 'formFrontPhoto', 'Form front photo');
      formBackPhoto = formPhoto(b.formBackPhoto, 'formBackPhoto', 'Form back photo');
    }
    if (Object.keys(formErrors).length) throw invalid(formErrors);

    // Business / MSME extras
    let business = null;
    let otpCh = null;
    if (kind === 'business') {
      const errors = {};
      business = await readBusiness(b, errors, m, req);
      otpCh = business.otpChallenge;
      delete business.otpChallenge;
      if (!m.pan) {
        throw new HttpError(409, 'The borrower has no PAN. Add the PAN (Borrower Synopsis → Edit details) before a business or MSME loan.', { member: 'The borrower has no PAN' });
      }
      if (Object.keys(errors).length) throw invalid(Object.fromEntries(Object.entries(errors).map(([k, v]) => [`business.${k}`, v])));
    }

    // Product loan: the stock product and the number of units decide the loan amount.
    let product = null;
    if (kind === 'product') {
      if (!mongoose.isValidObjectId(String(b.stockProduct || ''))) throw invalid({ stockProduct: 'Select the product' });
      const p = await StockProduct.findOne({ _id: b.stockProduct, isDeleted: false, isActive: true, branch: branchId });
      if (!p) throw invalid({ stockProduct: 'This product is not available in this branch' });
      const qty = Number(b.quantity);
      if (!Number.isInteger(qty) || qty < 1) throw invalid({ quantity: 'Enter the number of units (1 or more)' });
      if (qty > p.stockQty) throw invalid({ quantity: `Only ${p.stockQty} unit${p.stockQty === 1 ? '' : 's'} in stock` });
      product = { code: p.code, name: p.name, unitPricePaise: p.unitPricePaise, quantity: qty };
      // The amount of the loan is the value of the goods.
      b.amount = String((p.unitPricePaise * qty) / 100);
    }

    // Scheme limits and the EMI come from the shared loan engine.
    if (!mongoose.isValidObjectId(String(b.schemeId || ''))) throw invalid({ schemeId: 'Select a loan scheme' });
    const r = await evaluateLoan(calcInput(b, loanDate));
    const scheme = await LoanScheme.findById(r.input.scheme.id);
    if (!SCHEME_TYPES[kind].includes(scheme.loanType)) throw invalid({ schemeId: `Select a ${KIND_LABEL[kind].toLowerCase()} scheme` });
    if (business && scheme.loanType !== business.loanType) {
      throw invalid({ schemeId: `This scheme is a ${scheme.loanType.toUpperCase()} scheme; choose a ${business.loanType.toUpperCase()} scheme` });
    }
    // The same scheme is not offered again to a member until that loan is finished.
    const sameScheme = { isDeleted: false, scheme: scheme._id, status: { $in: RUNNING } };
    if (m) {
      const running = await LoanRequisition.findOne({ ...sameScheme, $or: [{ member: m._id }, { members: m._id }] }).select('formId');
      if (running) {
        throw new HttpError(409, `This borrower already has a loan under ${scheme.name} (requisition ${running.formId}) which is not finished yet`, {
          schemeId: 'A loan under this scheme is not finished yet',
        });
      }
    }
    if (g) {
      const ids = groupMembers.map((x) => x._id);
      // Within one group a member can have only one loan at a time; a further loan is a product top-up (up to 25%).
      const inGroup = await LoanRequisition.find({ isDeleted: false, kind: 'group', group: g._id, status: { $in: RUNNING }, members: { $in: ids } }).select('formId members');
      const taken = groupMembers.filter((x) => inGroup.some((l) => l.members.some((id) => String(id) === String(x._id))));
      if (taken.length) {
        throw new HttpError(409, `${taken.map((x) => x.code).join(', ')} already ha${taken.length > 1 ? 've' : 's'} a running loan in this group. A member can take only one loan in a group; use "Add product loan" for up to ${ADDITIONAL_PRODUCT_PERCENT}% of that loan.`, {
          memberIds: 'Some selected members already have a loan in this group',
        });
      }
      const busy = await runningSchemes(ids);
      const clash = groupMembers.filter((x) => busy.get(String(x._id))?.has(String(scheme._id)));
      if (clash.length) {
        throw new HttpError(409, `These members already have an unfinished loan under ${scheme.name}: ${clash.map((x) => x.code).join(', ')}`, {
          memberIds: 'Some selected members already have a loan under this scheme',
        });
      }
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
    const cashPaise = cashAfterCharges(amountPaise, r.charges);
    if (cashPaise <= 0) {
      throw invalid({ amount: 'The security, processing fee and insurance fee are more than the loan amount' });
    }
    // Group loan: optional product(s) on top of the loan, each up to 25% of the loan amount.
    let additionalProducts = [];
    if (kind === 'group' && Array.isArray(b.additional) && b.additional.length) {
      const maxPaise = Math.floor((amountPaise * ADDITIONAL_PRODUCT_PERCENT) / 100);
      additionalProducts = await buildAdditional({ items: b.additional, members: groupMembers, capFor: () => maxPaise, scheme, input: r.input, loanDate, branchId });
    }

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
            members: groupMembers.map((x) => x._id),
            memberCount,
            totalAmountPaise: amountPaise * memberCount,
          }
        : {}),
      ...(business ? { business } : {}),
      ...(additionalProducts.length ? { additionalProducts } : {}),
      ...(product ? { product } : {}),
      ...(m ? await civilFor(m._id) : {}),
      ...(business
        ? {
            verification: {
              panPresent: true,
              panFormatOk: checkPanFormat(m.pan).ok,
              panVerified: Boolean(m.panVerifiedAt),
              // The Aadhaar OTP check needs a licensed KYC service; it is recorded as not done until one is connected.
              aadhaarOtp: 'not_available',
              aadhaarMatched: Boolean(business.aadhaarMatched),
              otpVerifiedAt: otpCh?.verifiedAt,
            },
          }
        : {}),
      ...(kind === 'group' ? { memberForms } : { formFrontPhoto, formBackPhoto }),
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
      insuranceFeePaise: r.charges ? Math.round(r.charges.cost * 100) : 0,
      securityAmountPaise: r.charges ? Math.round(r.charges.securityAmount * 100) : 0,
      cashPaise,
      securityType: r.charges?.securityType || 'none',
      employeeCode,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    if (otpCh) await consumeChallenge(otpCh);
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

/** Removes a requisition that has not been approved. */
export async function deleteRequisition(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Requisition not found');
  const r = await LoanRequisition.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) });
  if (!r) throw new HttpError(404, 'Requisition not found');
  if (r.status === 'approved') {
    throw new HttpError(409, 'An approved requisition cannot be deleted.');
  }
  r.isDeleted = true;
  r.updatedBy = req.user._id;
  await r.save();
  await audit(req, {
    action: 'loanRequisition.delete',
    entity: 'LoanRequisition',
    entityId: r._id,
    after: { formId: r.formId, status: r.status, for: r.borrower?.code || r.groupInfo?.code },
  });
  res.json({ message: 'Requisition deleted' });
}

/** Live check of a GST number while the form is filled in (optionally against the borrower's PAN). */
export async function gstCheck(req, res) {
  const gstin = asString(req.params.gstin).toUpperCase();
  let pan;
  if (mongoose.isValidObjectId(req.query.member)) {
    const m = await Member.findOne({ _id: req.query.member, isDeleted: false, ...branchFilter(req.user) }).select('pan');
    pan = m?.pan;
  }
  const c = checkGstin(gstin, { pan });
  if (!c.ok) return res.json({ ok: false, message: c.message });
  const v = await verifyGstin(gstin);
  res.json({ ok: true, stateCode: c.stateCode, pan: c.pan, panMatched: Boolean(pan), registryChecked: v.status === 'verified' });
}

export async function getRequisition(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Requisition not found');
  const r = await LoanRequisition.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) })
    .select('+business.shopPhoto +business.bankStatement +business.itr +business.agreement +business.udyamCertificate +formFrontPhoto +formBackPhoto +memberForms.front +memberForms.back')
    .populate(POPULATE);
  if (!r) throw new HttpError(404, 'Requisition not found');
  res.json({ requisition: present(r, req.user, { detail: true }) });
}

/** OTP to the mobile registered on the borrower (the Aadhaar / consent check of a business loan). */
export async function borrowerOtp(req, res) {
  if (!mongoose.isValidObjectId(String(req.body?.member || ''))) throw invalid({ member: 'Select the borrower' });
  const m = await Member.findOne({ _id: req.body.member, isDeleted: false, ...branchFilter(req.user) }).select('mobile name');
  if (!m) throw new HttpError(404, 'Borrower not found');
  const { challenge, otp } = await issueOtp({ user: req.user, purpose: 'member_mobile', subject: m.mobile, sentTo: m.mobile });
  const sms = await sendSms({ to: m.mobile, text: `Udgam Microfinance: OTP ${otp} to confirm your Aadhaar for a loan. Valid for 5 minutes. Do not share this OTP.` });
  res.json({
    challengeId: challenge._id,
    sentTo: maskMobile(m.mobile),
    expiresAt: challenge.expiresAt,
    ...(sms.dev && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
  });
}

/**
 * Product top-up on a running group loan: a member who already has a loan in the group may take goods worth up to
 * 25% of that loan (in all). Each member's form (front and back) is uploaded with it.
 */
export async function addGroupTopUp(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Requisition not found');
  const r = await LoanRequisition.findOne({ _id: req.params.id, isDeleted: false, kind: 'group', ...branchFilter(req.user) });
  if (!r) throw new HttpError(404, 'Group loan not found');
  if (!RUNNING.includes(r.status)) throw new HttpError(409, 'This loan is not running');
  const b = req.body || {};
  const items = Array.isArray(b.additional) ? b.additional : [];
  if (!items.length) throw invalid({ additional: 'Choose a product for at least one member' });

  const g = await Group.findOne({ _id: r.group, isDeleted: false }).populate('members.member', 'code name isBlocked');
  const loanMembers = (g?.members || []).filter((x) => x.member && r.members.some((id) => String(id) === String(x.member._id))).map((x) => x.member);
  const blocked = loanMembers.filter((x) => items.some((a) => String(a?.member) === String(x._id)) && x.isBlocked);
  if (blocked.length) throw new HttpError(409, `Blocked members cannot get a product: ${blocked.map((x) => x.code).join(', ')}`);

  const maxPaise = Math.floor((r.amountPaise * ADDITIONAL_PRODUCT_PERCENT) / 100);
  const usedBy = (mid) => (r.additionalProducts || []).filter((a) => String(a.member) === String(mid)).reduce((s, a) => s + a.valuePaise, 0);
  const scheme = await LoanScheme.findById(r.scheme);
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const added = await buildAdditional({
    items,
    members: loanMembers,
    capFor: (mid) => Math.max(maxPaise - usedBy(mid), 0),
    scheme,
    input: { rate: r.annualRateBp / 100, mode: r.mode, term: r.term },
    loanDate: today,
    branchId: r.branch,
  });

  const formErrors = {};
  const forms = readMemberForms(b.memberForms, added.map((a) => ({ _id: a.member, code: a.memberCode })), formErrors);
  if (Object.keys(formErrors).length) throw invalid(formErrors);

  r.additionalProducts.push(...added);
  r.memberForms.push(...forms.map((f) => ({ ...f, topUp: true, addedAt: new Date() })));
  r.updatedBy = req.user._id;
  await r.save();
  await audit(req, {
    action: 'loanRequisition.topUp',
    entity: 'LoanRequisition',
    entityId: r._id,
    after: { formId: r.formId, members: added.map((a) => a.memberCode), value: added.reduce((s, a) => s + a.valuePaise, 0) / 100 },
  });
  await r.populate(POPULATE);
  res.status(201).json({ requisition: present(r, req.user, { detail: true }) });
}

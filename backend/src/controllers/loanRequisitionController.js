import mongoose from 'mongoose';
import { LoanRequisition, REQUISITION_KINDS } from '../models/LoanRequisition.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { LoanScheme } from '../models/LoanScheme.js';
import { Member } from '../models/Member.js';
import { Group } from '../models/Group.js';
import { User } from '../models/User.js';
import { generateCode } from '../services/codeSequence.js';
import { MODES, calculateLoan } from '../services/loanCalculator.js';
import { evaluateLoan } from './loanCalculatorController.js';
import { borrowerState } from './emiController.js';
import { missingDetails } from '../utils/memberDetails.js';
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
import { notifyApprovers } from '../services/notify.js';
import { blockedCodes } from '../services/blockedStaff.js';

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
  civilRequired: Boolean(s.civilRequired),
  minCivilScore: s.minCivilScore ?? null,
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
    aadhaar: { present: Boolean(m.aadhaar), masked: m.aadhaar ? `XXXX XXXX ${String(m.aadhaar).slice(-4)}` : '', otpServiceConnected: kycProviderConfigured() },
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
/**
 * Of these requisitions, the loans that are still unfinished. An approved loan that was paid out is finished for a member once it is
 * settled (loan or death settlement) or all its installments are paid; that member then no longer counts as having a running loan.
 * Returns plain copies whose member list holds only the members whose loan is still open.
 */
async function unfinishedRows(rows) {
  const paid = rows.filter((r) => r.status === 'approved' && r.disbursedAt);
  const closed = new Map();
  if (paid.length) {
    const pays = await LoanPayment.find({ requisition: { $in: paid.map((r) => r._id) }, status: 'paid' });
    const asOf = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    for (const p of pays) {
      const done = new Set();
      for (const line of p.lines) {
        // eslint-disable-next-line no-await-in-loop
        const st = await borrowerState(p, line, asOf);
        if (st.settled || !st.left.length) done.add(String(line.member));
      }
      closed.set(String(p.requisition), done);
    }
  }
  const out = [];
  for (const r of rows) {
    const done = closed.get(String(r._id));
    const o = typeof r.toObject === 'function' ? r.toObject() : { ...r };
    if (done) {
      if (o.member && done.has(String(o.member))) o.member = undefined;
      o.members = (o.members || []).filter((id) => !done.has(String(id)));
      if (!o.member && !(o.members || []).length) continue; // every borrower of this loan is done
    }
    out.push(o);
  }
  return out;
}

async function runningSchemes(memberIds) {
  const rows = await unfinishedRows(await LoanRequisition.find({
    isDeleted: false,
    status: { $in: RUNNING },
    $or: [{ member: { $in: memberIds } }, { members: { $in: memberIds } }],
  }).select('member members scheme status disbursedAt'));
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

/**
 * A scheme with "Civil required" needs the civil score of the borrower, at least the minimum of the scheme.
 * The score comes strictly from the actual CivilCheck on record for the member (not manually entered on requisition).
 */
async function civilGate({ scheme, member }) {
  const latest = member?._id ? await civilSnapshot(member._id) : null;
  if (!scheme.civilRequired) return { skip: true, score: latest?.score ?? null };
  const score = latest?.score ?? null;
  if (score === null || score === undefined) {
    return { error: `${scheme.name} needs the civil score of ${member?.code || 'borrower'}. No civil check on record; complete the Civil Check first.` };
  }
  if (!Number.isInteger(score) || score < 300 || score > 900) {
    return { error: `The civil score (${score}) of ${member?.code || 'borrower'} is invalid (300 to 900). Please re-check under Civil Check.` };
  }
  if (scheme.minCivilScore && score < scheme.minCivilScore) {
    return { error: `The actual civil score ${score} of ${member?.code || 'borrower'} is below the ${scheme.minCivilScore} that ${scheme.name} needs` };
  }
  return { score, record: false };
}

/** No civil score entered on a loan requisition is recorded as a fake bureau report. Scores must come from Civil Check. */
async function recordCivil() {
  // Scores come strictly from actual CivilCheck records; no-op.
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
  issues.push(...notReady(m));
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

// What a member needs before a loan can be asked for.
const MEMBER_PICK = 'code name isBlocked joiningApproval kycKeys kycDocs nominee.name nominee.sameAsGuarantor guarantor.name guarantor.aadhaar guarantor.deceasedOn legacyImport pan mobile mobileVerifiedAt husbandName occupation education address pincode district aadhaar bankName ifsc accountNumber';
export function notReady(m) {
  const out = [];
  // a member registered in the app is not a member until the admin approves the joining
  if (m.joiningApproval?.status === 'pending') out.push('The joining of this member (registered in the app) is waiting for approval (App Section → Member Joining Approval)');
  if (m.joiningApproval?.status === 'rejected') out.push('The joining of this member was rejected');
  // a member imported from the old system has to complete the details that were missing (mobile verified with an OTP, bank, photos ...)
  const todo = missingDetails(m);
  if (todo.length) out.push(`Complete the member's missing details first (Member Details → Borrower Synopsis → Complete details): ${todo.map((d) => d.label).join(', ')}`);
  if (!m.guarantor?.name) out.push('Add the guarantor first (Member Details → Guarantor & Nominee)');
  else if (m.guarantor.deceasedOn) out.push('The guarantor has died. Change the guarantor first (Member Details → Guarantor & Nominee) before a new loan requisition');
  if (!m.nominee?.name) out.push('Add the nominee first (Member Details → Guarantor & Nominee)');
  // every uploaded document has to be approved (a nominee copied from the guarantor is covered by the guarantor's documents)
  const keys = (m.kycKeys || []).filter((k) => !(k.startsWith('nominee.') && m.nominee?.sameAsGuarantor));
  const state = new Map((m.kycDocs || []).map((d) => [d.key, d.status]));
  const rejected = keys.filter((k) => state.get(k) === 'rejected').length;
  const pending = keys.filter((k) => !state.get(k) || state.get(k) === 'pending').length;
  if (rejected || pending) {
    out.push(`Documents are not verified (${[rejected ? `${rejected} rejected` : '', pending ? `${pending} pending approval` : ''].filter(Boolean).join(', ')}). They must be approved under KYC Approval; rejected ones are uploaded again under KYC Re-upload`);
  }
  return out;
}

async function loadGroup(req, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Group not found');
  const g = await Group.findOne({ _id: id, isDeleted: false, ...branchFilter(req.user) }).populate('members.member', MEMBER_PICK);
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
  // the last loan amount and the newest civil score of each member
  const prevLoans = new Map();
  const civil = new Map();
  await Promise.all(members.map(async (m) => {
    prevLoans.set(String(m._id), await previousLoanPaise(m._id));
    const cs = await civilSnapshot(m._id);
    if (cs) civil.set(String(m._id), cs.score);
  }));
  const groupLoans = await unfinishedRows(await LoanRequisition.find({ isDeleted: false, kind: 'group', group: g._id, status: { $in: RUNNING }, members: { $in: ids } })
    .select('formId members amountPaise additionalProducts schemeName mode term annualRateBp status disbursedAt'));
  const loanOf = (mid) => {
    const l = groupLoans.find((x) => x.members.some((id) => String(id) === String(mid)));
    if (!l) return null;
    const used = (l.additionalProducts || []).filter((a) => String(a.member) === String(mid)).reduce((s, a) => s + a.valuePaise, 0);
    const max = Math.floor((l.amountPaise * ADDITIONAL_PRODUCT_PERCENT) / 100);
    return { requisitionId: l._id, formId: l.formId, schemeName: l.schemeName, mode: l.mode, term: l.term, rate: l.annualRateBp / 100, amount: l.amountPaise / 100, topUpUsed: used / 100, topUpMax: max / 100, topUpLeft: Math.max(max - used, 0) / 100 };
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
        // why this member cannot be given a loan yet (documents, guarantor, nominee)
        issues: notReady(m),
        // shown with the member's loan on the group form
        guarantorName: m.guarantor?.name || '',
        previousLoan: rupees(prevLoans.get(String(m._id)) || 0),
        civilScore: civil.get(String(m._id)) ?? null,
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

// A daily group has daily loans, a weekly group weekly loans and a monthly group monthly loans.
const MODE_NAME = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' };
const groupModeError = (meetingType, mode) => (MODE_NAME[meetingType] && mode !== meetingType ? `This is a ${meetingType} group: its loans are ${meetingType} only` : '');

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

/**
 * The product a member takes on top of a group loan is financed under a product loan scheme the user chooses. It is repaid with the
 * installments of the loan, so it uses the loan's mode and number of installments; the rate is the loan's, kept within the scheme's range.
 */
async function productLoanEmi({ schemeId, valuePaise, mode, term, rate, loanDate, code }) {
  const who = code ? `${code}: ` : '';
  if (!mongoose.isValidObjectId(String(schemeId || ''))) throw invalid({ additional: `Select the product loan scheme${code ? ` for ${code}` : ''}` });
  const scheme = await LoanScheme.findOne({ _id: schemeId, isDeleted: false });
  if (!scheme || !scheme.isActive || !SCHEME_TYPES.product.includes(scheme.loanType)) throw invalid({ additional: `${who}select an active product loan scheme` });
  // The scheme decides the amount range and the rate range. The product is repaid with the installments of the loan, so its mode and
  // number of installments are the loan's (a product scheme made for other modes can still be used for it).
  // A product on top of a loan is limited by the 25% of the loan (checked by the caller), so the scheme's minimum amount does not apply: a ₹200 product
  // is fine when 25% of the loan is ₹250. The scheme's top limit still does.
  if (valuePaise > scheme.amountMaxPaise) {
    throw invalid({ additional: `${who}${scheme.name} allows a product value up to ₹${scheme.amountMaxPaise / 100}; this one is ₹${valuePaise / 100}` });
  }
  const rateBp = Math.min(Math.max(Math.round(Number(rate) * 100), scheme.roiMinBp), scheme.roiMaxBp);
  let c;
  try {
    c = calculateLoan({
      principalPaise: valuePaise, annualRateBp: rateBp, calculationType: scheme.calculationType, emiType: scheme.calculationType === 'flat' ? 'equal' : scheme.emiType,
      mode, term: Number(term), startDate: loanDate ? new Date(loanDate) : new Date(), roundingPaise: (scheme.installmentRounding ?? 1) * 100,
    });
  } catch (err) {
    if (err instanceof RangeError) throw invalid({ additional: `${who}${err.message}` });
    throw err;
  }
  return { scheme, rateBp, installmentPaise: c.installmentAmount, totalInterestPaise: c.totalInterest, totalPayablePaise: c.totalPayable, installments: c.installments };
}

/** The EMI of a product taken on top of a loan under a product loan scheme (for the screens, before anything is saved). */
export async function productLoanPreview(req, res) {
  const b = req.body || {};
  const valuePaise = Math.round(Number(b.value) * 100);
  if (!Number.isFinite(valuePaise) || valuePaise < 100) throw invalid({ additional: 'Choose the product first' });
  const e = await productLoanEmi({ schemeId: b.schemeId, valuePaise, mode: String(b.mode || ''), term: b.term, rate: b.rate, loanDate: null, code: '' });
  res.json({ schemeName: e.scheme.name, rate: e.rateBp / 100, installments: e.installments, installmentAmount: e.installmentPaise / 100, totalInterest: e.totalInterestPaise / 100, totalPayable: e.totalPayablePaise / 100 });
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
      throw invalid({ additional: `${gm.code}: product value (₹${valuePaise / 100}) exceeds the ${ADDITIONAL_PRODUCT_PERCENT}% limit of ₹${maxPaise / 100}. Requisition cannot be created.` });
    }
    const e = await productLoanEmi({ schemeId: a.schemeId, valuePaise, mode: input.mode, term: input.term, rate: input.rate, loanDate, code: gm.code });
    out.push({
      productId: p._id,
      member: gm._id,
      memberCode: gm.code,
      memberName: gm.name,
      product: { code: p.code, name: p.name, unitPricePaise: p.unitPricePaise, quantity: qty },
      valuePaise,
      scheme: e.scheme._id,
      schemeName: e.scheme.name,
      annualRateBp: e.rateBp,
      installmentPaise: e.installmentPaise,
      totalInterestPaise: e.totalInterestPaise,
      totalPayablePaise: e.totalPayablePaise,
    });
  }
  return out;
}

/** Takes units out of stock (a product was sold). All or nothing: when one line is short, what was taken is put back. */
export async function reserveStock(lines) {
  const done = [];
  try {
    for (const l of lines) {
      // eslint-disable-next-line no-await-in-loop
      const res = await StockProduct.updateOne({ _id: l.id, isDeleted: false, stockQty: { $gte: l.qty } }, { $inc: { stockQty: -l.qty } });
      if (!res.modifiedCount) throw new HttpError(409, `Not enough stock of ${l.name}`, { stockProduct: `Not enough stock of ${l.name}` });
      done.push(l);
    }
  } catch (err) {
    await releaseStock(done);
    throw err;
  }
  return done;
}
export const releaseStock = (lines) => Promise.all(lines.map((l) => StockProduct.updateOne({ _id: l.id }, { $inc: { stockQty: l.qty } })));

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
    batchId: r.batchId || null,
    batchFormId: r.batchFormId || '',
    batchCount: r.batchCount || 0,
    formId: r.formId,
    branch: r.branch?._id ? { id: r.branch._id, code: r.branch.code, name: r.branch.name } : null,
    loanDate: dateOnly(r.loanDate),
    // The "who": the borrower, or the group for a group loan.
    subjectCode: isGroup ? r.groupInfo?.code : r.borrower?.code,
    subjectName: isGroup ? r.groupInfo?.name : r.borrower?.name,
    // the member(s) of the loan: the borrower, or every member of the group (code and name)
    members: isGroup ? (r.groupInfo?.members || []).map((x) => ({ code: x.code, name: x.name })) : r.borrower?.code ? [{ code: r.borrower.code, name: r.borrower.name }] : [],
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
    schemeId: r.scheme?._id || r.scheme,
    rate: r.annualRateBp / 100,
    requestedAmount: r.requestedAmountPaise ? rupees(r.requestedAmountPaise) : null,
    requestedSchemeName: r.requestedSchemeName || '',
    decidedAt: r.decidedAt || null,
    decidedByCode: r.decidedByCode || '',
    rejectReason: r.rejectReason || '',
    disbursedAt: r.disbursedAt || null,
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
            shopPhotos: (r.business.shopPhotos && r.business.shopPhotos.length ? r.business.shopPhotos : r.business.shopPhoto ? [r.business.shopPhoto] : []),
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
        schemeName: a.schemeName || '',
        rate: a.annualRateBp ? a.annualRateBp / 100 : null,
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
// Udyam number: letters, digits, hyphen or slash (no fixed format is assumed).
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
  // GST number: required for a business loan and for an MSME loan. It is checked as a GSTIN (state, check
  // character) and against the borrower's PAN; the GST network confirms the registration when connected.
  out.gstNumber = asString(x.gstNumber).toUpperCase();
  if (!out.gstNumber) errors.gstNumber = 'GST number is required for a business / MSME loan';
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
  // The Udyam number belongs to an MSME loan only; a business loan has none.
  out.udgamNumber = out.loanType === 'msme' ? asString(x.udgamNumber).toUpperCase() : '';
  if (out.loanType === 'msme') {
    if (!out.udgamNumber) errors.udgamNumber = 'Udyam number is required for an MSME loan';
    else if (!UDGAM_RE.test(out.udgamNumber)) errors.udgamNumber = 'Enter a valid Udyam number (5 to 30 letters or digits)';
  }
  const latest = member?._id ? await civilSnapshot(member._id) : null;
  const score = latest?.score ?? null;
  if (score === null || score === undefined) {
    errors.civilScore = 'No civil check on record for this borrower. Please complete the Civil Check first.';
  } else if (!Number.isInteger(score) || score < 300 || score > 900) {
    errors.civilScore = `The civil score (${score}) is invalid (300 to 900)`;
  } else {
    out.civilScore = score;
  }

  // three photos of the shop are needed (the first one is also kept as the shop photo of the older screens)
  const shots = Array.isArray(x.shopPhotos) ? x.shopPhotos.map((p) => (typeof p === 'string' ? p : '')) : [typeof x.shopPhoto === 'string' ? x.shopPhoto : ''];
  out.shopPhotos = shots.slice(0, 3);
  if (shots.filter(Boolean).length < 3) errors.shopPhoto = 'Upload 3 photos of the shop';
  else if (out.shopPhotos.some((p) => !IMAGE_RE.test(p))) errors.shopPhoto = 'The shop photos must be PNG or JPEG images';
  else if (out.shopPhotos.some((p) => p.length > MAX_PHOTO_CHARS)) errors.shopPhoto = 'A shop photo is too large';
  out.shopPhoto = out.shopPhotos[0] || '';

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
  // The Aadhaar number is the one filled in at registration (fetched from the member record, never typed here).
  out.aadhaarMatched = Boolean(member?.aadhaar);
  if (!member?.aadhaar) errors.aadhaarNumber = 'The borrower has no Aadhaar number on record';
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

    // Loan date: every loan requisition (personal, product, business / MSME, group) is made for today only (no back date).
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const loanDate = today;
    if (b.loanDate !== undefined && b.loanDate !== null && String(b.loanDate).trim() !== '') {
      const d = parseDateOnly(asString(b.loanDate));
      if (!d || d.getTime() !== today.getTime()) throw invalid({ loanDate: 'A loan requisition is made for today only (no back date)' });
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
      const reasons = notReady(m);
      if (reasons.length) throw new HttpError(409, `${m.code} is not ready for a loan: ${reasons.join('; ')}`, { member: reasons[0] });
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
    let productId = null;
    if (kind === 'product') {
      if (!mongoose.isValidObjectId(String(b.stockProduct || ''))) throw invalid({ stockProduct: 'Select the product' });
      const p = await StockProduct.findOne({ _id: b.stockProduct, isDeleted: false, isActive: true, branch: branchId });
      if (!p) throw invalid({ stockProduct: 'This product is not available in this branch' });
      const qty = Number(b.quantity);
      if (!Number.isInteger(qty) || qty < 1) throw invalid({ quantity: 'Enter the number of units (1 or more)' });
      if (qty > p.stockQty) throw invalid({ quantity: `Only ${p.stockQty} unit${p.stockQty === 1 ? '' : 's'} in stock` });
      product = { code: p.code, name: p.name, unitPricePaise: p.unitPricePaise, quantity: qty };
      productId = p._id;
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
    // the scheme may ask for a civil score
    const civilGateResult = await civilGate({ scheme, member: m });
    if (civilGateResult.error) throw invalid(business ? { 'business.civilScore': civilGateResult.error } : { civilScore: civilGateResult.error });
    // The same scheme is not offered again to a member until that loan is finished.
    const sameScheme = { isDeleted: false, scheme: scheme._id, status: { $in: RUNNING } };
    if (m) {
      const running = (await unfinishedRows(await LoanRequisition.find({ ...sameScheme, $or: [{ member: m._id }, { members: m._id }] }).select('formId member members status disbursedAt')))[0];
      if (running) {
        throw new HttpError(409, `This borrower already has a loan under ${scheme.name} (requisition ${running.formId}) which is not finished yet`, {
          schemeId: 'A loan under this scheme is not finished yet',
        });
      }
    }
    if (g) {
      const ids = groupMembers.map((x) => x._id);
      // Within one group a member can have only one loan at a time; a further loan is a product top-up (up to 25%).
      const inGroup = await unfinishedRows(await LoanRequisition.find({ isDeleted: false, kind: 'group', group: g._id, status: { $in: RUNNING }, members: { $in: ids } }).select('formId members status disbursedAt'));
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
      const emp = await User.findOne({ employeeCode: { $eq: employeeCode, $nin: await blockedCodes() }, $or: [{ isActive: true }, { legacyImport: true }] }).select('role branches'); // an employee from the old system can be named too
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
    // The product is sold with the requisition, so its units leave the branch stock now.
    const reserved = await reserveStock([
      ...(product ? [{ id: productId, qty: product.quantity, name: product.name }] : []),
      ...additionalProducts.map((a) => ({ id: a.productId, qty: a.product.quantity, name: a.product.name })),
    ]);
    let doc;
    try {
    doc = await LoanRequisition.create({
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
    } catch (err) {
      await releaseStock(reserved);
      throw err;
    }
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
    notifyApprovers({ branch: doc.branch._id || doc.branch, exceptUser: req.user._id, includeManagers: kind !== 'business', title: 'New loan requisition', message: `${KIND_LABEL[kind] || 'Loan'} requisition ${doc.formId} for ${m ? `${m.code} ${m.name}` : `${g.code} ${g.name}`}: ₹${r.input.amount}. It waits for approval.` });
    res.status(201).json({ requisition: present(doc, req.user, { detail: true }) });
  };
}

export async function listRequisitions(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { isDeleted: false, ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const status = asString(req.query.status);
  if (['pending', 'approved', 'rejected', 'cancelled'].includes(status)) filter.status = status;
  if (mongoose.isValidObjectId(req.query.group)) filter.group = req.query.group;
  if (mongoose.isValidObjectId(req.query.batchId)) filter.batchId = req.query.batchId;
  // Loans waiting for their payment (approved, not yet paid) or already paid.
  if (req.query.disbursed === 'no') filter.disbursedAt = { $exists: false };
  else if (req.query.disbursed === 'yes') filter.disbursedAt = { $exists: true };
  const kind = asString(req.query.kind);
  if (kind === 'personal') filter.kind = { $in: ['personal', null] };
  else if (REQUISITION_KINDS.includes(kind)) filter.kind = kind;
  // Pending Loans: the business / MSME loans have their own approval page (the admin decides them with all their documents)
  else if (asString(req.query.exclude) === 'business') filter.kind = { $ne: 'business' };
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
    filter.$or = [{ formId: rx }, { 'borrower.code': rx }, { 'borrower.name': rx }, { 'groupInfo.code': rx }, { 'groupInfo.name': rx }, { 'groupInfo.members.name': rx }, { 'groupInfo.members.code': rx }];
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
  // The sale is undone, so the units go back into stock (a rejected requisition has already returned them).
  const back = r.status !== 'pending' ? [] : [
    ...(r.product?.code ? [{ code: r.product.code, qty: r.product.quantity }] : []),
    ...(r.additionalProducts || []).map((a) => ({ code: a.product?.code, qty: a.product?.quantity })),
  ].filter((x) => x.code && x.qty > 0);
  await Promise.all(back.map((x) => StockProduct.updateOne({ code: x.code }, { $inc: { stockQty: x.qty } })));
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
    .select('+business.shopPhoto +business.shopPhotos +business.bankStatement +business.itr +business.agreement +business.udyamCertificate +formFrontPhoto +formBackPhoto +memberForms.front +memberForms.back')
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
  if (!RUNNING.includes(r.status) || !(await unfinishedRows([r])).length) throw new HttpError(409, 'This loan is not running');
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

  const reserved = await reserveStock(added.map((a) => ({ id: a.productId, qty: a.product.quantity, name: a.product.name })));
  r.additionalProducts.push(...added);
  r.memberForms.push(...forms.map((f) => ({ ...f, topUp: true, addedAt: new Date() })));
  r.updatedBy = req.user._id;
  try {
    await r.save();
  } catch (err) {
    await releaseStock(reserved);
    throw err;
  }
  await audit(req, {
    action: 'loanRequisition.topUp',
    entity: 'LoanRequisition',
    entityId: r._id,
    after: { formId: r.formId, members: added.map((a) => a.memberCode), value: added.reduce((s, a) => s + a.valuePaise, 0) / 100 },
  });
  await r.populate(POPULATE);
  res.status(201).json({ requisition: present(r, req.user, { detail: true }) });
}

// ---- loan approval (branch manager / admin) --------------------------------------------------------------------
async function loadForDecision(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Requisition not found');
  const r = await LoanRequisition.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) });
  if (!r) throw new HttpError(404, 'Requisition not found');
  if (r.status !== 'pending') throw new HttpError(409, `This requisition is already ${r.status}`);
  // a business / MSME loan is a bigger loan: only the admin approves or rejects it
  if (r.kind === 'business' && !isAdmin(req.user)) throw new HttpError(403, 'A business / MSME loan is approved or rejected by the admin only.');
  return r;
}

/**
 * Approves a pending requisition. The loan amount can be edited first (not for a product loan, whose amount is the
 * value of the goods): the EMI, charges and cash are worked out again with the scheme's rules.
 */
async function applyApproval(req, r, b) {
  const kind = r.kind || 'personal';
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
  // What the branch manager may change before approving: the scheme and, with it, amount, mode, installments and rate.
  const schemeId = has(b.schemeId) ? String(b.schemeId) : String(r.scheme);
  const mode = has(b.mode) ? String(b.mode) : r.mode;
  if (kind === 'group') {
    const modeError = groupModeError(r.groupInfo?.meetingType, mode);
    if (modeError) throw invalid({ mode: modeError });
  }
  const term = has(b.term) ? Number(b.term) : r.term;
  const rateStr = has(b.rate) ? String(b.rate) : String(r.annualRateBp / 100);
  const target = has(b.amount) ? Math.round(Number(b.amount) * 100) : r.amountPaise;
  if (!Number.isFinite(target) || target < 100) throw invalid({ amount: 'Enter a valid loan amount' });
  if (!Number.isInteger(term) || term < 1) throw invalid({ term: 'Enter the number of installments' });
  const schemeChanged = schemeId !== String(r.scheme);
  const changed = target !== r.amountPaise || schemeChanged || mode !== r.mode || term !== r.term || Math.round(Number(rateStr) * 100) !== r.annualRateBp;

  if (changed) {
    if (kind === 'product' && target !== r.amountPaise) throw invalid({ amount: 'The amount of a product loan is the value of the goods and cannot be edited' });
    const ev = await evaluateLoan({ schemeId, amount: String(target / 100), rate: rateStr, mode, term, startDate: dateOnly(r.loanDate) });
    const scheme = await LoanScheme.findById(ev.input.scheme.id);
    if (!SCHEME_TYPES[kind].includes(scheme.loanType)) throw invalid({ schemeId: `Select a ${KIND_LABEL[kind].toLowerCase()} scheme` });
    if (kind === 'business' && r.business?.loanType && scheme.loanType !== r.business.loanType) {
      throw invalid({ schemeId: `This is a ${r.business.loanType.toUpperCase()} loan; choose a ${r.business.loanType.toUpperCase()} scheme` });
    }
    if (schemeChanged) {
      // The borrower(s) must not already have an unfinished loan in the new scheme.
      const clash = (await unfinishedRows(await LoanRequisition.find({
        isDeleted: false, scheme: scheme._id, status: { $in: RUNNING }, _id: { $ne: r._id }, $or: [{ member: { $in: [r.member, ...(r.members || [])].filter(Boolean) } }, { members: { $in: [r.member, ...(r.members || [])].filter(Boolean) } }],
      }).select('formId member members status disbursedAt')))[0];
      if (clash) throw new HttpError(409, `The borrower already has a loan under ${scheme.name} (requisition ${clash.formId}) which is not finished yet`, { schemeId: 'A loan under this scheme is not finished yet' });
      if (r.member && r.borrower?.dob) {
        const age = ageOn(new Date(r.borrower.dob), new Date(r.loanDate));
        if (age < scheme.ageMin || age > scheme.ageMax) throw invalid({ schemeId: `${scheme.name} is for ages ${scheme.ageMin} to ${scheme.ageMax}; the borrower is ${age}` });
      }
    }
    const cash = cashAfterCharges(target, ev.charges);
    if (cash <= 0) throw invalid({ amount: 'The security, processing fee and insurance fee are more than the loan amount' });
    // A product taken on top of a group loan stays within 25% of the (new) loan.
    if (kind === 'group') {
      const cap = Math.floor((target * ADDITIONAL_PRODUCT_PERCENT) / 100);
      const over = (r.additionalProducts || []).filter((x) => (r.additionalProducts || []).filter((y) => String(y.member) === String(x.member)).reduce((sum, y) => sum + y.valuePaise, 0) > cap);
      if (over.length) throw invalid({ amount: `With this amount a member's product (${over[0].memberCode}) is more than ${ADDITIONAL_PRODUCT_PERCENT}% of the loan (₹${cap / 100}). Use a higher amount.` });
    }
    if (target !== r.amountPaise && !r.requestedAmountPaise) r.requestedAmountPaise = r.amountPaise;
    if (schemeChanged && !r.requestedSchemeName) r.requestedSchemeName = r.schemeName;
    r.scheme = scheme._id;
    r.schemeCode = scheme.code;
    r.schemeName = scheme.name;
    r.amountPaise = target;
    r.mode = ev.input.mode;
    r.term = ev.input.term;
    r.annualRateBp = Math.round(ev.input.rate * 100);
    r.calculationType = ev.input.calculationType;
    r.emiType = ev.input.emiType;
    r.installmentPaise = Math.round(ev.summary.installmentAmount * 100);
    r.totalInterestPaise = Math.round(ev.summary.totalInterest * 100);
    r.totalPayablePaise = Math.round(ev.summary.totalPayable * 100);
    r.processingFeePaise = ev.charges ? Math.round(ev.charges.processingFee * 100) : 0;
    r.insuranceFeePaise = ev.charges ? Math.round(ev.charges.cost * 100) : 0;
    r.securityAmountPaise = ev.charges ? Math.round(ev.charges.securityAmount * 100) : 0;
    r.securityType = ev.charges?.securityType || 'none';
    r.cashPaise = cash;
    if (kind === 'group') r.totalAmountPaise = target * (r.memberCount || r.members.length);
    // The EMI of a product on top of a group loan follows the scheme, mode, installments and rate of the loan.
    for (const x of r.additionalProducts || []) {
      if (x.scheme) {
        // eslint-disable-next-line no-await-in-loop
        const e = await productLoanEmi({ schemeId: x.scheme, valuePaise: x.valuePaise, mode: ev.input.mode, term: ev.input.term, rate: (x.annualRateBp || 0) / 100, loanDate: r.loanDate, code: x.memberCode });
        x.annualRateBp = e.rateBp;
        x.installmentPaise = e.installmentPaise;
        x.totalInterestPaise = e.totalInterestPaise;
        x.totalPayablePaise = e.totalPayablePaise;
      } else {
        const e = additionalEmi(scheme, ev.input, x.valuePaise, new Date(r.loanDate));
        x.installmentPaise = e.installmentAmount;
        x.totalInterestPaise = e.totalInterest;
        x.totalPayablePaise = e.totalPayable;
      }
    }
  }
  r.status = 'approved';
  r.decidedAt = new Date();
  r.decidedBy = req.user._id;
  r.decidedByCode = req.user.employeeCode || '';
  r.updatedBy = req.user._id;
  await r.save();
  await r.populate(POPULATE);
  await audit(req, {
    action: 'loanRequisition.approve',
    entity: 'LoanRequisition',
    entityId: r._id,
    after: { formId: r.formId, amount: r.amountPaise / 100, scheme: r.schemeCode, ...(r.requestedAmountPaise ? { requestedAmount: r.requestedAmountPaise / 100 } : {}), ...(r.requestedSchemeName ? { requestedScheme: r.requestedSchemeName } : {}) },
  });
  return r;
}

export async function approveRequisition(req, res) {
  const r = await loadForDecision(req);
  await applyApproval(req, r, req.body || {});
  res.json({ requisition: present(r, req.user, { detail: true }) });
}

async function applyRejection(req, r, reason) {
  r.status = 'rejected';
  r.rejectReason = reason;
  r.decidedAt = new Date();
  r.decidedBy = req.user._id;
  r.decidedByCode = req.user.employeeCode || '';
  r.updatedBy = req.user._id;
  await r.save();
  const back = [
    ...(r.product?.code ? [{ code: r.product.code, qty: r.product.quantity }] : []),
    ...(r.additionalProducts || []).map((a) => ({ code: a.product?.code, qty: a.product?.quantity })),
  ].filter((x) => x.code && x.qty > 0);
  await Promise.all(back.map((x) => StockProduct.updateOne({ code: x.code }, { $inc: { stockQty: x.qty } })));
  await r.populate(POPULATE);
  await audit(req, { action: 'loanRequisition.reject', entity: 'LoanRequisition', entityId: r._id, after: { formId: r.formId, reason } });
  return r;
}
const readReason = (req) => {
  const reason = asString(req.body?.reason);
  if (reason.length < 3 || reason.length > 200) throw invalid({ reason: 'Enter the reason for rejection (3–200 characters)' });
  return reason;
};

/** Rejects a pending requisition (a reason is required). Goods of a product loan go back into stock. */
export async function rejectRequisition(req, res) {
  const r = await loadForDecision(req);
  await applyRejection(req, r, readReason(req));
  res.json({ requisition: present(r, req.user, { detail: true }) });
}

/**
 * Takes back an approval made by mistake ("Don't approve"): the loan goes back to pending so it can be reviewed again, changed,
 * approved or rejected. Only while the loan is not paid yet; a paid loan can no longer be taken back. Each member loan of a
 * group requisition is handled on its own.
 */
export async function unapproveRequisition(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Requisition not found');
  const r = await LoanRequisition.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) });
  if (!r) throw new HttpError(404, 'Requisition not found');
  if (r.kind === 'business' && !isAdmin(req.user)) throw new HttpError(403, 'A business / MSME loan is decided by the admin only.');
  if (r.status !== 'approved') throw new HttpError(409, `Only an approved loan can be taken back (this one is ${r.status})`);
  if (r.disbursedAt || (await LoanPayment.exists({ requisition: r._id, status: 'paid' }))) throw new HttpError(409, 'This loan is already paid and its approval cannot be taken back');
  const reason = asString(req.body?.reason);
  if (reason.length < 3 || reason.length > 200) throw invalid({ reason: 'Enter why the approval is taken back (3–200 characters)' });
  r.status = 'pending';
  r.decidedAt = undefined;
  r.decidedBy = undefined;
  r.decidedByCode = '';
  r.updatedBy = req.user._id;
  await r.save();
  await r.populate(POPULATE);
  await audit(req, { action: 'loanRequisition.unapprove', entity: 'LoanRequisition', entityId: r._id, after: { formId: r.formId, reason } });
  res.json({ requisition: present(r, req.user, { detail: true }) });
}

// A group requisition is one submission with a loan for each member (a batch). The approver can decide the whole batch at once.
async function pendingOfBatch(req) {
  if (!mongoose.isValidObjectId(req.params.batchId)) throw new HttpError(404, 'Batch not found');
  const docs = await LoanRequisition.find({ batchId: req.params.batchId, isDeleted: false, status: 'pending', ...branchFilter(req.user) }).sort({ formId: 1 });
  if (!docs.length) throw new HttpError(404, 'No pending loan in this batch');
  return docs;
}
export async function approveBatch(req, res) {
  const docs = await pendingOfBatch(req);
  const results = [];
  for (const d of docs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await applyApproval(req, d, {});
      results.push({ formId: d.formId, ok: true });
    } catch (err) {
      results.push({ formId: d.formId, ok: false, message: err.message });
    }
  }
  res.json({ results, approved: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length });
}
export async function rejectBatch(req, res) {
  const reason = readReason(req);
  const docs = await pendingOfBatch(req);
  for (const d of docs) {
    // eslint-disable-next-line no-await-in-loop
    await applyRejection(req, d, reason);
  }
  res.json({ rejected: docs.length });
}

/**
 * Group loan requisition: one submission, but every member has her own loan: scheme, amount (mode, installments, rate)
 * and application form photos. Each member's loan is its own requisition record (form ID LRQ000123-1, -2 ...) in one batch.
 * Made for today only (no back date).
 */
export async function createGroupRequisition(req, res) {
  const b = req.body || {};
  const branchId = String(b.branch || '');
  if (!mongoose.isValidObjectId(branchId)) throw invalid({ branch: 'Select a branch' });
  if (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === branchId)) throw new HttpError(403, 'You can only use branches assigned to you');

  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (b.loanDate !== undefined && b.loanDate !== null && String(b.loanDate).trim() !== '') {
    const d = parseDateOnly(asString(b.loanDate));
    if (!d || d.getTime() !== today.getTime()) throw invalid({ loanDate: 'A group loan requisition is made for today only (no back date)' });
  }
  const loanDate = today;

  if (!mongoose.isValidObjectId(String(b.group || ''))) throw invalid({ group: 'Select the group' });
  const g = await Group.findOne({ _id: b.group, isDeleted: false, branch: branchId }).populate('members.member', MEMBER_PICK);
  if (!g) throw invalid({ group: 'Group not found in this branch' });
  if (!g.isActive) throw new HttpError(409, 'This group is inactive', { group: 'This group is inactive' });
  const groupMembers = g.members.filter((x) => x.member).map((x) => x.member);
  if (!groupMembers.length) throw new HttpError(409, 'The group has no members', { group: 'The group has no members' });

  // One entry per member. (Older clients send ticked members with one scheme and amount for all; that is turned into entries.)
  let entries = Array.isArray(b.entries) ? b.entries : null;
  if (!entries) {
    const ids = [...new Set((Array.isArray(b.memberIds) ? b.memberIds : []).map(String))];
    entries = ids.map((id) => {
      const f = (Array.isArray(b.memberForms) ? b.memberForms : []).find((x) => String(x?.member) === id) || {};
      const a = (Array.isArray(b.additional) ? b.additional : []).find((x) => String(x?.member) === id);
      return { member: id, schemeId: b.schemeId, amount: b.amount, mode: b.mode, term: b.term, rate: b.rate, front: f.front, back: f.back, additional: a ? { stockProduct: a.stockProduct, quantity: a.quantity, schemeId: a.schemeId } : undefined };
    });
  }
  if (!entries.length) throw invalid({ entries: 'Select the members who get a loan' });
  if (entries.length > 100) throw invalid({ entries: 'A requisition can have up to 100 members' });

  const memberIds = entries.map((e) => String(e?.member || ''));
  const busy = await runningSchemes(memberIds.filter((id) => mongoose.isValidObjectId(id)));
  const inGroup = await unfinishedRows(await LoanRequisition.find({ isDeleted: false, kind: 'group', group: g._id, status: { $in: RUNNING }, members: { $in: memberIds.filter((id) => mongoose.isValidObjectId(id)) } }).select('formId members status disbursedAt'));
  const errors = {};
  const prepared = [];
  const seen = new Set();
  for (const e of entries) {
    const mid = String(e?.member || '');
    const key = (f) => `entries.${mid}.${f}`;
    const m = groupMembers.find((x) => String(x._id) === mid);
    if (!m) throw invalid({ entries: 'A selected member is not in this group' });
    if (seen.has(mid)) throw invalid({ entries: `${m.code} is selected twice` });
    seen.add(mid);
    if (m.isBlocked) { errors[key('member')] = `${m.code} is blocked`; continue; }
    const reasons = notReady(m);
    if (reasons.length) { errors[key('member')] = `${m.code} is not ready for a loan: ${reasons.join('; ')}`; continue; }
    if (inGroup.some((l) => l.members.some((id) => String(id) === mid))) { errors[key('member')] = `${m.code} already has a running loan in this group. A member can take only one loan in a group; use the product loan (up to ${ADDITIONAL_PRODUCT_PERCENT}%) for more.`; continue; }

    // the application form of this member's loan
    const fe = {};
    const front = checkFormPhoto(e.front, 'front', `Form front photo of ${m.code}`, fe);
    const back = checkFormPhoto(e.back, 'back', `Form back photo of ${m.code}`, fe);
    Object.entries(fe).forEach(([k, v]) => { errors[key(k)] = v; });

    // the loan: scheme, amount, mode, installments, rate
    if (!mongoose.isValidObjectId(String(e.schemeId || ''))) { errors[key('schemeId')] = `Select the loan scheme of ${m.code}`; continue; }
    let ev;
    try {
      // eslint-disable-next-line no-await-in-loop
      ev = await evaluateLoan(calcInput({ schemeId: e.schemeId, amount: e.amount, rate: e.rate, mode: e.mode, term: e.term }, loanDate));
    } catch (err) {
      if (err.errors) { Object.entries(err.errors).forEach(([k, v]) => { errors[key(k)] = v; }); continue; }
      throw err;
    }
    // eslint-disable-next-line no-await-in-loop
    const scheme = await LoanScheme.findById(ev.input.scheme.id);
    if (!SCHEME_TYPES.group.includes(scheme.loanType)) { errors[key('schemeId')] = 'Select a group loan scheme'; continue; }
    if (busy.get(mid)?.has(String(scheme._id))) { errors[key('schemeId')] = `${m.code} already has an unfinished loan under ${scheme.name}`; continue; }
    const modeError = groupModeError(g.meetingType, ev.input.mode);
    if (modeError) { errors[key('mode')] = modeError; continue; }
    // eslint-disable-next-line no-await-in-loop
    const gate = await civilGate({ scheme, member: m });
    if (gate.error) { errors[key('civilScore')] = gate.error; continue; }
    const amountPaise = Math.round(ev.input.amount * 100);
    const cashPaise = cashAfterCharges(amountPaise, ev.charges);
    if (cashPaise <= 0) { errors[key('amount')] = 'The security, processing fee and insurance fee are more than the loan amount'; continue; }
    // an optional product on top of the loan, up to 25% of this member's loan
    let additional = [];
    if (e.additional?.stockProduct) {
      try {
        // eslint-disable-next-line no-await-in-loop
        additional = await buildAdditional({ items: [{ member: mid, stockProduct: e.additional.stockProduct, quantity: e.additional.quantity, schemeId: e.additional.schemeId }], members: [m], capFor: () => Math.floor((amountPaise * ADDITIONAL_PRODUCT_PERCENT) / 100), scheme, input: ev.input, loanDate, branchId });
      } catch (err) {
        if (err.errors) { errors[key('additional')] = Object.values(err.errors)[0]; continue; }
        throw err;
      }
    }
    prepared.push({ m, ev, scheme, amountPaise, cashPaise, additional, front, back, gate });
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'Please correct the highlighted fields', errors);

  // Employee: chosen on the form, otherwise the signed-in employee.
  let employeeCode = asString(b.employeeCode).toUpperCase();
  if (employeeCode) {
    const emp = await User.findOne({ employeeCode: { $eq: employeeCode, $nin: await blockedCodes() }, $or: [{ isActive: true }, { legacyImport: true }] }).select('role branches');
    const ok = emp && (['super_admin', 'admin'].includes(emp.role) || (emp.branches || []).some((x) => String(x) === branchId));
    if (!ok) throw invalid({ employeeCode: 'Select a valid employee of this branch' });
  } else {
    employeeCode = req.user.employeeCode;
    if (!employeeCode) {
      employeeCode = await generateCode('employee');
      await User.updateOne({ _id: req.user._id, employeeCode: { $exists: false } }, { $set: { employeeCode } });
    }
  }
  // the civil scores typed on the form go into the members' civil checks
  for (const p of prepared) await recordCivil({ gate: p.gate, member: p.m, branchId, req }); // eslint-disable-line no-await-in-loop

  // The products sold with the loans leave the stock now; if anything fails nothing is kept.
  const reserved = await reserveStock(prepared.flatMap((p) => p.additional.map((a) => ({ id: a.productId, qty: a.product.quantity, name: a.product.name }))));
  const base = await generateCode('loanRequisition');
  const batchId = new mongoose.Types.ObjectId();
  const created = [];
  try {
    for (let i = 0; i < prepared.length; i += 1) {
      const p = prepared[i];
      const { ev } = p;
      // eslint-disable-next-line no-await-in-loop
      const doc = await LoanRequisition.create({
        kind: 'group', formId: `${base}-${i + 1}`, batchId, batchFormId: base, batchCount: prepared.length, branch: branchId, loanDate,
        group: g._id,
        groupInfo: { code: g.code, name: g.name, leaderName: g.leaderName, employeeCode: g.employeeCode, meetingType: g.meetingType || '', members: [{ code: p.m.code, name: p.m.name }] },
        members: [p.m._id], memberCount: 1, totalAmountPaise: p.amountPaise,
        ...(p.additional.length ? { additionalProducts: p.additional } : {}),
        memberForms: [{ member: p.m._id, memberCode: p.m.code, front: p.front, back: p.back }],
        scheme: p.scheme._id, schemeCode: p.scheme.code, schemeName: p.scheme.name, amountPaise: p.amountPaise, mode: ev.input.mode, term: ev.input.term,
        annualRateBp: Math.round(ev.input.rate * 100), calculationType: ev.input.calculationType, emiType: ev.input.emiType,
        installmentPaise: Math.round(ev.summary.installmentAmount * 100), totalInterestPaise: Math.round(ev.summary.totalInterest * 100), totalPayablePaise: Math.round(ev.summary.totalPayable * 100),
        processingFeePaise: ev.charges ? Math.round(ev.charges.processingFee * 100) : 0, insuranceFeePaise: ev.charges ? Math.round(ev.charges.cost * 100) : 0,
        securityAmountPaise: ev.charges ? Math.round(ev.charges.securityAmount * 100) : 0, cashPaise: p.cashPaise, securityType: ev.charges?.securityType || 'none',
        employeeCode, createdBy: req.user._id, updatedBy: req.user._id,
      });
      created.push(doc);
    }
  } catch (err) {
    await LoanRequisition.deleteMany({ _id: { $in: created.map((d) => d._id) } });
    await releaseStock(reserved);
    throw err;
  }
  for (const d of created) {
    // eslint-disable-next-line no-await-in-loop
    await d.populate(POPULATE);
  }
  await audit(req, {
    action: 'loanRequisition.create', entity: 'LoanRequisition', entityId: created[0]._id,
    after: { formId: base, kind: 'group', for: g.code, members: created.length, total: created.reduce((t, d) => t + d.amountPaise, 0) / 100 },
  });
  notifyApprovers({ branch: branchId, exceptUser: req.user._id, title: 'New group loan requisition', message: `Group loan requisition ${base} for ${g.code} ${g.name}: ${created.length} member${created.length === 1 ? '' : 's'}, ₹${created.reduce((t, d) => t + d.amountPaise, 0) / 100}. It waits for approval.` });
  res.status(201).json({ requisitions: created.map((d) => present(d, req.user, { detail: true })), requisition: present(created[0], req.user, { detail: true }), batch: { formId: base, count: created.length } });
}

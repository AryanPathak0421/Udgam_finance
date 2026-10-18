import mongoose from 'mongoose';
import { LoanPayment } from '../models/LoanPayment.js';
import { SecurityWithdrawal } from '../models/SecurityWithdrawal.js';
import { Member } from '../models/Member.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { branchFilter } from './groupController.js';
import { borrowerState, receive, startOfToday } from './emiController.js';
import { OtpChallenge } from '../models/OtpChallenge.js';
import { issueOtp, hashOtp } from '../services/otpChallenges.js';
import { sendSms } from '../services/sms.js';
import { maskMobile } from './groupController.js';
import crypto from 'crypto';

const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const POPULATE = [{ path: 'branch', select: 'code name' }];
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const money = (p) => (p === undefined || p === null ? null : p / 100);

// ---- security deposits: the security amount kept from each loan when it was paid out -----------------------------------
/** One row per borrower per loan with a security amount. */
async function depositRows(req, { memberId } = {}) {
  const filter = { status: 'paid', ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  if (memberId) filter['lines.member'] = memberId;
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) {
    filter.paidOn = {};
    if (from) filter.paidOn.$gte = from;
    if (to) filter.paidOn.$lte = to;
  }
  // (read one loan at a time: only the rows are kept, never all the loans with their schedules)
  const loans = LoanPayment.find(filter).populate(POPULATE).sort({ paidOn: -1, createdAt: -1 }).limit(20000).lean().cursor({ batchSize: 100 });
  const q = asString(req.query.q).toLowerCase();
  const rows = [];
  for await (const l of loans) {
    for (const line of l.lines) {
      if (!(line.securityPaise > 0)) continue;
      if (memberId && String(line.member) !== String(memberId)) continue;
      const text = `${line.code} ${line.name} ${l.loanId} ${l.formId} ${l.receiptNo}`.toLowerCase();
      if (q && !text.includes(q)) continue;
      rows.push({
        loanPaymentId: l._id, loanId: l.loanId || '', formId: l.formId, receiptNo: l.receiptNo, date: iso(l.paidOn), member: line.member, code: line.code, name: line.name,
        group: l.group?.code ? `${l.group.code} — ${l.group.name}` : '', branch: l.branch ? { id: l.branch._id, code: l.branch.code, name: l.branch.name } : null, schemeName: l.schemeName,
        loanAmount: money(line.amountPaise), amountPaise: line.securityPaise, amount: money(line.securityPaise),
      });
    }
  }
  return rows;
}

/** Security Deposit List: branch wise, from - to date. */
export async function depositList(req, res) {
  const rows = await depositRows(req);
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  res.json({
    items: rows.slice(skip, skip + limit).map(({ amountPaise, ...r }) => r), total: rows.length, page, limit, totalPages: Math.max(Math.ceil(rows.length / limit), 1),
    totalAmount: money(rows.reduce((s, r) => s + r.amountPaise, 0)), members: new Set(rows.map((r) => r.code)).size,
  });
}

// The security a member has deposited, withdrawn (or has waiting for approval) and what is left.
async function balanceOf(req, memberId) {
  const deposits = await depositRows({ ...req, query: {} }, { memberId });
  const dep = deposits.reduce((s, r) => s + r.amountPaise, 0);
  const rows = await SecurityWithdrawal.find({ member: memberId, status: { $in: ['pending', 'approved'] } }).select('amountPaise status');
  const approved = rows.filter((x) => x.status === 'approved').reduce((s, x) => s + x.amountPaise, 0);
  const pending = rows.filter((x) => x.status === 'pending').reduce((s, x) => s + x.amountPaise, 0);
  return { deposits, depositedPaise: dep, withdrawnPaise: approved, pendingPaise: pending, availablePaise: dep - approved - pending };
}

// The security amount earns 10% a year, given after each full year from the day the loan was paid out
// (loan paid on 1 Jan 2026: on 1 Jan 2027 the interest is 10% of that security amount, a year later 20%).
export const SECURITY_INTEREST_PERCENT = 10;
function fullYears(from, to) {
  let y = to.getUTCFullYear() - from.getUTCFullYear();
  if (to.getUTCMonth() < from.getUTCMonth() || (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate())) y -= 1;
  return Math.max(y, 0);
}

/**
 * Where the security of a member stands. Security of a loan that is closed (fully repaid or settled) can be withdrawn; the security
 * of a running loan can only be adjusted against an EMI. Each loan's security earns interest (see above).
 */
async function securityPosition(req, memberId) {
  const loans = await LoanPayment.find({ status: 'paid', 'lines.member': memberId, ...branchFilter(req.user) });
  const asOf = startOfToday();
  const pos = { closed: 0, running: 0, interestClosed: 0, interestAll: 0, byLoan: new Map() };
  for (const l of loans) {
    const line = l.lines.find((x) => String(x.member) === String(memberId));
    if (!(line?.securityPaise > 0)) continue;
    // eslint-disable-next-line no-await-in-loop
    const st = await borrowerState(l, line, asOf);
    const closed = Boolean(st.settled) || !st.left.length;
    const years = fullYears(new Date(l.paidOn), asOf);
    const interest = Math.round((line.securityPaise * years * SECURITY_INTEREST_PERCENT) / 100);
    if (closed) { pos.closed += line.securityPaise; pos.interestClosed += interest; } else pos.running += line.securityPaise;
    pos.interestAll += interest;
    pos.byLoan.set(String(l._id), { closed, years, interestPaise: interest });
  }
  return pos;
}

/**
 * What can be withdrawn now: the security of closed loans that is not already withdrawn or waiting (never more than what is
 * available), and the interest that goes with it. Interest is paid in proportion to the security withdrawn.
 */
async function withdrawInfo(req, memberId, bal) {
  const pos = await securityPosition(req, memberId);
  const rows = await SecurityWithdrawal.find({ member: memberId, kind: 'withdraw', status: { $in: ['pending', 'approved'] } }).select('amountPaise interestPaise');
  const used = rows.reduce((s, x) => s + x.amountPaise, 0);
  const usedInterest = rows.reduce((s, x) => s + (x.interestPaise || 0), 0);
  const closedRemaining = Math.max(pos.closed - used, 0);
  const interestRemaining = Math.max(pos.interestClosed - usedInterest, 0);
  const withdrawable = Math.max(Math.min(bal.availablePaise, closedRemaining), 0);
  const interestFor = (amountPaise) => (closedRemaining <= 0 ? 0 : amountPaise >= closedRemaining ? interestRemaining : Math.round((interestRemaining * amountPaise) / closedRemaining));
  return { pos, withdrawable, closedRemaining, interestRemaining, interestFor };
}

// where a request stands: waiting for the admin, approved and waiting for the member's OTP, done, or rejected
const stageOf = (w) => {
  if (w.status === 'pending') return 'pending';
  if (w.status === 'rejected') return 'rejected';
  return w.otpRequired && !w.otpVerifiedAt ? 'awaiting_otp' : 'completed';
};

const presentWithdrawal = (w, info) => ({
  ...(info ? { info } : {}),
  id: w._id, receiptNo: w.receiptNo, memberCode: w.memberCode, memberName: w.memberName, branch: w.branch?._id ? { id: w.branch._id, code: w.branch.code, name: w.branch.name } : null,
  stage: stageOf(w), otpVerifiedAt: w.otpVerifiedAt || null, completedByCode: w.completedByCode || '',
  kind: w.kind, amount: money(w.amountPaise), interest: money(w.interestPaise || 0), total: money(w.amountPaise + (w.interestPaise || 0)), loanId: w.loanId || '', payMode: w.payMode || '', reference: w.reference || '', remark: w.remark || '', status: w.status, rejectReason: w.rejectReason || '',
  requestedOn: iso(w.createdAt), requestedByCode: w.requestedByCode || '', decidedAt: w.decidedAt || null, decidedByCode: w.decidedByCode || '', emiReceiptNo: w.emiReceiptNo || '',
});

async function findMember(req, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Member not found');
  const m = await Member.findOne({ _id: id, isDeleted: false, ...branchFilter(req.user) }).select('code name branch mobile isBlocked').populate(POPULATE);
  if (!m) throw new HttpError(404, 'Member not found');
  return m;
}

/** A member's savings: deposits per loan, withdrawals, the balance and the loans an EMI can be adjusted against. */
export async function memberSavings(req, res) {
  const m = await findMember(req, req.params.id);
  const b = await balanceOf(req, m._id);
  const depositInfo = (await securityPosition(req, m._id)).byLoan;
  const withdrawals = await SecurityWithdrawal.find({ member: m._id }).populate(POPULATE).sort({ createdAt: -1 }).limit(50);
  // loans of this member with EMI still to pay (an EMI can be adjusted against them)
  const asOf = startOfToday();
  const loans = [];
  const seen = new Set();
  for (const d of b.deposits) {
    if (seen.has(String(d.loanPaymentId))) continue;
    seen.add(String(d.loanPaymentId));
  }
  const all = await LoanPayment.find({ status: 'paid', 'lines.member': m._id, ...branchFilter(req.user) }).populate(POPULATE).sort({ createdAt: -1 }).limit(50);
  for (const l of all) {
    const line = l.lines.find((x) => String(x.member) === String(m._id));
    // eslint-disable-next-line no-await-in-loop
    const st = await borrowerState(l, line, asOf);
    loans.push({ id: l._id, loanId: l.loanId || '', formId: l.formId, schemeName: l.schemeName, outstanding: money(st.totals.outstanding), due: money(st.totals.due), open: st.left.length > 0, settled: Boolean(st.settled) });
  }
  res.json({
    member: { id: m._id, code: m.code, name: m.name, mobile: m.mobile, isBlocked: Boolean(m.isBlocked), branch: m.branch ? { id: m.branch._id, code: m.branch.code, name: m.branch.name } : null },
    deposited: money(b.depositedPaise), withdrawn: money(b.withdrawnPaise), pending: money(b.pendingPaise), available: money(b.availablePaise), ...(await (async () => {
      const wi = await withdrawInfo(req, m._id, b);
      return { withdrawable: money(wi.withdrawable), runningSecurity: money(wi.pos.running), closedSecurity: money(wi.closedRemaining), interestRate: SECURITY_INTEREST_PERCENT, interestEarned: money(wi.pos.interestAll), interestWithdrawable: money(wi.interestRemaining) };
    })()),
    deposits: b.deposits.map(({ amountPaise, ...r }) => ({ ...r, closed: Boolean(depositInfo.get(String(r.loanPaymentId))?.closed), years: depositInfo.get(String(r.loanPaymentId))?.years || 0, interest: money(depositInfo.get(String(r.loanPaymentId))?.interestPaise || 0) })), withdrawals: withdrawals.map(presentWithdrawal), loans,
  });
}

/** Asks to withdraw the security (or put it against an EMI). Waits for the admin. */
export async function requestWithdrawal(req, res) {
  const b = req.body || {};
  const m = await findMember(req, b.member);
  if (m.isBlocked) throw new HttpError(409, 'This member is blocked. Unblock the member before any withdrawal.');
  const kind = asString(b.kind);
  if (!['withdraw', 'adjust'].includes(kind)) throw invalid({ kind: 'Choose Adjust EMI or Withdraw' });
  const amountPaise = toMinor(typeof b.amount === 'number' ? String(b.amount) : asString(b.amount));
  if (amountPaise === null || amountPaise < 100) throw invalid({ amount: 'Enter the amount (₹1 or more, up to 2 decimals)' });
  const bal = await balanceOf(req, m._id);
  if (amountPaise > bal.availablePaise) throw invalid({ amount: `Only ${money(bal.availablePaise)} of the security is available${bal.pendingPaise ? ` (${money(bal.pendingPaise)} is waiting for approval)` : ''}` });
  const data = {};
  if (kind === 'withdraw') {
    const wi = await withdrawInfo(req, m._id, bal);
    const can = wi.withdrawable;
    if (amountPaise > can) throw invalid({ amount: can > 0 ? `Only ${money(can)} can be withdrawn: the security of a running loan can only be adjusted against its EMI` : 'The security of a running loan cannot be withdrawn. It can only be adjusted against an EMI.' });
    data.interestPaise = wi.interestFor(amountPaise);
  }

  if (kind === 'adjust') {
    if (!mongoose.isValidObjectId(String(b.loan || ''))) throw invalid({ loan: 'Select the loan whose EMI is adjusted' });
    const l = await LoanPayment.findOne({ _id: b.loan, status: 'paid', 'lines.member': m._id, ...branchFilter(req.user) });
    if (!l) throw invalid({ loan: 'Loan not found for this member' });
    const line = l.lines.find((x) => String(x.member) === String(m._id));
    const st = await borrowerState(l, line, startOfToday());
    if (st.settled || !st.left.length) throw invalid({ loan: 'No EMI is left to pay on this loan' });
    if (amountPaise > st.totals.outstanding) throw invalid({ amount: `The EMI left on this loan is only ${money(st.totals.outstanding)}` });
    data.loanPayment = l._id;
    data.loanId = l.loanId;
  } else {
    data.payMode = asString(b.payMode);
    if (!['cash', 'bank', 'upi', 'cheque'].includes(data.payMode)) throw invalid({ payMode: 'Select how the amount is paid back' });
    data.reference = asString(b.reference).slice(0, 60);
  }
  const w = await SecurityWithdrawal.create({
    ...data, receiptNo: await generateCode('securityWithdrawal'), member: m._id, memberCode: m.code, memberName: m.name, branch: m.branch._id, kind, amountPaise,
    remark: asString(b.remark).slice(0, 300), requestedByCode: req.user.employeeCode || '', createdBy: req.user._id,
  });
  await w.populate(POPULATE);
  await audit(req, { action: 'securityWithdrawal.request', entity: 'SecurityWithdrawal', entityId: w._id, after: { receiptNo: w.receiptNo, member: m.code, kind, amount: amountPaise / 100 } });
  res.status(201).json({ withdrawal: presentWithdrawal(w) });
}

/** Security Withdrawal List: branch wise, from - to date; pending ones wait for the admin. */
export async function withdrawalList(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { ...branchFilter(req.user) };
  if (['pending', 'approved', 'rejected'].includes(asString(req.query.status))) filter.status = req.query.status;
  // stage: approved and waiting for the member's OTP, or completed (OTP verified, or done before the OTP step existed)
  if (asString(req.query.stage) === 'awaiting_otp') Object.assign(filter, { status: 'approved', otpRequired: true, otpVerifiedAt: { $exists: false } });
  if (asString(req.query.stage) === 'completed') Object.assign(filter, { status: 'approved', $and: [{ $or: [{ otpRequired: { $ne: true } }, { otpVerifiedAt: { $exists: true } }] }] });
  if (['withdraw', 'adjust'].includes(asString(req.query.kind))) filter.kind = req.query.kind;
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lt = new Date(to.getTime() + 24 * 3600 * 1000);
  }
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const search = [{ receiptNo: rx }, { memberCode: rx }, { memberName: rx }, { loanId: rx }];
    filter.$and = [...(filter.$and || []), { $or: search }];
  }
  const awaitingOtp = await SecurityWithdrawal.countDocuments({ ...branchFilter(req.user), status: 'approved', otpRequired: true, otpVerifiedAt: { $exists: false } });
  const [items, total, pending, sum] = await Promise.all([
    SecurityWithdrawal.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    SecurityWithdrawal.countDocuments(filter),
    SecurityWithdrawal.countDocuments({ ...branchFilter(req.user), status: 'pending' }),
    SecurityWithdrawal.find(filter).select('amountPaise'),
  ]);
  // For requests waiting for a decision: the member's security and, for an adjustment, the EMI due on the loan.
  const infoOf = new Map();
  const waiting = items.filter((w) => w.status === 'pending');
  if (waiting.length) {
    const asOf = startOfToday();
    const loans = await LoanPayment.find({ _id: { $in: waiting.filter((w) => w.kind === 'adjust').map((w) => w.loanPayment) } });
    const balances = new Map();
    for (const w of waiting) {
      const key = String(w.member);
      // eslint-disable-next-line no-await-in-loop
      if (!balances.has(key)) balances.set(key, await balanceOf(req, w.member));
      const b = balances.get(key);
      const info = { deposited: money(b.depositedPaise), withdrawn: money(b.withdrawnPaise), securityLeft: money(b.depositedPaise - b.withdrawnPaise), requested: money(w.amountPaise), staysAfter: money(b.depositedPaise - b.withdrawnPaise - w.amountPaise) };
      if (w.kind === 'adjust') {
        const l = loans.find((x) => String(x._id) === String(w.loanPayment));
        const line = l?.lines.find((x) => String(x.member) === String(w.member));
        if (l && line) {
          // eslint-disable-next-line no-await-in-loop
          const st = await borrowerState(l, line, asOf);
          info.emiDue = money(st.totals.due);
          info.emiLeft = money(st.totals.outstanding);
        }
      }
      infoOf.set(String(w._id), info);
    }
  }
  res.json({ items: items.map((w) => presentWithdrawal(w, infoOf.get(String(w._id)))), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1), pending, awaitingOtp, totalAmount: money(sum.reduce((s, x) => s + x.amountPaise, 0)) });
}

async function loadPending(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Request not found');
  const w = await SecurityWithdrawal.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (!w) throw new HttpError(404, 'Request not found');
  if (w.status !== 'pending') throw new HttpError(409, `This request is already ${w.status}`);
  return w;
}

// Sends the OTP of a request to the phone of the member.
async function sendOtpFor(req, w) {
  const m = await Member.findById(w.member).select('mobile');
  if (!m?.mobile) throw new HttpError(409, 'This member has no mobile number to send the OTP to');
  const { challenge, otp } = await issueOtp({ user: req.user, purpose: 'security_withdrawal', subject: w.receiptNo, sentTo: m.mobile });
  const what = w.kind === 'adjust' ? 'adjust your security against your EMI' : 'withdraw your security';
  const total = (w.amountPaise + (w.interestPaise || 0)) / 100;
  const sms = await sendSms({ to: m.mobile, text: `Udgam Microfinance: OTP ${otp} to ${what} (${total} Rs${w.interestPaise ? ', security + interest' : ''}). Valid for 5 minutes. Do not share this OTP.` });
  w.otpChallenge = challenge._id;
  w.otpSentAt = new Date();
  await w.save();
  return { sentTo: maskMobile(m.mobile), expiresAt: challenge.expiresAt, ...(sms.dev && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}) };
}

/**
 * Admin approves. An adjustment against an EMI is done at once (no OTP). A withdrawal is not paid yet: an OTP goes to the member's
 * phone and the security is paid back once that OTP is verified.
 */
export async function approveWithdrawal(req, res) {
  const w = await loadPending(req);
  const m = await Member.findById(w.member).select('isBlocked mobile');
  if (m?.isBlocked) throw new HttpError(409, 'This member is blocked. Unblock the member first.');
  if (w.kind === 'withdraw' && !m?.mobile) throw new HttpError(409, 'This member has no mobile number to send the OTP to');
  // the balance still has to cover it (this request is counted in "pending")
  const bal = await balanceOf(req, w.member);
  if (bal.availablePaise + w.amountPaise < w.amountPaise) throw new HttpError(409, 'The security left is less than this request');
  if (w.kind === 'adjust') {
    // the security is put against the EMI now: no OTP for an adjustment
    const l = await LoanPayment.findOne({ _id: w.loanPayment, status: 'paid' }).populate(POPULATE);
    if (!l) throw new HttpError(409, 'The loan is no longer open');
    const line = l.lines.find((x) => String(x.member) === String(w.member));
    const doc = await receive(req, l, line, { amountPaise: w.amountPaise, paidOn: startOfToday(), payMode: 'security', reference: `Security ${w.receiptNo}` });
    w.emiReceiptNo = doc.receiptNo;
    w.status = 'approved';
    w.otpRequired = false;
    w.decidedAt = new Date();
    w.decidedBy = req.user._id;
    w.decidedByCode = req.user.employeeCode || '';
    w.completedByCode = req.user.employeeCode || '';
    await w.save();
    await w.populate(POPULATE);
    await audit(req, { action: 'securityWithdrawal.approve', entity: 'SecurityWithdrawal', entityId: w._id, after: { receiptNo: w.receiptNo, member: w.memberCode, kind: w.kind, amount: w.amountPaise / 100, emiReceipt: w.emiReceiptNo } });
    return res.json({ withdrawal: presentWithdrawal(w), otp: null });
  }
  w.status = 'approved';
  w.otpRequired = true;
  w.decidedAt = new Date();
  w.decidedBy = req.user._id;
  w.decidedByCode = req.user.employeeCode || '';
  await w.save();
  let otp = null;
  try {
    otp = await sendOtpFor(req, w);
  } catch (err) {
    // the approval stands; the OTP can be sent again from the Security Withdrawal List
    otp = { error: err.message };
  }
  await w.populate(POPULATE);
  await audit(req, { action: 'securityWithdrawal.approve', entity: 'SecurityWithdrawal', entityId: w._id, after: { receiptNo: w.receiptNo, member: w.memberCode, kind: w.kind, amount: w.amountPaise / 100 } });
  res.json({ withdrawal: presentWithdrawal(w), otp });
}

function openForOtp(w) {
  if (w.status !== 'approved' || !w.otpRequired) throw new HttpError(409, w.status === 'approved' ? 'This request needs no OTP' : `This request is ${w.status}`);
  if (w.otpVerifiedAt) throw new HttpError(409, 'This request is already completed');
}

async function loadRequest(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Request not found');
  const w = await SecurityWithdrawal.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (!w) throw new HttpError(404, 'Request not found');
  return w;
}

/** Sends the OTP of an approved request to the member again. */
export async function sendWithdrawalOtp(req, res) {
  const w = await loadRequest(req);
  openForOtp(w);
  const otp = await sendOtpFor(req, w);
  res.json({ otp });
}

/** The member tells the OTP: the security is paid back / put against the EMI now. */
export async function verifyWithdrawalOtp(req, res) {
  const w = await loadRequest(req);
  openForOtp(w);
  const otp = asString(req.body?.otp);
  if (!/^\d{6}$/.test(otp)) throw invalid({ otp: 'Enter the 6-digit OTP' });
  if (!w.otpChallenge) throw new HttpError(409, 'No OTP has been sent yet. Send the OTP first.');
  const ch = await OtpChallenge.findById(w.otpChallenge).select('+hash');
  if (!ch) throw new HttpError(409, 'No OTP has been sent yet. Send the OTP first.');
  if (ch.consumedAt) throw new HttpError(409, 'This OTP has already been used. Send a new OTP.');
  if (ch.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'The OTP has expired. Send a new OTP.');
  if (ch.attempts >= 3) throw new HttpError(429, 'Too many wrong attempts. Send a new OTP.');
  const given = Buffer.from(hashOtp(ch._id, otp), 'hex');
  const stored = Buffer.from(ch.hash, 'hex');
  if (!(given.length === stored.length && crypto.timingSafeEqual(given, stored))) {
    ch.attempts += 1;
    await ch.save();
    const left = 3 - ch.attempts;
    throw invalid({ otp: left > 0 ? `Incorrect OTP. ${left} attempt${left > 1 ? 's' : ''} left.` : 'Incorrect OTP. Send a new OTP.' });
  }
  const m = await Member.findById(w.member).select('isBlocked');
  if (m?.isBlocked) throw new HttpError(409, 'This member is blocked. Unblock the member first.');
  // the OTP is right: do what was approved. An adjustment is received as an EMI (paid by "security").
  if (w.kind === 'adjust') {
    const l = await LoanPayment.findOne({ _id: w.loanPayment, status: 'paid' }).populate(POPULATE);
    if (!l) throw new HttpError(409, 'The loan is no longer open');
    const line = l.lines.find((x) => String(x.member) === String(w.member));
    const doc = await receive(req, l, line, { amountPaise: w.amountPaise, paidOn: startOfToday(), payMode: 'security', reference: `Security ${w.receiptNo}` });
    w.emiReceiptNo = doc.receiptNo;
  }
  ch.verifiedAt = new Date();
  ch.consumedAt = new Date();
  await ch.save();
  w.otpVerifiedAt = new Date();
  w.completedByCode = req.user.employeeCode || '';
  await w.save();
  await w.populate(POPULATE);
  await audit(req, { action: 'securityWithdrawal.complete', entity: 'SecurityWithdrawal', entityId: w._id, after: { receiptNo: w.receiptNo, member: w.memberCode, kind: w.kind, amount: w.amountPaise / 100, emiReceipt: w.emiReceiptNo } });
  res.json({ withdrawal: presentWithdrawal(w) });
}

export async function rejectWithdrawal(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Request not found');
  const w = await SecurityWithdrawal.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (!w) throw new HttpError(404, 'Request not found');
  if (!(w.status === 'pending' || (w.status === 'approved' && w.otpRequired && !w.otpVerifiedAt))) throw new HttpError(409, `This request is already ${w.status === 'approved' ? 'completed' : w.status}`);
  const reason = asString(req.body?.reason);
  if (reason.length < 3 || reason.length > 200) throw invalid({ reason: 'Enter the reason (3–200 characters)' });
  w.status = 'rejected';
  w.rejectReason = reason;
  w.decidedAt = new Date();
  w.decidedBy = req.user._id;
  w.decidedByCode = req.user.employeeCode || '';
  await w.save();
  await w.populate(POPULATE);
  await audit(req, { action: 'securityWithdrawal.reject', entity: 'SecurityWithdrawal', entityId: w._id, after: { receiptNo: w.receiptNo, reason } });
  res.json({ withdrawal: presentWithdrawal(w) });
}

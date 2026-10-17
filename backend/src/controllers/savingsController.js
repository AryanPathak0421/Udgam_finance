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
  const loans = await LoanPayment.find(filter).populate(POPULATE).sort({ paidOn: -1, createdAt: -1 }).limit(5000);
  const q = asString(req.query.q).toLowerCase();
  const rows = [];
  for (const l of loans) {
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

const presentWithdrawal = (w, info) => ({
  ...(info ? { info } : {}),
  id: w._id, receiptNo: w.receiptNo, memberCode: w.memberCode, memberName: w.memberName, branch: w.branch?._id ? { id: w.branch._id, code: w.branch.code, name: w.branch.name } : null,
  kind: w.kind, amount: money(w.amountPaise), loanId: w.loanId || '', payMode: w.payMode || '', reference: w.reference || '', remark: w.remark || '', status: w.status, rejectReason: w.rejectReason || '',
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
    deposited: money(b.depositedPaise), withdrawn: money(b.withdrawnPaise), pending: money(b.pendingPaise), available: money(b.availablePaise),
    deposits: b.deposits.map(({ amountPaise, ...r }) => r), withdrawals: withdrawals.map(presentWithdrawal), loans,
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
    filter.$or = [{ receiptNo: rx }, { memberCode: rx }, { memberName: rx }, { loanId: rx }];
  }
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
      const info = { deposited: money(b.depositedPaise), withdrawn: money(b.withdrawnPaise), securityLeft: money(b.depositedPaise - b.withdrawnPaise) };
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
  res.json({ items: items.map((w) => presentWithdrawal(w, infoOf.get(String(w._id)))), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1), pending, totalAmount: money(sum.reduce((s, x) => s + x.amountPaise, 0)) });
}

async function loadPending(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Request not found');
  const w = await SecurityWithdrawal.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (!w) throw new HttpError(404, 'Request not found');
  if (w.status !== 'pending') throw new HttpError(409, `This request is already ${w.status}`);
  return w;
}

/** Admin approves: a withdrawal is paid back; an adjustment is received as an EMI (paid by "security"). */
export async function approveWithdrawal(req, res) {
  const w = await loadPending(req);
  const m = await Member.findById(w.member).select('isBlocked');
  if (m?.isBlocked) throw new HttpError(409, 'This member is blocked. Unblock the member first.');
  // the balance still has to cover it (this request is counted in "pending")
  const bal = await balanceOf(req, w.member);
  if (bal.availablePaise + w.amountPaise < w.amountPaise) throw new HttpError(409, 'The security left is less than this request');
  if (w.kind === 'adjust') {
    const l = await LoanPayment.findOne({ _id: w.loanPayment, status: 'paid' }).populate(POPULATE);
    if (!l) throw new HttpError(409, 'The loan is no longer open');
    const line = l.lines.find((x) => String(x.member) === String(w.member));
    const doc = await receive(req, l, line, { amountPaise: w.amountPaise, paidOn: startOfToday(), payMode: 'security', reference: `Security ${w.receiptNo}` });
    w.emiReceiptNo = doc.receiptNo;
  }
  w.status = 'approved';
  w.decidedAt = new Date();
  w.decidedBy = req.user._id;
  w.decidedByCode = req.user.employeeCode || '';
  await w.save();
  await w.populate(POPULATE);
  await audit(req, { action: 'securityWithdrawal.approve', entity: 'SecurityWithdrawal', entityId: w._id, after: { receiptNo: w.receiptNo, member: w.memberCode, kind: w.kind, amount: w.amountPaise / 100, emiReceipt: w.emiReceiptNo } });
  res.json({ withdrawal: presentWithdrawal(w) });
}

export async function rejectWithdrawal(req, res) {
  const w = await loadPending(req);
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

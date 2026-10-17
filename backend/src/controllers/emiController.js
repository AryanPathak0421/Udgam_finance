import mongoose from 'mongoose';
import { LoanPayment } from '../models/LoanPayment.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { branchFilter, isAdmin } from './groupController.js';

const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const POPULATE = [{ path: 'branch', select: 'code name' }];
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const money = (p) => (p === undefined || p === null ? null : p / 100);
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const DAY = 24 * 3600 * 1000;

/** Loans that were paid out (and not cancelled) matching a Loan ID, form ID, receipt, borrower or group. */
export async function searchLoans(req, res) {
  const q = asString(req.query.q);
  if (q.length < 2) return res.json({ items: [] });
  const rx = new RegExp(escapeRegex(q), 'i');
  const filter = { status: 'paid', ...branchFilter(req.user), $or: [{ loanId: rx }, { formId: rx }, { receiptNo: rx }, { 'lines.code': rx }, { 'lines.name': rx }, { 'group.code': rx }, { 'group.name': rx }] };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const items = await LoanPayment.find(filter).populate(POPULATE).sort({ createdAt: -1 }).limit(20);
  res.json({
    items: items.map((p) => ({
      id: p._id, loanId: p.loanId || '', formId: p.formId, kind: p.kind, branch: p.branch ? `${p.branch.code} — ${p.branch.name}` : '',
      who: p.group?.code ? `${p.group.code} — ${p.group.name} (${p.lines.length} members)` : `${p.lines[0]?.code} — ${p.lines[0]?.name}`,
      schemeName: p.schemeName, paidOn: iso(p.paidOn), installments: p.installments, amount: money(p.totalAmountPaise),
    })),
  });
}

async function loadLoan(req, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Loan not found');
  const p = await LoanPayment.findOne({ _id: id, status: 'paid', ...branchFilter(req.user) }).populate(POPULATE);
  if (!p) throw new HttpError(404, 'Loan not found');
  return p;
}

// Installments of one borrower with what has been paid and what is due.
async function borrowerState(p, line, asOf) {
  const pays = await EmiPayment.find({ loanPayment: p._id, memberCode: line.code, status: 'paid' }).select('installments receiptNo paidOn type');
  const paidBy = new Map();
  pays.forEach((x) => x.installments.forEach((n) => paidBy.set(n, { receiptNo: x.receiptNo, paidOn: x.paidOn, type: x.type })));
  const extra = line.extraEmiPaise || 0;
  const schedule = p.schedule.map((s) => {
    const paid = paidBy.get(s.no);
    const due = new Date(s.dueDate).getTime();
    return {
      no: s.no, dueDate: iso(s.dueDate), amountPaise: s.installmentPaise + extra,
      status: paid ? 'paid' : due <= asOf.getTime() ? 'due' : 'upcoming', overdueDays: !paid && due < asOf.getTime() ? Math.floor((asOf.getTime() - due) / DAY) : 0,
      receiptNo: paid?.receiptNo || '', paidOn: paid ? iso(paid.paidOn) : null, paidType: paid?.type || '',
    };
  });
  const sum = (arr) => arr.reduce((t, s) => t + s.amountPaise, 0);
  const paid = schedule.filter((s) => s.status === 'paid');
  const due = schedule.filter((s) => s.status === 'due');
  const left = schedule.filter((s) => s.status !== 'paid');
  return { schedule, paid, due, left, totals: { paid: sum(paid), due: sum(due), outstanding: sum(left) } };
}

/** A loan with every borrower's installments: what was paid, what is due now and what is still to come. */
export async function loanDetail(req, res) {
  const p = await loadLoan(req, req.params.id);
  const asOf = startOfToday();
  const borrowers = [];
  for (const line of p.lines) {
    // eslint-disable-next-line no-await-in-loop
    const st = await borrowerState(p, line, asOf);
    const next = st.left[0];
    borrowers.push({
      member: line.member, code: line.code, name: line.name, emi: money((p.schedule[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0)),
      paidCount: st.paid.length, paidAmount: money(st.totals.paid), dueCount: st.due.length, dueAmount: money(st.totals.due), overdueCount: st.schedule.filter((s) => s.overdueDays > 0).length,
      outstanding: money(st.totals.outstanding), remaining: st.left.length, next: next ? { no: next.no, dueDate: next.dueDate, amount: money(next.amountPaise) } : null,
      closed: st.left.length === 0,
      schedule: st.schedule.map((s) => ({ ...s, amount: money(s.amountPaise), amountPaise: undefined })),
    });
  }
  res.json({
    loan: {
      id: p._id, loanId: p.loanId || '', formId: p.formId, kind: p.kind, branch: p.branch ? `${p.branch.code} — ${p.branch.name}` : '', group: p.group?.code ? `${p.group.code} — ${p.group.name}` : '',
      schemeName: p.schemeName, modeLabel: p.modeLabel, installments: p.installments, rate: (p.annualRateBp || 0) / 100, paidOn: iso(p.paidOn), emiStartDate: iso(p.emiStartDate), emiEndDate: iso(p.emiEndDate),
      amount: money(p.lines[0]?.amountPaise), receiptNo: p.receiptNo,
    },
    borrowers,
    today: iso(asOf),
  });
}

const present = (e) => ({
  id: e._id, receiptNo: e.receiptNo, loanPaymentId: e.loanPayment, loanId: e.loanId || '', formId: e.formId, type: e.type, memberCode: e.memberCode, memberName: e.memberName, group: e.group || '',
  branch: e.branch?._id ? { id: e.branch._id, code: e.branch.code, name: e.branch.name } : null, installments: e.installments, amount: money(e.amountPaise), paidOn: iso(e.paidOn), payMode: e.payMode,
  reference: e.reference || '', status: e.status, cancelReason: e.cancelReason || '', createdByCode: e.createdByCode || '', createdAt: e.createdAt,
  items: (e.items || []).map((i) => ({ no: i.no, dueDate: iso(i.dueDate), amount: money(i.amountPaise) })),
});

/**
 * Collects installments. The first unpaid installments are paid in order:
 * regular = those that are due now; advance = ahead of the due date (only once nothing is due).
 */
export async function payEmi(req, res) {
  const b = req.body || {};
  const p = await loadLoan(req, b.loan);
  const line = p.lines.find((l) => String(l.member) === String(b.member)) || (p.lines.length === 1 && !b.member ? p.lines[0] : null);
  if (!line) throw invalid({ member: 'Select the borrower' });
  const type = asString(b.type);
  if (!['regular', 'advance'].includes(type)) throw invalid({ type: 'Choose regular or advance EMI' });
  const payMode = asString(b.payMode);
  if (!['cash', 'bank', 'upi', 'cheque'].includes(payMode)) throw invalid({ payMode: 'Select how the EMI is paid' });

  const today = startOfToday();
  let paidOn = today;
  if (b.paidOn) {
    paidOn = parseDateOnly(asString(b.paidOn));
    if (!paidOn) throw invalid({ paidOn: 'Enter a valid date' });
    if (paidOn > today) throw invalid({ paidOn: 'The payment date cannot be in the future' });
    if (paidOn < p.paidOn) throw invalid({ paidOn: 'The EMI cannot be paid before the loan was paid out' });
    if (!isAdmin(req.user) && today.getTime() - paidOn.getTime() > 30 * DAY) throw invalid({ paidOn: 'The payment date cannot be older than 30 days' });
  }
  const st = await borrowerState(p, line, paidOn);
  if (!st.left.length) throw new HttpError(409, 'All installments of this loan are already paid');
  let count = Number(b.count);
  if (type === 'regular') {
    if (!st.due.length) throw new HttpError(409, 'No installment is due now. Use Advance EMI Payment to pay ahead.');
    if (b.count === undefined || b.count === '') count = st.due.length;
    if (!Number.isInteger(count) || count < 1 || count > st.due.length) throw invalid({ count: `Choose 1 to ${st.due.length} due installment${st.due.length === 1 ? '' : 's'}` });
  } else {
    if (st.due.length) throw new HttpError(409, `${st.due.length} installment${st.due.length === 1 ? ' is' : 's are'} due. Collect the due EMI first, then pay in advance.`);
    if (!Number.isInteger(count) || count < 1 || count > st.left.length) throw invalid({ count: `Choose 1 to ${st.left.length} installment${st.left.length === 1 ? '' : 's'} to pay in advance` });
  }
  const chosen = st.left.slice(0, count);
  const amountPaise = chosen.reduce((s, x) => s + x.amountPaise, 0);
  let doc;
  try {
    doc = await EmiPayment.create({
      receiptNo: await generateCode('emiReceipt'), loanPayment: p._id, loanId: p.loanId, formId: p.formId, branch: p.branch._id, type, member: line.member, memberCode: line.code, memberName: line.name,
      group: p.group?.code ? `${p.group.code} — ${p.group.name}` : '', installments: chosen.map((x) => x.no), items: chosen.map((x) => ({ no: x.no, dueDate: new Date(x.dueDate), amountPaise: x.amountPaise })), amountPaise,
      paidOn, payMode, reference: asString(b.reference).slice(0, 60), employeeCode: req.user.employeeCode || '', createdBy: req.user._id, createdByCode: req.user.employeeCode || '',
    });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'These installments have just been paid. Reload and try again.');
    throw err;
  }
  await doc.populate(POPULATE);
  await audit(req, { action: 'emi.pay', entity: 'EmiPayment', entityId: doc._id, after: { receiptNo: doc.receiptNo, loanId: p.loanId, member: line.code, type, installments: doc.installments, amount: amountPaise / 100 } });
  res.status(201).json({ payment: present(doc) });
}

// aggregate() does not cast strings to ids like find() does
function castBranch(f) {
  const out = { ...f };
  const oid = (x) => new mongoose.Types.ObjectId(String(x));
  if (out.branch && out.branch.$in) out.branch = { $in: out.branch.$in.map(oid) };
  else if (out.branch) out.branch = oid(out.branch);
  return out;
}

export async function listEmiPayments(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { ...branchFilter(req.user), status: req.query.status === 'cancelled' ? 'cancelled' : 'paid' };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  if (['regular', 'advance'].includes(asString(req.query.type))) filter.type = req.query.type;
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) {
    filter.paidOn = {};
    if (from) filter.paidOn.$gte = from;
    if (to) filter.paidOn.$lte = to;
  }
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ receiptNo: rx }, { loanId: rx }, { formId: rx }, { memberCode: rx }, { memberName: rx }, { group: rx }];
  }
  const [items, total, sum] = await Promise.all([
    EmiPayment.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    EmiPayment.countDocuments(filter),
    EmiPayment.aggregate([{ $match: castBranch(filter) }, { $group: { _id: null, amountPaise: { $sum: '$amountPaise' } } }]),
  ]);
  res.json({ items: items.map(present), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1), totalAmount: money(sum[0]?.amountPaise || 0) });
}

export async function getEmiPayment(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Payment not found');
  const e = await EmiPayment.findOne({ _id: req.params.id, ...branchFilter(req.user) }).populate(POPULATE);
  if (!e) throw new HttpError(404, 'Payment not found');
  res.json({ payment: present(e) });
}

/** Admin cancels an EMI collection made by mistake - only the latest one of that borrower, so the order of installments holds. */
export async function cancelEmiPayment(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Payment not found');
  const e = await EmiPayment.findOne({ _id: req.params.id, status: 'paid' });
  if (!e) throw new HttpError(404, 'Payment not found');
  const reason = asString(req.body?.reason);
  if (reason.length < 3 || reason.length > 200) throw invalid({ reason: 'Enter the reason (3–200 characters)' });
  const later = await EmiPayment.exists({ loanPayment: e.loanPayment, memberCode: e.memberCode, status: 'paid', createdAt: { $gt: e.createdAt } });
  if (later) throw new HttpError(409, 'A later EMI of this borrower exists. Cancel the latest one first.');
  e.status = 'cancelled';
  e.cancelReason = reason;
  e.cancelledAt = new Date();
  await e.save();
  await audit(req, { action: 'emi.cancel', entity: 'EmiPayment', entityId: e._id, after: { receiptNo: e.receiptNo, reason } });
  res.json({ message: 'EMI payment cancelled' });
}

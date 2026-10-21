import { assertDayOpen } from '../services/dayOpen.js';
import { readBankAccount } from '../services/bankAccountPick.js';
import mongoose from 'mongoose';
import { LoanPayment, PAYMENT_MODES } from '../models/LoanPayment.js';
import { LoanRequisition } from '../models/LoanRequisition.js';
import { StockProduct } from '../models/StockProduct.js';
import { generateCode } from '../services/codeSequence.js';
import { MODES, calculateLoan } from '../services/loanCalculator.js';
import { LoanScheme } from '../models/LoanScheme.js';
import { Group } from '../models/Group.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { asString, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { branchFilter, isAdmin } from './groupController.js';
import { reserveStock, releaseStock } from './loanRequisitionController.js';

const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const POPULATE = [{ path: 'branch', select: 'code name' }];
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const money = (p) => (p === undefined || p === null ? null : p / 100);
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const DAY = 24 * 3600 * 1000;

async function loadApproved(req, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Loan not found');
  const r = await LoanRequisition.findOne({ _id: id, isDeleted: false, ...branchFilter(req.user) });
  if (!r) throw new HttpError(404, 'Loan not found');
  if (r.status !== 'approved') throw new HttpError(409, 'Only an approved loan can be paid');
  if (r.disbursedAt) throw new HttpError(409, 'This loan has already been paid');
  return r;
}

/** Borrowers of the loan with their id, code and name (a group loan has one per member). */
function borrowersOf(r) {
  if ((r.kind || 'personal') === 'group') {
    return (r.members || []).map((id, i) => ({ id, code: r.groupInfo?.members?.[i]?.code || '', name: r.groupInfo?.members?.[i]?.name || '' }));
  }
  return [{ id: r.member, code: r.borrower?.code, name: r.borrower?.name }];
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const isoWeekday = (d) => ((d.getUTCDay() + 6) % 7) + 1; // Monday 1 … Sunday 7, the way a group stores its collection day
const addDaysTo = (d, n) => new Date(d.getTime() + n * DAY);

/**
 * A weekly group collects on one weekday and a monthly group on one day of the month: the installments of a loan in that mode
 * fall on that day. Daily groups, and every loan that is not a group loan, have no such day.
 */
async function collectionRule(r) {
  if ((r.kind || 'personal') !== 'group' || !r.group) return null;
  const g = await Group.findById(r.group).select('meetingType collectionDay');
  if (!g || !g.collectionDay) return null;
  if (g.meetingType === 'weekly' && r.mode === 'weekly') return { type: 'weekday', day: g.collectionDay, label: WEEKDAY[g.collectionDay % 7] };
  if (g.meetingType === 'monthly' && r.mode === 'monthly') return { type: 'monthday', day: g.collectionDay, label: `day ${g.collectionDay} of the month` };
  return null;
}

/** The first date on or after `date` that falls on the group's collection day. */
function snapToRule(date, rule) {
  if (!rule) return date;
  if (rule.type === 'weekday') return addDaysTo(date, (rule.day - isoWeekday(date) + 7) % 7);
  const same = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), rule.day));
  return same >= date ? same : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, rule.day));
}

// Sunday is a holiday: no installment starts on a Sunday, unless the group itself meets on Sundays.
const sundayOk = (rule) => rule?.type === 'weekday' && rule.day === 7;
const isSunday = (d) => d.getUTCDay() === 0;

/** The first date on or after `date` that a first installment may fall on. */
function firstValid(date, rule) {
  let d = snapToRule(date, rule);
  if (isSunday(d) && !sundayOk(rule)) d = addDaysTo(d, 1); // a monthly collection day on a Sunday moves to the Monday
  return d;
}

/** Is this date one the first installment may fall on? */
function isValidStart(d, rule) {
  if (!rule) return !isSunday(d);
  if (rule.type === 'weekday') return isoWeekday(d) === rule.day;
  if (isSunday(d)) return false;
  if (d.getUTCDate() === rule.day) return true;
  const before = addDaysTo(d, -1);
  return d.getUTCDay() === 1 && isSunday(before) && before.getUTCDate() === rule.day;
}

/**
 * The first installment is one repayment period after the payment (moved on to the group's collection day when it has one, and
 * off a Sunday) and never earlier than that; the last follows from it.
 */
function emiDates(r, paidOn, startInput, rule) {
  const mode = MODES[r.mode];
  const defaultStart = firstValid(mode.next(paidOn, 1), rule);
  let start = defaultStart;
  if (startInput) {
    start = parseDateOnly(asString(startInput));
    if (!start) throw invalid({ emiStartDate: 'Enter a valid date' });
    if (start < defaultStart) throw invalid({ emiStartDate: `The first installment cannot be before ${iso(defaultStart)}` });
    if (!isValidStart(start, rule)) throw invalid({ emiStartDate: rule ? `The first installment must fall on the group's collection day (${rule.label}, not a Sunday)` : 'The first installment cannot fall on a Sunday' });
    if (start.getTime() > defaultStart.getTime() + 31 * DAY) throw invalid({ emiStartDate: 'The first installment cannot be more than a month after the usual date' });
  }
  // the dates the first installment can be chosen from
  const allowed = [];
  for (let d = defaultStart; d.getTime() <= defaultStart.getTime() + 31 * DAY && allowed.length < (rule ? 8 : 32); d = addDaysTo(d, 1)) {
    if (isValidStart(d, rule)) allowed.push(iso(d));
  }
  return { start, end: mode.next(start, Math.max(r.term - 1, 0)), defaultStart, allowed, rule };
}

/** The payment can be made on or after the loan date and the day the loan was approved, never in the future. */
const earliestPayment = (r) => {
  const approved = r.decidedAt ? parseDateOnly(iso(r.decidedAt)) : null;
  const loanDate = new Date(r.loanDate);
  return approved && approved > loanDate ? approved : loanDate;
};

function readPaidOn(req, r, input) {
  const today = startOfToday();
  let paidOn = today;
  if (input) {
    paidOn = parseDateOnly(asString(input));
    if (!paidOn) throw invalid({ paidOn: 'Enter a valid date' });
    if (paidOn > today) throw invalid({ paidOn: 'The payment date cannot be in the future' });
    if (paidOn < new Date(r.loanDate)) throw invalid({ paidOn: 'The payment cannot be before the requisition (loan) date' });
    if (paidOn < earliestPayment(r)) throw invalid({ paidOn: 'The payment cannot be before the approval date' });
    if (!isAdmin(req.user) && today.getTime() - paidOn.getTime() > 30 * DAY) throw invalid({ paidOn: 'The payment date cannot be older than 30 days' });
  }
  return paidOn;
}

/** Everything the payment screen shows: the deductions, the dates and the products (stock) that can be added. */
export async function preparePayment(req, res) {
  const r = await loadApproved(req, req.params.id);
  const paidOn = readPaidOn(req, r, req.query.paidOn);
  const { start, end, defaultStart, allowed, rule } = emiDates(r, paidOn, req.query.emiStartDate, await collectionRule(r));
  const kind = r.kind || 'personal';
  const stock = kind === 'product' ? [] : await StockProduct.find({ isDeleted: false, isActive: true, stockQty: { $gt: 0 }, branch: r.branch }).sort({ name: 1 });
  const charges = (r.processingFeePaise || 0) + (r.insuranceFeePaise || 0) + (r.securityAmountPaise || 0);
  const goods = kind === 'product' ? (r.product?.unitPricePaise || 0) * (r.product?.quantity || 0) : 0;
  res.json({
    requisition: {
      id: r._id, formId: r.formId, kind, loanDate: iso(r.loanDate), schemeName: r.schemeName, mode: r.mode, modeLabel: MODES[r.mode]?.label || r.mode,
      term: r.term, rate: r.annualRateBp / 100, emi: money(r.installmentPaise), group: r.groupInfo?.code ? `${r.groupInfo.code} — ${r.groupInfo.name}` : '',
      subject: kind === 'group' ? `${r.groupInfo?.code} — ${r.groupInfo?.name}` : `${r.borrower?.code} — ${r.borrower?.name}`,
    },
    dates: {
      paidOn: iso(paidOn), emiStartDate: iso(start), emiEndDate: iso(end), defaultEmiStartDate: iso(defaultStart), minPaidOn: iso(earliestPayment(r)),
      // the first installment is chosen from these dates when the group collects on a fixed day, otherwise from the usual date onwards
      allowedEmiStartDates: allowed, collectionDay: rule ? rule.label : '',
    },
    lines: borrowersOf(r).map((b) => ({
      member: b.id, code: b.code, name: b.name, amount: money(r.amountPaise), processingFee: money(r.processingFeePaise || 0), insuranceFee: money(r.insuranceFeePaise || 0),
      security: money(r.securityAmountPaise || 0), product: money(goods), cash: money(r.amountPaise - charges - goods),
    })),
    productLoan: kind === 'product' ? { name: r.product?.name, quantity: r.product?.quantity, value: money(goods) } : null,
    stock: stock.map((p) => ({ id: p._id, code: p.code, name: p.name, category: p.category, unitPrice: p.unitPricePaise / 100, stockQty: p.stockQty })),
  });
}

const present = (p) => ({
  id: p._id,
  receiptNo: p.receiptNo,
  loanId: p.loanId || '',
  requisitionId: p.requisition?._id || p.requisition,
  formId: p.formId,
  kind: p.kind,
  branch: p.branch?._id ? { id: p.branch._id, code: p.branch.code, name: p.branch.name } : null,
  group: p.group?.code ? `${p.group.code} — ${p.group.name}` : '',
  paidOn: iso(p.paidOn),
  emiStartDate: iso(p.emiStartDate),
  emiEndDate: iso(p.emiEndDate),
  installments: p.installments,
  modeLabel: p.modeLabel,
  schemeName: p.schemeName,
  rate: (p.annualRateBp || 0) / 100,
  emi: money(p.installmentPaise),
  payMode: p.payMode,
  reference: p.reference || '',
  status: p.status,
  cancelReason: p.cancelReason || '',
  totalAmount: money(p.totalAmountPaise),
  totalCash: money(p.totalCashPaise),
  createdByCode: p.createdByCode || '',
  createdAt: p.createdAt,
  lines: p.lines.map((l) => ({
    loanId: p.loanId || '', formId: p.formId, rate: (p.annualRateBp || 0) / 100, schemeName: p.schemeName, installments: p.installments, modeLabel: p.modeLabel, emi: money(p.installmentPaise + (l.extraEmiPaise || 0)), emiStartDate: iso(p.emiStartDate), emiEndDate: iso(p.emiEndDate), receiptNo: p.receiptNo,
    code: l.code, name: l.name, amount: money(l.amountPaise), processingFee: money(l.processingFeePaise), insuranceFee: money(l.insuranceFeePaise), security: money(l.securityPaise),
    product: money(l.productPaise), products: (l.products || []).map((x) => ({ name: x.name, quantity: x.quantity, unitPrice: money(x.unitPricePaise) })), cash: money(l.cashPaise),
  })),
});

/** Pays an approved loan: the deductions are taken off, products added at payment time come out of the branch stock. */
async function pay(req, r, b) {
  const kind = r.kind || 'personal';
  const paidOn = readPaidOn(req, r, b.paidOn);
  await assertDayOpen(r.branch?._id || r.branch, paidOn);
  const { start, end } = emiDates(r, paidOn, b.emiStartDate, await collectionRule(r));
  const payMode = asString(b.payMode);
  if (!PAYMENT_MODES.includes(payMode)) throw invalid({ payMode: 'Select how the loan is paid' });
  const bankAccount = await readBankAccount(b, payMode);

  const borrowers = borrowersOf(r);
  const items = Array.isArray(b.items) ? b.items : [];
  if (kind === 'product' && items.length) throw invalid({ items: 'The goods of a product loan are already part of the loan' });
  const charges = (r.processingFeePaise || 0) + (r.insuranceFeePaise || 0) + (r.securityAmountPaise || 0);
  const goods = kind === 'product' ? (r.product?.unitPricePaise || 0) * (r.product?.quantity || 0) : 0;

  const lines = borrowers.map((x) => ({
    member: x.id, code: x.code, name: x.name, amountPaise: r.amountPaise, processingFeePaise: r.processingFeePaise || 0, insuranceFeePaise: r.insuranceFeePaise || 0,
    securityPaise: r.securityAmountPaise || 0, productPaise: goods, products: kind === 'product' && r.product?.code ? [{ code: r.product.code, name: r.product.name, unitPricePaise: r.product.unitPricePaise, quantity: r.product.quantity }] : [],
    cashPaise: r.amountPaise - charges - goods,
    // a product taken on top of a group loan is repaid with the installments of that member
    extraEmiPaise: (r.additionalProducts || []).filter((a) => String(a.member) === String(x.id)).reduce((s, a) => s + (a.installmentPaise || 0), 0),
  }));
  const reserve = [];
  for (const it of items) {
    const line = lines.find((l) => String(l.member) === String(it?.member || (kind === 'group' && borrowers.length > 1 ? '' : borrowers[0].id)));
    if (!line) throw invalid({ items: kind === 'group' ? 'Choose the member for every product' : 'Product is not valid' });
    if (!mongoose.isValidObjectId(String(it.stockProduct || ''))) throw invalid({ items: 'Select the product' });
    const p = await StockProduct.findOne({ _id: it.stockProduct, isDeleted: false, isActive: true, branch: r.branch });
    if (!p) throw invalid({ items: 'A chosen product is not available in this branch' });
    const qty = Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1) throw invalid({ items: `Enter the number of units of ${p.name}` });
    const value = p.unitPricePaise * qty;
    if (value > line.cashPaise) throw invalid({ items: `${line.code}: ${p.name} (₹${value / 100}) is more than the balance cash ₹${line.cashPaise / 100}` });
    line.productPaise += value;
    line.cashPaise -= value;
    line.products.push({ code: p.code, name: p.name, unitPricePaise: p.unitPricePaise, quantity: qty });
    reserve.push({ id: p._id, qty, name: p.name });
  }
  if (kind !== 'product' && lines.some((l) => l.cashPaise < 0)) throw invalid({ amount: 'The charges are more than the loan amount' });

  // Take the loan out of the pending list first (so it cannot be paid twice), then the goods out of stock.
  const claimed = await LoanRequisition.updateOne({ _id: r._id, disbursedAt: { $exists: false }, status: 'approved' }, { $set: { disbursedAt: new Date() } });
  if (!claimed.modifiedCount) throw new HttpError(409, 'This loan has already been paid');
  // The installment schedule (amounts from the loan engine, due dates from the first installment date).
  const scheme = await LoanScheme.findById(r.scheme).select('installmentRounding');
  const sched = calculateLoan({
    principalPaise: r.amountPaise, annualRateBp: r.annualRateBp, calculationType: r.calculationType, emiType: r.emiType || 'equal', mode: r.mode, term: r.term, startDate: paidOn,
    roundingPaise: (scheme?.installmentRounding ?? 1) * 100,
  }).schedule.map((s) => ({ no: s.no, dueDate: MODES[r.mode].next(start, s.no - 1), installmentPaise: s.installment, principalPaise: s.principal, interestPaise: s.interest }));
  let reserved = [];
  let doc;
  try {
    reserved = await reserveStock(reserve);
    doc = await LoanPayment.create({
      receiptNo: await generateCode('loanReceipt'),
      loanId: await generateCode('loan'),
      schedule: sched,
      requisition: r._id, formId: r.formId, kind, branch: r.branch,
      group: r.groupInfo?.code ? { code: r.groupInfo.code, name: r.groupInfo.name } : undefined,
      paidOn, emiStartDate: start, emiEndDate: end, installments: r.term, modeLabel: MODES[r.mode]?.label || r.mode, mode: r.mode, loanType: kind === 'business' ? r.business?.loanType || 'business' : kind, schemeName: r.schemeName,
      annualRateBp: r.annualRateBp, installmentPaise: r.installmentPaise, payMode, reference: asString(b.reference).slice(0, 60), bankAccount, lines,
      totalAmountPaise: lines.reduce((s, l) => s + l.amountPaise, 0), totalCashPaise: lines.reduce((s, l) => s + l.cashPaise, 0),
      employeeCode: r.employeeCode, createdBy: req.user._id, createdByCode: req.user.employeeCode || '',
    });
  } catch (err) {
    await releaseStock(reserved);
    await LoanRequisition.updateOne({ _id: r._id }, { $unset: { disbursedAt: 1 } });
    throw err;
  }
  await doc.populate(POPULATE);
  await audit(req, { action: 'loanPayment.create', entity: 'LoanPayment', entityId: doc._id, after: { receiptNo: doc.receiptNo, formId: r.formId, totalCash: doc.totalCashPaise / 100 } });
  return doc;
}

export async function payLoan(req, res) {
  const b = req.body || {};
  const r = await loadApproved(req, b.requisition);
  const doc = await pay(req, r, b);
  res.status(201).json({ payment: present(doc) });
}

/**
 * Pays every approved, unpaid member loan of one group requisition (a batch) in one go: the same payment date, the way it is paid,
 * and (when given) the first installment date; each member's loan keeps her own scheme, installments and deductions, and
 * products can be added per member loan (items carry the member loan's requisition id). Each loan gets its own receipt.
 */
export async function payBatch(req, res) {
  const b = req.body || {};
  if (!mongoose.isValidObjectId(String(b.batchId || ''))) throw new HttpError(404, 'Batch not found');
  const docs = await LoanRequisition.find({ batchId: b.batchId, isDeleted: false, status: 'approved', disbursedAt: { $exists: false }, ...branchFilter(req.user) }).sort({ formId: 1 });
  if (!docs.length) throw new HttpError(404, 'No approved loan of this requisition is waiting for payment');
  const items = Array.isArray(b.items) ? b.items : [];
  const results = [];
  for (const r of docs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const doc = await pay(req, r, { ...b, requisition: r._id, items: items.filter((it) => String(it?.requisition) === String(r._id)) });
      results.push({ formId: r.formId, ok: true, payment: present(doc) });
    } catch (err) {
      results.push({ formId: r.formId, ok: false, message: err.errors ? Object.values(err.errors)[0] : err.message });
    }
  }
  const paid = results.filter((x) => x.ok);
  res.status(paid.length ? 201 : 200).json({ results, paidCount: paid.length, failedCount: results.length - paid.length, totalCash: paid.reduce((t, x) => t + x.payment.totalCash, 0) });
}

export async function listPayments(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const status = asString(req.query.status);
  filter.status = status === 'cancelled' ? 'cancelled' : 'paid';
  if (['personal', 'group', 'business', 'product'].includes(asString(req.query.kind))) filter.kind = req.query.kind;
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
    filter.$or = [{ receiptNo: rx }, { loanId: rx }, { formId: rx }, { 'lines.code': rx }, { 'lines.name': rx }, { 'group.code': rx }, { 'group.name': rx }];
  }
  const [items, total] = await Promise.all([
    LoanPayment.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    LoanPayment.countDocuments(filter),
  ]);
  res.json({ items: items.map(present), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

export async function getPayment(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Payment not found');
  const p = await LoanPayment.findOne({ _id: req.params.id, ...branchFilter(req.user) }).populate(POPULATE);
  if (!p) throw new HttpError(404, 'Payment not found');
  res.json({ payment: present(p) });
}

/** Admin cancels a payment made by mistake: the loan goes back to Pending Payment and the products return to stock. */
export async function cancelPayment(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Payment not found');
  const p = await LoanPayment.findOne({ _id: req.params.id, status: 'paid' });
  if (!p) throw new HttpError(404, 'Payment not found');
  const reason = asString(req.body?.reason);
  if (reason.length < 3 || reason.length > 200) throw invalid({ reason: 'Enter the reason (3–200 characters)' });
  if (await EmiPayment.exists({ loanPayment: p._id, status: 'paid' })) throw new HttpError(409, 'EMI has already been collected on this loan, so the payment cannot be cancelled.');
  p.status = 'cancelled';
  p.cancelReason = reason;
  p.cancelledAt = new Date();
  await p.save();
  await LoanRequisition.updateOne({ _id: p.requisition }, { $unset: { disbursedAt: 1 } });
  // Only goods added at payment time go back; the goods of a product loan belong to the requisition itself.
  if (p.kind !== 'product') {
    const back = p.lines.flatMap((l) => l.products || []);
    await Promise.all(back.map((x) => StockProduct.updateOne({ code: x.code }, { $inc: { stockQty: x.quantity } })));
  }
  await audit(req, { action: 'loanPayment.cancel', entity: 'LoanPayment', entityId: p._id, after: { receiptNo: p.receiptNo, reason } });
  res.json({ message: 'Payment cancelled' });
}

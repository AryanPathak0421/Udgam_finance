import mongoose from 'mongoose';
import { LoanPayment } from '../models/LoanPayment.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { User } from '../models/User.js';
import { LoanSettlement } from '../models/LoanSettlement.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { branchFilter, isAdmin } from './groupController.js';

const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const POPULATE = [{ path: 'branch', select: 'code name' }];
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const money = (p) => (p === undefined || p === null ? null : p / 100);
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const DAY = 24 * 3600 * 1000;
const PAY_MODES = ['cash', 'bank', 'upi', 'cheque'];
const KIND_LABEL = { personal: 'Personal', group: 'Group', business: 'Business', msme: 'MSME', product: 'Product' };
// business and MSME loans share a kind; the loan type tells them apart (older records fall back to the kind)
const loanTypeOf = (p) => p.loanType || p.kind || 'personal';
const modeOf = (p) => p.mode || String(p.modeLabel || '').toLowerCase().replace(/[^a-z]/g, '');

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

/**
 * Installments of one borrower with what was received on each (an EMI can be part paid) and what is due.
 * `received` is the sum received per installment number.
 */
function stateFrom(p, line, received, asOf) {
  const extra = line.extraEmiPaise || 0;
  const schedule = p.schedule.map((s) => {
    const amountPaise = s.installmentPaise + extra;
    const paidPaise = Math.min(received.get(s.no)?.paid || 0, amountPaise);
    const remainingPaise = amountPaise - paidPaise;
    const due = new Date(s.dueDate).getTime();
    return {
      no: s.no, dueDate: iso(s.dueDate), amountPaise, paidPaise, remainingPaise,
      status: remainingPaise === 0 ? 'paid' : due <= asOf.getTime() ? 'due' : 'upcoming',
      overdueDays: remainingPaise > 0 && due < asOf.getTime() ? Math.floor((asOf.getTime() - due) / DAY) : 0,
      receiptNo: received.get(s.no)?.receipts.join(', ') || '', paidOn: received.get(s.no)?.lastPaidOn || null, paidType: received.get(s.no)?.type || '',
    };
  });
  const sum = (arr, k) => arr.reduce((t, s) => t + s[k], 0);
  const left = schedule.filter((s) => s.remainingPaise > 0);
  const due = left.filter((s) => s.status === 'due');
  return { schedule, left, due, totals: { paid: sum(schedule, 'paidPaise'), due: sum(due, 'remainingPaise'), outstanding: sum(left, 'remainingPaise') } };
}

// What each installment of a borrower has received so far (cancelled receipts do not count).
function receivedMap(pays) {
  const map = new Map();
  pays.forEach((x) => (x.items || []).forEach((i) => {
    const cur = map.get(i.no) || { paid: 0, receipts: [], lastPaidOn: null, type: '' };
    cur.paid += i.amountPaise;
    if (!cur.receipts.includes(x.receiptNo)) cur.receipts.push(x.receiptNo);
    const when = iso(x.paidOn);
    if (!cur.lastPaidOn || when > cur.lastPaidOn) cur.lastPaidOn = when;
    cur.type = x.type;
    map.set(i.no, cur);
  }));
  return map;
}

// A settled borrower (loan or death settlement) has nothing more to pay: the unpaid installments are closed.
function applySettled(st, settled) {
  if (!settled) return st;
  const schedule = st.schedule.map((s) => (s.remainingPaise > 0 ? { ...s, status: 'settled', overdueDays: 0 } : s));
  return { schedule, left: [], due: [], totals: { ...st.totals, due: 0, outstanding: 0 }, settled };
}

export async function borrowerState(p, line, asOf) {
  const [pays, settled] = await Promise.all([
    EmiPayment.find({ loanPayment: p._id, memberCode: line.code, status: 'paid' }).select('items receiptNo paidOn type'),
    LoanSettlement.findOne({ loanPayment: p._id, memberCode: line.code, status: 'active' }).select('kind receiptNo settledOn'),
  ]);
  return applySettled(stateFrom(p, line, receivedMap(pays), asOf), settled ? { kind: settled.kind, receiptNo: settled.receiptNo, on: iso(settled.settledOn) } : null);
}

export { stateFrom, receivedMap, loadLoan, startOfToday };

const scheduleOut = (s) => ({
  no: s.no, dueDate: s.dueDate, amount: money(s.amountPaise), paid: money(s.paidPaise), remaining: money(s.remainingPaise), status: s.status, partial: s.paidPaise > 0 && s.remainingPaise > 0,
  overdueDays: s.overdueDays, receiptNo: s.receiptNo, paidOn: s.paidOn, paidType: s.paidType,
});

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
      paidCount: st.schedule.filter((s) => s.status === 'paid').length, paidAmount: money(st.totals.paid), dueCount: st.due.length, dueAmount: money(st.totals.due),
      overdueCount: st.schedule.filter((s) => s.overdueDays > 0).length, outstanding: money(st.totals.outstanding), remaining: st.left.length,
      next: next ? { no: next.no, dueDate: next.dueDate, amount: money(next.remainingPaise) } : null, closed: st.left.length === 0, settled: st.settled || null, schedule: st.schedule.map(scheduleOut),
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

function readPaidOn(req, p, input) {
  const today = startOfToday();
  if (!input) return today;
  const paidOn = parseDateOnly(asString(input));
  if (!paidOn) throw invalid({ paidOn: 'Enter a valid date' });
  if (paidOn > today) throw invalid({ paidOn: 'The payment date cannot be in the future' });
  if (paidOn < p.paidOn) throw invalid({ paidOn: 'The EMI cannot be paid before the loan was paid out' });
  if (!isAdmin(req.user) && today.getTime() - paidOn.getTime() > 30 * DAY) throw invalid({ paidOn: 'The payment date cannot be older than 30 days' });
  return paidOn;
}

/**
 * Receives `amountPaise` from one borrower: it goes to the earliest unpaid installments in order (an installment can be
 * part paid). The receipt is "regular" when only installments that are due were paid, "advance" when it reached
 * installments that are not due yet.
 */
async function receive(req, p, line, { amountPaise, count, type, paidOn, payMode, reference }) {
  const st = await borrowerState(p, line, paidOn);
  if (st.settled) throw new HttpError(409, `This loan has been settled (${st.settled.kind === 'death' ? 'death settlement' : 'loan settlement'} ${st.settled.receiptNo}). No EMI is due.`);
  if (!st.left.length) throw new HttpError(409, 'All installments of this loan are already paid');
  let pay = amountPaise;
  let kind = type;
  if (pay === undefined) {
    // by number of installments (the Loan ID screens)
    if (kind === 'regular') {
      if (!st.due.length) throw new HttpError(409, 'No installment is due now. Use Advance EMI Payment to pay ahead.');
      const c = count === undefined ? st.due.length : count;
      if (!Number.isInteger(c) || c < 1 || c > st.due.length) throw invalid({ count: `Choose 1 to ${st.due.length} due installment${st.due.length === 1 ? '' : 's'}` });
      pay = st.due.slice(0, c).reduce((s, x) => s + x.remainingPaise, 0);
    } else {
      if (st.due.length) throw new HttpError(409, `${st.due.length} installment${st.due.length === 1 ? ' is' : 's are'} due. Collect the due EMI first, then pay in advance.`);
      if (!Number.isInteger(count) || count < 1 || count > st.left.length) throw invalid({ count: `Choose 1 to ${st.left.length} installment${st.left.length === 1 ? '' : 's'} to pay in advance` });
      pay = st.left.slice(0, count).reduce((s, x) => s + x.remainingPaise, 0);
    }
  }
  if (!Number.isInteger(pay) || pay < 100) throw invalid({ amount: 'Enter the amount received (₹1 or more, up to 2 decimals)' });
  if (pay > st.totals.outstanding) throw invalid({ amount: `The borrower owes only ${money(st.totals.outstanding)}. The amount cannot be more than that.` });

  // allocate to the earliest unpaid installments
  let rest = pay;
  const items = [];
  for (const row of st.left) {
    if (rest <= 0) break;
    const take = Math.min(row.remainingPaise, rest);
    items.push({ no: row.no, dueDate: new Date(row.dueDate), amountPaise: take, notDue: row.status === 'upcoming' });
    rest -= take;
  }
  if (!kind) kind = items.some((i) => i.notDue) ? 'advance' : 'regular';
  const doc = await EmiPayment.create({
    receiptNo: await generateCode('emiReceipt'), loanPayment: p._id, loanId: p.loanId, formId: p.formId, branch: p.branch._id, type: kind, member: line.member, memberCode: line.code, memberName: line.name,
    group: p.group?.code ? `${p.group.code} — ${p.group.name}` : '', installments: items.map((i) => i.no), items: items.map(({ no, dueDate, amountPaise: a }) => ({ no, dueDate, amountPaise: a })), amountPaise: pay,
    paidOn, payMode, reference: asString(reference).slice(0, 60), employeeCode: req.user.employeeCode || '', createdBy: req.user._id, createdByCode: req.user.employeeCode || '',
  });
  // Two collectors paying the same borrower at the same moment: the later one is undone, never over-collected.
  const total = (await EmiPayment.aggregate([{ $match: { loanPayment: p._id, memberCode: line.code, status: 'paid' } }, { $group: { _id: null, t: { $sum: '$amountPaise' } } }]))[0]?.t || 0;
  const scheduled = p.schedule.reduce((s, x) => s + x.installmentPaise + (line.extraEmiPaise || 0), 0);
  if (total > scheduled) {
    await EmiPayment.deleteOne({ _id: doc._id });
    throw new HttpError(409, 'This EMI has just been received by someone else. Reload and try again.');
  }
  await doc.populate(POPULATE);
  await audit(req, { action: 'emi.pay', entity: 'EmiPayment', entityId: doc._id, after: { receiptNo: doc.receiptNo, loanId: p.loanId, member: line.code, type: kind, installments: doc.installments, amount: pay / 100 } });
  return doc;
}

const readPayMode = (v) => {
  const payMode = asString(v);
  if (!PAY_MODES.includes(payMode)) throw invalid({ payMode: 'Select how the EMI is paid' });
  return payMode;
};
const readAmount = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const a = toMinor(typeof v === 'number' ? String(v) : String(v).trim());
  if (a === null || a < 100) throw invalid({ amount: 'Enter the amount received (₹1 or more, up to 2 decimals)' });
  return a;
};

/** Collects EMI from one borrower of a loan (by amount, or by number of installments). */
export async function payEmi(req, res) {
  const b = req.body || {};
  const p = await loadLoan(req, b.loan);
  const line = p.lines.find((l) => String(l.member) === String(b.member)) || (p.lines.length === 1 && !b.member ? p.lines[0] : null);
  if (!line) throw invalid({ member: 'Select the borrower' });
  const type = asString(b.type);
  if (type && !['regular', 'advance'].includes(type)) throw invalid({ type: 'Choose regular or advance EMI' });
  const amountPaise = readAmount(b.amount);
  if (amountPaise === undefined && !type) throw invalid({ type: 'Choose regular or advance EMI' });
  const doc = await receive(req, p, line, {
    amountPaise, count: b.count === undefined || b.count === '' ? undefined : Number(b.count), type: amountPaise === undefined ? type : undefined,
    paidOn: readPaidOn(req, p, b.paidOn), payMode: readPayMode(b.payMode), reference: b.reference,
  });
  res.status(201).json({ payment: present(doc) });
}

/** Collects EMI from several borrowers at once (the collection screens); each one is its own receipt. */
export async function collectEmi(req, res) {
  const b = req.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw invalid({ items: 'Select at least one borrower' });
  if (items.length > 100) throw invalid({ items: 'Collect up to 100 at a time' });
  const payMode = readPayMode(b.payMode);
  const results = [];
  for (const it of items) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const p = await loadLoan(req, it.loan);
      const line = p.lines.find((l) => String(l.member) === String(it.member)) || (p.lines.length === 1 && !it.member ? p.lines[0] : null);
      if (!line) throw invalid({ member: 'Select the borrower' });
      const amountPaise = readAmount(it.amount);
      if (amountPaise === undefined) throw invalid({ amount: 'Enter the amount' });
      // eslint-disable-next-line no-await-in-loop
      const doc = await receive(req, p, line, { amountPaise, paidOn: readPaidOn(req, p, b.paidOn), payMode, reference: b.reference });
      results.push({ loan: it.loan, member: it.member, ok: true, payment: present(doc) });
    } catch (err) {
      results.push({ loan: it.loan, member: it.member, ok: false, message: err.errors?.amount || err.errors?.paidOn || err.message });
    }
  }
  const paid = results.filter((r) => r.ok);
  res.status(paid.length ? 201 : 200).json({ results, paidCount: paid.length, failedCount: results.length - paid.length, totalAmount: paid.reduce((s, r) => s + r.payment.amount, 0) });
}

/**
 * The collection lists. kind=single: one row per borrower of personal / business / MSME / product loans.
 * kind=group: group loans, grouped by group with every member. Only borrowers with an EMI due on / before the date.
 */
export async function collectionList(req, res) {
  const kindScope = req.query.kind === 'group' ? 'group' : 'single';
  const asOf = req.query.date ? parseDateOnly(asString(req.query.date)) : startOfToday();
  if (!asOf) throw invalid({ date: 'Enter a valid date' });
  const filter = { status: 'paid', ...branchFilter(req.user), kind: kindScope === 'group' ? 'group' : { $in: ['personal', 'business', 'product'] } };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const loans = await LoanPayment.find(filter).populate(POPULATE).sort({ createdAt: -1 }).limit(2000);

  const staffAll = [...new Set(loans.map((l) => l.employeeCode).filter(Boolean))].sort();
  const wantStaff = asString(req.query.staff).toUpperCase();
  const wantMode = asString(req.query.mode);
  const wantType = asString(req.query.loanType);
  const q = asString(req.query.q).toLowerCase();
  const pick = loans.filter((l) => (!wantStaff || l.employeeCode === wantStaff) && (!wantMode || modeOf(l) === wantMode) && (kindScope === 'group' || !wantType || loanTypeOf(l) === wantType));

  // what has been received on each installment, for all picked loans at once
  const settledSet = new Set((await LoanSettlement.find({ loanPayment: { $in: pick.map((l) => l._id) }, status: 'active' }).select('loanPayment memberCode')).map((x) => `${x.loanPayment}|${x.memberCode}`));
  const recv = await EmiPayment.aggregate([
    { $match: { loanPayment: { $in: pick.map((l) => l._id) }, status: 'paid' } },
    { $unwind: '$items' },
    { $group: { _id: { lp: '$loanPayment', code: '$memberCode', no: '$items.no' }, paid: { $sum: '$items.amountPaise' } } },
  ]);
  const byKey = new Map();
  recv.forEach((r) => {
    const k = `${r._id.lp}|${r._id.code}`;
    if (!byKey.has(k)) byKey.set(k, new Map());
    byKey.get(k).set(r._id.no, { paid: r.paid, receipts: [] });
  });

  const rows = [];
  for (const l of pick) {
    for (const line of l.lines) {
      if (settledSet.has(`${l._id}|${line.code}`)) continue;
      const st = stateFrom(l, line, byKey.get(`${l._id}|${line.code}`) || new Map(), asOf);
      if (!st.due.length) continue;
      const text = `${l.loanId} ${l.formId} ${line.code} ${line.name} ${l.group?.code || ''} ${l.group?.name || ''}`.toLowerCase();
      if (q && !text.includes(q)) continue;
      rows.push({
        loan: l._id, loanId: l.loanId || '', formId: l.formId, kind: l.kind, loanType: loanTypeOf(l), loanTypeLabel: KIND_LABEL[loanTypeOf(l)] || loanTypeOf(l), member: line.member, code: line.code, name: line.name,
        group: l.group?.code ? { code: l.group.code, name: l.group.name } : null, branch: l.branch ? { id: l.branch._id, code: l.branch.code, name: l.branch.name } : null, employeeCode: l.employeeCode || '',
        mode: modeOf(l), modeLabel: l.modeLabel, emi: money((l.schedule[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0)), dueCount: st.due.length, dueAmount: money(st.totals.due),
        overdueDays: Math.max(...st.due.map((d) => d.overdueDays)), nextDueDate: st.due[0].dueDate, outstanding: money(st.totals.outstanding),
      });
    }
  }
  const staffNames = await User.find({ employeeCode: { $in: staffAll } }).select('name employeeCode');
  const staff = staffAll.map((c) => ({ code: c, name: staffNames.find((u) => u.employeeCode === c)?.name || '' }));
  const modes = [...new Set(loans.map(modeOf).filter(Boolean))];

  if (kindScope === 'group') {
    const groups = new Map();
    rows.forEach((r) => {
      const k = r.group.code;
      if (!groups.has(k)) groups.set(k, { code: r.group.code, name: r.group.name, branch: r.branch, employeeCode: r.employeeCode, modeLabel: r.modeLabel, members: [], dueAmount: 0 });
      const g = groups.get(k);
      g.members.push(r);
      g.dueAmount += r.dueAmount;
    });
    const list = [...groups.values()].sort((a, b) => a.code.localeCompare(b.code));
    return res.json({ groups: list, staff, modes, date: iso(asOf), totalDue: list.reduce((s, g) => s + g.dueAmount, 0) });
  }
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  rows.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.code.localeCompare(b.code));
  res.json({ items: rows.slice(skip, skip + limit), total: rows.length, page, limit, totalPages: Math.max(Math.ceil(rows.length / limit), 1), staff, modes, date: iso(asOf), totalDue: rows.reduce((s, r) => s + r.dueAmount, 0) });
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

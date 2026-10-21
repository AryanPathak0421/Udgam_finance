import { readBankAccount } from '../services/bankAccountPick.js';
import mongoose from 'mongoose';
import { EmiPayment } from '../models/EmiPayment.js';
import { LoanSettlement } from '../models/LoanSettlement.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { SecurityWithdrawal } from '../models/SecurityWithdrawal.js';
import { ProductPayment } from '../models/ProductPayment.js';
import { CashEntry, ENTRY_CATEGORIES, ENTRY_MODES } from '../models/CashEntry.js';
import { Branch } from '../models/Branch.js';
import { Ledger } from '../models/Ledger.js';
import { CivilCheck } from '../models/CivilCheck.js';
import { asString, parseDateOnly, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { isAdmin } from './groupController.js';
import { stateFrom } from './emiController.js';

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const MODES = ['cash', 'bank', 'upi', 'cheque'];
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const DAY = 24 * 3600 * 1000;

// The lines of the cashbook, in the order of the paper cashbook. `optional` lines are shown only when they have an amount;
// `memo` lines are figures for information and are not part of the totals.
const RECEIVE = [
  { key: 'daily_collection', label: 'Daily collection amount' },
  { key: 'weekly_collection', label: 'Weekly collection amount' },
  { key: 'group_other_collection', label: 'Monthly / other group collection', optional: true },
  { key: 'product_collection', label: 'Product loan collection' },
  { key: 'personal_collection', label: 'Personal loan collection' },
  { key: 'business_collection', label: 'Business loan collection' },
  { key: 'msme_collection', label: 'MSME loan collection' },
  { key: 'processing_fee', label: 'Processing fee' },
  { key: 'insurance_fee', label: 'Insurance fee' },
  { key: 'security_amount', label: 'Security amount' },
  { key: 'goods_in_kind', label: 'Goods given with loans (in kind, not cash)', optional: true },
  { key: 'daily_settlement', label: 'Daily settlement amount' },
  { key: 'weekly_settlement', label: 'Weekly settlement amount' },
  { key: 'group_other_settlement', label: 'Monthly / other group settlement', optional: true },
  { key: 'personal_settlement', label: 'Personal loan settlement' },
  { key: 'product_settlement', label: 'Product loan settlement' },
  { key: 'bm_settlement', label: 'Business / MSME settlement' },
  { key: 'cash_fund', label: 'Cash fund receive and Bank withdrawal fund' },
  { key: 'npa_receive', label: 'NPA receive' },
  { key: 'fund_transfer_in', label: 'Fund transfer from branch' },
  { key: 'security_adjust', label: 'Security adjust (against EMI, not cash)', memo: true },
  { key: 'voucher_receive', label: 'Voucher entry' },
  { key: 'civil_fee', label: 'Civil check fee' },
  { key: 'product_received', label: 'Product payment received from branches (head office)', optional: true },
];
const PAYMENT = [
  { key: 'daily_disbursement', label: 'Daily disbursement' },
  { key: 'weekly_disbursement', label: 'Weekly disbursement' },
  { key: 'group_other_disbursement', label: 'Monthly / other group disbursement', optional: true },
  { key: 'product_disbursement', label: 'Product loan disbursement' },
  { key: 'personal_disbursement', label: 'Personal loan disbursement' },
  { key: 'msme_disbursement', label: 'MSME loan disbursement' },
  { key: 'business_disbursement', label: 'Business loan disbursement' },
  { key: 'daily_due', label: 'Daily today due' },
  { key: 'weekly_due', label: 'Weekly today due' },
  { key: 'product_due', label: 'Product today due' },
  { key: 'personal_due', label: 'Personal today due' },
  { key: 'bm_due', label: 'MSME / Business today due' },
  { key: 'leader_commission', label: 'Group leader commission' },
  { key: 'security_return', label: 'Security return' },
  { key: 'bank_deposit', label: 'Bank deposit' },
  { key: 'cash_deposit', label: 'Cash deposit' },
  { key: 'product_balance_deposit', label: 'Product balance deposit' },
  { key: 'fund_transfer', label: 'Fund transfer to' },
  { key: 'staff_salary', label: 'Staff salary paid' },
  { key: 'other_payment', label: 'Other' },
];
export const CATEGORY_LABEL = new Map([...RECEIVE, ...PAYMENT].map((x) => [x.key, x.label]));
const KNOWN = new Set([...RECEIVE, ...PAYMENT].map((x) => x.key));

// Which cashbook line a loan belongs to: group loans by how they are collected (daily / weekly), the others by their type.
const groupMode = (l) => (l.mode === 'daily' ? 'daily' : l.mode === 'weekly' ? 'weekly' : 'group_other');
const typeOf = (l) => l.loanType || l.kind || 'personal';
const collectionKey = (l) => (l.kind === 'group' ? `${groupMode(l)}_collection` : typeOf(l) === 'business' ? 'business_collection' : typeOf(l) === 'msme' ? 'msme_collection' : `${typeOf(l)}_collection`);
const settlementKey = (l) => (l.kind === 'group' ? `${groupMode(l)}_settlement` : ['business', 'msme'].includes(typeOf(l)) ? 'bm_settlement' : `${typeOf(l)}_settlement`);
const disbursementKey = (l) => (l.kind === 'group' ? `${groupMode(l)}_disbursement` : `${typeOf(l)}_disbursement`);
const dueKey = (l) => (l.kind === 'group' ? (l.mode === 'weekly' ? 'weekly_due' : 'daily_due') : ['business', 'msme'].includes(typeOf(l)) ? 'bm_due' : `${typeOf(l)}_due`);

/**
 * Cashbook of one branch, of head office, or of everything (admin): the receive side and the payment side, line by line, with the
 * opening balance, the totals and the closing balance. Product payments a branch makes show on its payment side; once the admin
 * receives them they show on the head-office receive side. Entries typed in by hand (cash fund, NPA, voucher, deposits, salary ...) are included.
 */
export async function cashbook(req, res) {
  const { _rows, ...data } = await cashbookData(req, req.query);
  res.json(data);
}

/** The cashbook figures; _rows are the raw lines (paise) of the period and of everything before it, for the books built on top of it. */
export async function cashbookData(req, query) {
  const admin = isAdmin(req.user);
  const wanted = asString(query.branch);
  let scope; // { branch } filter for branch entries; head: whether head-office entries are included
  let head;
  if (wanted === 'ho') {
    if (!admin) throw new HttpError(403, 'Only the admin can see the head-office cashbook');
    scope = { branch: { $in: [] } };
    head = true;
  } else if (mongoose.isValidObjectId(wanted)) {
    if (!admin && !(req.user.branches || []).some((b) => String(b) === wanted)) throw new HttpError(403, 'You can only see the cashbook of your own branches');
    scope = { branch: new mongoose.Types.ObjectId(wanted) };
    head = false;
  } else {
    scope = admin ? {} : { branch: { $in: (req.user.branches || []).map((b) => new mongoose.Types.ObjectId(String(b))) } };
    head = admin;
  }
  const from = parseDateOnly(asString(query.from));
  const to = parseDateOnly(asString(query.to));
  const mode = MODES.includes(asString(query.mode)) ? asString(query.mode) : '';
  const range = (field, before) => {
    if (before) return from ? { [field]: { $lt: from } } : null; // opening balance: everything before the from date
    const r = {};
    if (from) r.$gte = from;
    if (to) r.$lte = to;
    return Object.keys(r).length ? { [field]: r } : {};
  };
  // for a field that holds a time of day (not just a date): the to date is included until the end of that day
  const stampRange = (field, before) => {
    if (before) return from ? { [field]: { $lt: from } } : null;
    const r = {};
    if (from) r.$gte = from;
    if (to) r.$lt = new Date(to.getTime() + DAY);
    return Object.keys(r).length ? { [field]: r } : {};
  };
  const modeFilter = (field) => (mode ? { [field]: mode } : {});
  const ids = {}; // branch names for the particulars
  const nameOf = async (id) => {
    if (!id) return 'Head office';
    const k = String(id);
    if (!ids[k]) {
      const b = await Branch.findById(id).select('code');
      ids[k] = b?.code || 'Branch';
    }
    return ids[k];
  };
  // hand-made entries of head office are included whenever head-office entries are
  const entryScope = head ? { $or: [scope, { branch: null }] } : scope;

  async function collect(before) {
    const r = range('paidOn', before);
    const s = range('settledOn', before);
    const rv = range('receivedOn', before);
    if (before && !r) return [];
    const rows = []; // { side, cat, date, particulars, ref, mode, amount (paise), branchId, memo? }
    const add = (side, cat, row) => rows.push({ side, cat, ...row });
    const nameOfMember = (x) => `${x.memberCode} ${x.memberName || ''}`.trim();

    // what kind of loan each EMI / settlement belongs to
    const emis = await EmiPayment.find({ ...scope, status: 'paid', legacy: { $ne: true }, ...(mode ? { payMode: mode } : {}), ...r }).limit(20000).lean();
    const sets = await LoanSettlement.find({ ...scope, kind: 'loan', status: 'active', amountPaise: { $gt: 0 }, ...modeFilter('payMode'), ...s }).limit(20000).lean();
    const loanIds = [...new Set([...emis.map((e) => String(e.loanPayment)), ...sets.map((x) => String(x.loanPayment))])];
    const loanInfo = new Map((await LoanPayment.find({ _id: { $in: loanIds } }).select('kind loanType mode')).map((l) => [String(l._id), l]));
    // EMI collected; the security amount put against an EMI is not cash (shown for information)
    emis.forEach((e) => {
      const l = loanInfo.get(String(e.loanPayment));
      if (!l) return;
      const memo = e.payMode === 'security';
      add('receive', memo ? 'security_adjust' : collectionKey(l), { date: iso(e.paidOn), particulars: `${e.type === 'advance' ? 'Advance EMI' : 'EMI'} — ${nameOfMember(e)}`, ref: `${e.receiptNo} · ${e.loanId || e.formId}`, mode: e.payMode, bank: e.bankAccount, amount: e.amountPaise, branchId: e.branch, memo });
    });
    sets.forEach((x) => {
      const l = loanInfo.get(String(x.loanPayment));
      if (!l) return;
      add('receive', settlementKey(l), { date: iso(x.settledOn), particulars: `Loan settlement — ${nameOfMember(x)}`, ref: `${x.receiptNo} · ${x.loanId || x.formId}`, mode: x.payMode, bank: x.bankAccount, amount: x.amountPaise, branchId: x.branch });
    });

    // loans paid out: the loan amount is paid; the fees and the security kept from it come back on the receive side, goods are given in kind
    const loans = LoanPayment.find({ ...scope, status: 'paid', ...modeFilter('payMode'), ...r }).select('-schedule').limit(20000).lean().cursor({ batchSize: 200 });
    for await (const l of loans) {
      const who = l.group?.code ? `${l.group.code} ${l.group.name}` : `${l.lines[0]?.code} ${l.lines[0]?.name || ''}`.trim();
      const base = { date: iso(l.paidOn), ref: `${l.receiptNo} · ${l.loanId || l.formId}`, mode: l.payMode, bank: l.bankAccount, branchId: l.branch };
      const sum = (f) => l.lines.reduce((t, x) => t + (x[f] || 0), 0);
      const amount = l.totalAmountPaise || sum('amountPaise');
      add('payment', disbursementKey(l), { ...base, particulars: `Loan paid — ${who}`, amount });
      if (sum('processingFeePaise') > 0) add('receive', 'processing_fee', { ...base, particulars: `Processing fee — ${who}`, amount: sum('processingFeePaise') });
      if (sum('insuranceFeePaise') > 0) add('receive', 'insurance_fee', { ...base, particulars: `Insurance fee — ${who}`, amount: sum('insuranceFeePaise') });
      if (sum('securityPaise') > 0) add('receive', 'security_amount', { ...base, particulars: `Security amount — ${who}`, amount: sum('securityPaise') });
      // a product loan is all goods; for other loans it is the goods taken at payment time
      const goods = l.kind === 'product' ? amount : sum('productPaise');
      if (goods > 0) add('receive', 'goods_in_kind', { ...base, particulars: `Goods given — ${who}`, amount: goods });
    }

    // security paid back once the member's OTP is verified (requests made before that step were paid on approval)
    const oldSec = await SecurityWithdrawal.find({ ...scope, kind: 'withdraw', status: 'approved', otpRequired: { $ne: true }, ...modeFilter('payMode'), ...stampRange('decidedAt', before) }).limit(20000);
    const newSec = await SecurityWithdrawal.find({ ...scope, kind: 'withdraw', status: 'approved', otpRequired: true, ...modeFilter('payMode'), ...stampRange('otpVerifiedAt', before) }).limit(20000);
    oldSec.forEach((w) => add('payment', 'security_return', { date: iso(w.decidedAt), particulars: `Security paid back — ${w.memberCode} ${w.memberName || ''}`.trim(), ref: w.receiptNo, mode: w.payMode, bank: w.bankAccount, amount: w.amountPaise + (w.interestPaise || 0), branchId: w.branch }));
    newSec.filter((w) => w.otpVerifiedAt).forEach((w) => add('payment', 'security_return', { date: iso(w.otpVerifiedAt), particulars: `Security paid back${w.interestPaise ? ' with interest' : ''} — ${w.memberCode} ${w.memberName || ''}`.trim(), ref: w.receiptNo, mode: w.payMode, bank: w.bankAccount, amount: w.amountPaise + (w.interestPaise || 0), branchId: w.branch }));

    // product payments: a branch pays head office (payment side); the admin receiving it is a head-office receipt
    const pays = await ProductPayment.find({ ...scope, isDeleted: false, status: { $ne: 'rejected' }, ...modeFilter('mode'), ...r }).limit(20000);
    pays.forEach((p) => add('payment', 'product_balance_deposit', { date: iso(p.paidOn), particulars: 'Product balance deposit to head office', ref: p.reference || '', mode: p.mode, bank: p.bankAccount, amount: p.amountPaise, branchId: p.branch }));
    if (head) {
      const got = await ProductPayment.find({ isDeleted: false, status: { $nin: ['paid', 'rejected'] }, ...modeFilter('mode'), ...rv }).limit(20000);
      got.forEach((p) => add('receive', 'product_received', { date: iso(p.receivedOn || p.paidOn), particulars: 'Product payment received from branch', ref: p.reference || '', mode: p.mode, bank: p.bankAccount, amount: p.amountPaise, branchId: p.branch, head: true }));
    }

    // the fee of every civil check (the amount the admin set on the Civil Check page), received in cash
    if (!mode || mode === 'cash') {
      const civil = await CivilCheck.find({ ...scope, isDeleted: false, feePaise: { $gt: 0 }, ...stampRange('createdAt', before) }).populate('member', 'code name').limit(20000);
      civil.forEach((c) => add('receive', 'civil_fee', { date: iso(c.createdAt), particulars: `Civil check fee — ${c.member?.code || ''} ${c.member?.name || ''}`.trim(), ref: c.employeeCode ? `by ${c.employeeCode}` : '', mode: 'cash', amount: c.feePaise, branchId: c.branch }));
    }

    // entries typed in by hand
    const entries = await CashEntry.find({ isDeleted: false, ...entryScope, ...modeFilter('mode'), ...range('date', before) }).limit(20000);
    entries.forEach((e) => add(e.side, e.ledger ? `ledger:${e.ledger}` : e.category, { date: iso(e.date), particulars: e.remark || '', ref: `${e.voucherNo ? `${e.voucherNo} · ` : ''}${e.enteredByCode ? `by ${e.enteredByCode}` : ''}`, mode: e.mode, bank: e.bankAccount, kind: e.kind, voucherNo: e.voucherNo, amount: e.amountPaise, branchId: e.branch, entryId: e._id, manual: true }));
    return rows;
  }

  const cur = await collect(false);
  const open = from ? await collect(true) : [];
  const counted = (rows, side) => rows.filter((r) => r.side === side && !r.memo);
  const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);
  const openingPaise = sum(counted(open, 'receive')) - sum(counted(open, 'payment'));

  // today due: the EMI still to be collected up to the end date (information, not cash)
  const asOf = to || new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const dueIds = (await LoanPayment.find({ ...scope, status: 'paid' }).select('_id').limit(20000).lean()).map((x) => x._id);
  const dueBy = new Map();
  for (let at = 0; at < dueIds.length; at += 250) {
    const idsNow = dueIds.slice(at, at + 250);
    // eslint-disable-next-line no-await-in-loop
    const dueLoans = await LoanPayment.find({ _id: { $in: idsNow } }).lean();
    // eslint-disable-next-line no-await-in-loop
    const settledSet = new Set((await LoanSettlement.find({ loanPayment: { $in: idsNow }, status: 'active' }).select('loanPayment memberCode').lean()).map((x) => `${x.loanPayment}|${x.memberCode}`));
    // eslint-disable-next-line no-await-in-loop
    const recv = await EmiPayment.aggregate([
      { $match: { loanPayment: { $in: idsNow }, status: 'paid' } },
      { $unwind: '$items' },
      { $group: { _id: { lp: '$loanPayment', code: '$memberCode', no: '$items.no' }, paid: { $sum: '$items.amountPaise' } } },
    ]);
    const byKey = new Map();
    recv.forEach((x) => {
      const k = `${x._id.lp}|${x._id.code}`;
      if (!byKey.has(k)) byKey.set(k, new Map());
      byKey.get(k).set(x._id.no, { paid: x.paid, receipts: [] });
    });
    dueLoans.forEach((l) => l.lines.forEach((line) => {
      if (settledSet.has(`${l._id}|${line.code}`)) return;
      const st = stateFrom(l, line, byKey.get(`${l._id}|${line.code}`) || new Map(), asOf);
      if (st.totals.due > 0) dueBy.set(dueKey(l), (dueBy.get(dueKey(l)) || 0) + st.totals.due);
    }));
  }
  dueBy.forEach((amount, cat) => cur.push({ side: 'payment', cat, date: iso(asOf), particulars: 'EMI due up to this date', ref: '', mode: '', amount, branchId: null }));

  // one line for every ledger of the Ledger master that has an entry in the period
  const ledgerIds = [...new Set(cur.filter((x) => x.cat.startsWith('ledger:')).map((x) => x.cat.slice(7)))];
  const ledgerNames = new Map((await Ledger.find({ _id: { $in: ledgerIds } }).select('name').lean()).map((x) => [String(x._id), x.name]));
  const ledgerDefs = (side) => ledgerIds.filter((id) => cur.some((x) => x.side === side && x.cat === `ledger:${id}`)).map((id) => ({ key: `ledger:${id}`, label: `${ledgerNames.get(id) || 'Ledger'} (ledger)` }));
  const lineOf = (def, rows) => {
    const mine = rows.filter((r) => r.cat === def.key);
    return { key: def.key, label: def.label, amount: sum(mine) / 100, count: mine.length, memo: Boolean(def.memo), optional: Boolean(def.optional) };
  };
  const recRows = cur.filter((r) => r.side === 'receive');
  const payRows = cur.filter((r) => r.side === 'payment');
  const receiveLines = [...RECEIVE, ...ledgerDefs('receive')].map((d) => lineOf(d, recRows)).filter((l) => !l.optional || l.amount > 0);
  const paymentLines = [...PAYMENT, ...ledgerDefs('payment')].map((d) => lineOf(d, payRows)).filter((l) => !l.optional || l.amount > 0);
  const recP = sum(counted(cur, 'receive'));
  const payP = sum(counted(cur, 'payment'));
  const totals = { receipts: recP / 100, payments: payP / 100, grand: (openingPaise + recP) / 100 };

  const rawRows = { cur: cur.map((x) => ({ ...x })), open };
  const detail = async (rows) => {
    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      r.branch = await nameOf(r.branchId);
      if (r.head) r.particulars = `Product payment received from ${r.branch}`;
      r.amount /= 100;
      delete r.branchId;
      delete r.head;
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  };
  return {
    _rows: rawRows,
    from: iso(from), to: iso(to), asOf: iso(asOf), opening: openingPaise / 100, receiveLines, paymentLines, totals, closing: (openingPaise + recP - payP) / 100,
    receipts: await detail(recRows), payments: await detail(payRows),
    ledgers: { receive: await ledgerOptions('credit'), payment: await ledgerOptions('debit') },
    entryCategories: { receive: RECEIVE.filter((d) => ENTRY_CATEGORIES.receive.includes(d.key)).map(({ key, label }) => ({ key, label })), payment: PAYMENT.filter((d) => ENTRY_CATEGORIES.payment.includes(d.key)).map(({ key, label }) => ({ key, label })) },
  };
}

/** A cashbook line typed in by hand (cash fund, NPA, voucher, bank / cash deposit, fund transfer, staff salary, other ...). */
// the ledgers of the Ledger master an entry can be made for: a receive entry is a credit, a payment entry a debit
export const ledgerOptions = async (type) => (await Ledger.find({ isDeleted: false, isActive: true, type }).select('name').sort({ name: 1 }).lean()).map((x) => ({ id: x._id, name: x.name }));
export async function addEntry(req, res) {
  const b = req.body || {};
  const side = asString(b.side);
  if (!['receive', 'payment'].includes(side)) throw invalid({ side: 'Choose receive or payment' });
  let category = asString(b.category);
  let ledger;
  if (asString(b.ledger)) {
    const l = mongoose.isValidObjectId(asString(b.ledger)) ? await Ledger.findOne({ _id: b.ledger, isDeleted: false, isActive: true }) : null;
    if (!l) throw invalid({ category: 'Ledger not found' });
    if (l.type !== (side === 'receive' ? 'credit' : 'debit')) throw invalid({ category: side === 'receive' ? 'A receive entry takes a credit ledger' : 'A payment entry takes a debit ledger' });
    ledger = l._id;
    category = 'ledger';
  } else if (!ENTRY_CATEGORIES[side].includes(category) || !KNOWN.has(category)) throw invalid({ category: 'Choose what this entry is for' });
  const amountPaise = toMinor(typeof b.amount === 'number' ? String(b.amount) : asString(b.amount));
  if (amountPaise === null || amountPaise < 100) throw invalid({ amount: 'Enter the amount (₹1 or more, up to 2 decimals)' });
  const mode = asString(b.mode) || 'cash';
  if (!ENTRY_MODES.includes(mode)) throw invalid({ mode: 'Select cash, bank, UPI or cheque' });
  const bankAccount = await readBankAccount(b, mode);
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  let date = today;
  if (b.date) {
    date = parseDateOnly(asString(b.date));
    if (!date) throw invalid({ date: 'Enter a valid date' });
    if (date > today) throw invalid({ date: 'The date cannot be in the future' });
    if (!isAdmin(req.user) && today.getTime() - date.getTime() > 30 * DAY) throw invalid({ date: 'The date cannot be older than 30 days' });
  }
  // which cashbook: a branch, or head office (admin only)
  let branch = null;
  const wanted = asString(b.branch);
  if (wanted === 'ho') {
    if (!isAdmin(req.user)) throw new HttpError(403, 'Only the admin can make an entry in the head-office cashbook');
  } else {
    const id = mongoose.isValidObjectId(wanted) ? wanted : (req.user.branches || []).length === 1 ? String((req.user.branches || [])[0]) : '';
    if (!id) throw invalid({ branch: 'Select the branch' });
    if (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === id)) throw new HttpError(403, 'You can only use your own branches');
    if (!(await Branch.exists({ _id: id }))) throw invalid({ branch: 'Branch not found' });
    branch = id;
  }
  const e = await CashEntry.create({ branch, date, side, category, amountPaise, mode, bankAccount, ledger, remark: asString(b.remark).slice(0, 200), enteredByCode: req.user.employeeCode || '', createdBy: req.user._id });
  await audit(req, { action: 'cashbook.entry', entity: 'CashEntry', entityId: e._id, after: { side, category, amount: amountPaise / 100, date: iso(date), branch: branch ? String(branch) : 'head office' } });
  res.status(201).json({ entry: { id: e._id, side, category, amount: amountPaise / 100, date: iso(date), mode, remark: e.remark || '' } });
}

/** Removes a hand-made entry (admin). */
export async function deleteEntry(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Entry not found');
  const e = await CashEntry.findOne({ _id: req.params.id, isDeleted: false });
  if (!e) throw new HttpError(404, 'Entry not found');
  e.isDeleted = true;
  await e.save();
  // a branch to branch transfer is two entries: both go
  if (e.transferId) await CashEntry.updateMany({ transferId: e.transferId, isDeleted: false }, { $set: { isDeleted: true } });
  await audit(req, { action: 'cashbook.entryDeleted', entity: 'CashEntry', entityId: e._id, after: { side: e.side, category: e.category, amount: e.amountPaise / 100 } });
  res.json({ message: 'Entry removed' });
}

import mongoose from 'mongoose';
import { CashEntry } from '../models/CashEntry.js';
import { Branch } from '../models/Branch.js';
import { Ledger } from '../models/Ledger.js';
import { BankAccount } from '../models/BankAccount.js';
import { Voucher } from '../models/Voucher.js';
import { generateCode } from '../services/codeSequence.js';
import { accountLabel, readBankAccount } from '../services/bankAccountPick.js';
import { asString, parseDateOnly, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { isAdmin } from './groupController.js';
import { cashbookData, ledgerOptions, CATEGORY_LABEL } from './cashbookController.js';

/**
 * Accounts: the voucher entries (payment, receive), bank deposit, bank withdraw and branch to branch transfer are entries of the cashbook
 * (they show there), and the books built on the same lines: Trial Balance, Bank Book, Day Book.
 */
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const DAY = 24 * 3600 * 1000;
const MODES = ['cash', 'bank', 'upi', 'cheque'];
const BANKISH = ['bank', 'upi', 'cheque'];
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

const KINDS = {
  payment_voucher: { seq: 'paymentVoucher', side: 'payment', ledgerType: 'debit', label: 'Payment voucher' },
  receive_voucher: { seq: 'receiveVoucher', side: 'receive', ledgerType: 'credit', label: 'Receive voucher' },
  bank_deposit: { seq: 'bankDeposit', side: 'payment', category: 'bank_deposit', bank: true, label: 'Bank deposit' },
  bank_withdraw: { seq: 'bankWithdraw', side: 'receive', category: 'cash_fund', bank: true, label: 'Bank withdraw' },
  branch_transfer: { seq: 'branchTransfer', side: 'payment', category: 'fund_transfer', label: 'Branch transfer' },
};

/** The branch an entry belongs to: null = head office (admin only). Others can only use their own branches. */
async function branchOf(req, wanted, field, { own = true } = {}) {
  const admin = isAdmin(req.user);
  if (wanted === 'ho') {
    if (!admin) throw invalid({ [field]: 'Only the admin can use head office' });
    return null;
  }
  const mine = (req.user.branches || []).map(String);
  const id = mongoose.isValidObjectId(wanted) ? wanted : mine.length === 1 && own ? mine[0] : '';
  if (!id) throw invalid({ [field]: 'Select the branch' });
  if (own && !admin && !mine.includes(String(id))) throw new HttpError(403, 'You can only use your own branches');
  if (!(await Branch.exists({ _id: id }))) throw invalid({ [field]: 'Branch not found' });
  return id;
}
const branchName = async (id) => (id ? (await Branch.findById(id).select('code name').lean()) : null);
const branchText = (b) => (b ? `${b.code} — ${b.name}` : 'Head office');

function readCommon(req, b) {
  const amountPaise = toMinor(typeof b.amount === 'number' ? String(b.amount) : asString(b.amount));
  if (amountPaise === null || amountPaise < 100) throw invalid({ amount: 'Enter the amount (₹1 or more, up to 2 decimals)' });
  const today = startOfToday();
  let date = today;
  if (b.date) {
    date = parseDateOnly(asString(b.date));
    if (!date) throw invalid({ date: 'Enter a valid date' });
    if (date > today) throw invalid({ date: 'The date cannot be in the future' });
    if (!isAdmin(req.user) && today.getTime() - date.getTime() > 30 * DAY) throw invalid({ date: 'The date cannot be older than 30 days' });
  }
  return { amountPaise, date, remark: asString(b.remark).slice(0, 200) };
}

/** Makes an entry of the given kind (payment voucher, receive voucher, bank deposit, bank withdraw, branch transfer). */
export const makeEntry = (kind) => async (req, res) => {
  const def = KINDS[kind];
  const b = req.body || {};
  const { amountPaise, date, remark } = readCommon(req, b);
  const period = await Voucher.findOne({ isDeleted: false, isActive: true, fromDate: { $lte: date }, toDate: { $gte: date } }).select('name').lean();
  const base = { kind, date, amountPaise, voucherPeriod: period?._id, enteredByCode: req.user.employeeCode || '', createdBy: req.user._id };
  let docs;

  if (kind === 'branch_transfer') {
    const from = await branchOf(req, asString(b.fromBranch), 'fromBranch');
    const to = await branchOf(req, asString(b.toBranch), 'toBranch', { own: false });
    if (String(from || 'ho') === String(to || 'ho')) throw invalid({ toBranch: 'Choose a different branch to transfer to' });
    const [f, t] = await Promise.all([branchName(from), branchName(to)]);
    const transferId = new mongoose.Types.ObjectId();
    docs = [
      { ...base, branch: from, counterBranch: to, transferId, side: 'payment', category: 'fund_transfer', mode: 'cash', remark: remark || `Transfer to ${branchText(t)}` },
      { ...base, branch: to, counterBranch: from, transferId, side: 'receive', category: 'fund_transfer_in', mode: 'cash', remark: remark || `Transfer from ${branchText(f)}` },
    ];
  } else if (def.bank) {
    const branch = await branchOf(req, asString(b.branch), 'branch');
    const bankAccount = await readBankAccount(b, 'bank');
    if (!bankAccount) throw invalid({ bankAccount: 'Add a bank account under Bank Account Master first, then select it here' });
    const acc = await BankAccount.findById(bankAccount).lean();
    docs = [{ ...base, branch, side: def.side, category: def.category, mode: 'cash', bankAccount, remark: remark || `${def.label} — ${accountLabel(acc)}` }];
  } else {
    const branch = await branchOf(req, asString(b.branch), 'branch');
    const l = mongoose.isValidObjectId(asString(b.ledger)) ? await Ledger.findOne({ _id: b.ledger, isDeleted: false, isActive: true }) : null;
    if (!l) throw invalid({ ledger: 'Select the ledger' });
    if (l.type !== def.ledgerType) throw invalid({ ledger: def.side === 'receive' ? 'A receive voucher takes a credit ledger' : 'A payment voucher takes a debit ledger' });
    const mode = asString(b.mode) || 'cash';
    if (!MODES.includes(mode)) throw invalid({ mode: 'Select cash, bank, UPI or cheque' });
    const bankAccount = await readBankAccount(b, mode);
    docs = [{ ...base, branch, side: def.side, category: 'ledger', ledger: l._id, mode, bankAccount, remark: remark || `${def.label} — ${l.name}` }];
  }
  // the number is taken only once everything is valid, so a refused entry does not use one up
  const voucherNo = await generateCode(def.seq);
  const made = await CashEntry.insertMany(docs.map((d) => ({ ...d, voucherNo })));
  await audit(req, { action: `accounts.${kind}`, entity: 'CashEntry', entityId: made[0]._id, after: { voucherNo, amount: amountPaise / 100, date: iso(date) } });
  res.status(201).json({ voucherNo, id: made[0]._id });
};

const present = (e) => ({
  id: e._id, voucherNo: e.voucherNo || '', date: iso(e.date), kind: e.kind, side: e.side, amount: e.amountPaise / 100, mode: e.mode, remark: e.remark || '',
  branch: e.branch ? { id: e.branch._id, code: e.branch.code, name: e.branch.name } : null, counterBranch: e.counterBranch ? { id: e.counterBranch._id, code: e.counterBranch.code, name: e.counterBranch.name } : null,
  ledger: e.ledger?.name || '', bankAccount: e.bankAccount ? accountLabel(e.bankAccount) : '', voucherMonth: e.voucherPeriod?.name || '', by: e.enteredByCode || '',
});

/** The entries of one kind, newest first. */
export async function listEntries(req, res) {
  const kind = asString(req.query.kind);
  if (!KINDS[kind]) throw invalid({ kind: 'Unknown kind' });
  const admin = isAdmin(req.user);
  const filter = { isDeleted: false, kind };
  if (kind === 'branch_transfer') filter.side = 'payment'; // one row per transfer
  const wanted = asString(req.query.branch);
  const mine = (req.user.branches || []).map((x) => new mongoose.Types.ObjectId(String(x)));
  if (wanted === 'ho') {
    if (!admin) throw new HttpError(403, 'Only the admin can see head office');
    filter.branch = null;
  } else if (mongoose.isValidObjectId(wanted)) {
    if (!admin && !mine.some((x) => String(x) === wanted)) throw new HttpError(403, 'You can only see your own branches');
    filter.branch = wanted;
  } else if (!admin) filter.branch = { $in: mine };
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const rows = await CashEntry.find(filter)
    .sort({ date: -1, createdAt: -1 })
    .limit(300)
    .populate('branch', 'code name')
    .populate('counterBranch', 'code name')
    .populate('ledger', 'name')
    .populate('bankAccount', 'bankName accountHolderName accountNumber')
    .populate('voucherPeriod', 'name');
  const items = rows.map(present);
  res.json({ items, total: items.length, sum: items.reduce((s, x) => s + x.amount, 0) });
}

export async function accountOptions(_req, res) {
  const branches = await Branch.find({ isDeleted: { $ne: true } }).select('code name').sort({ code: 1 }).lean();
  res.json({ ledgers: { credit: await ledgerOptions('credit'), debit: await ledgerOptions('debit') }, branches: branches.map((b) => ({ id: b._id, code: b.code, name: b.name })) });
}

// ---------------------------------------------------------------------------------------------------------------------------
// The books
// ---------------------------------------------------------------------------------------------------------------------------
const isDue = (r) => r.memo || /_due$/.test(r.cat); // information lines, not transactions

/** The bank side of a cashbook line: money into the bank (in), out of it (out), or none. */
function bankLeg(r) {
  if (isDue(r)) return null;
  if (r.kind === 'bank_deposit') return 'in';
  if (r.kind === 'bank_withdraw') return 'out';
  if (BANKISH.includes(r.mode)) return r.side === 'receive' ? 'in' : 'out';
  return null;
}

async function names() {
  const [branches, banks, ledgers] = await Promise.all([
    Branch.find({}).select('code name').lean(),
    BankAccount.find({ isDeleted: false }).select('bankName accountHolderName accountNumber openingAmountPaise openDate').lean(),
    Ledger.find({ isDeleted: false }).select('name type openingAmountPaise openingDate isActive').lean(),
  ]);
  return {
    branch: new Map(branches.map((b) => [String(b._id), b.code])),
    bank: new Map(banks.map((b) => [String(b._id), accountLabel(b)])),
    banks,
    ledger: new Map(ledgers.map((l) => [String(l._id), l.name])),
    ledgers,
  };
}

/** Bank Book: every transaction that went through a bank (bank, UPI, cheque, deposits and withdrawals), with a running balance. */
export async function bankBook(req, res) {
  const { _rows: rows } = await cashbookData(req, { branch: req.query.branch, from: req.query.from, to: req.query.to, skipDue: true });
  const n = await names();
  const only = mongoose.isValidObjectId(asString(req.query.bankAccount)) ? asString(req.query.bankAccount) : '';
  const keyOf = (r) => (r.bank ? String(r.bank) : '');
  const keep = (r) => (only ? keyOf(r) === only : true);
  const sign = (r) => (bankLeg(r) === 'in' ? 1 : -1);
  let opening = n.banks.filter((b) => (only ? String(b._id) === only : true)).reduce((s, b) => s + b.openingAmountPaise, 0);
  opening += rows.open.filter((r) => bankLeg(r) && keep(r)).reduce((s, r) => s + sign(r) * r.amount, 0);
  let balance = opening;
  const lines = rows.cur
    .filter((r) => bankLeg(r) && keep(r))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      const inn = bankLeg(r) === 'in';
      balance += inn ? r.amount : -r.amount;
      return {
        date: r.date, ref: r.ref || '', particulars: r.particulars || '', branch: r.branchId ? n.branch.get(String(r.branchId)) || '' : 'Head office', mode: r.kind === 'bank_deposit' ? 'Deposit' : r.kind === 'bank_withdraw' ? 'Withdraw' : r.mode, account: r.bank ? n.bank.get(String(r.bank)) || '' : 'Not specified',
        deposit: inn ? r.amount / 100 : 0, withdrawal: inn ? 0 : r.amount / 100, balance: balance / 100,
      };
    });
  const deposits = lines.reduce((s, l) => s + l.deposit, 0);
  const withdrawals = lines.reduce((s, l) => s + l.withdrawal, 0);
  res.json({
    from: iso(parseDateOnly(asString(req.query.from))), to: iso(parseDateOnly(asString(req.query.to))), opening: opening / 100, lines, totals: { deposits, withdrawals }, closing: balance / 100,
    accounts: [...n.bank.entries()].map(([id, label]) => ({ id, label })),
  });
}

/** Day Book: everything of one day, in the order it was entered, with the opening and closing balance of the day. */
export async function dayBook(req, res) {
  const date = parseDateOnly(asString(req.query.date)) || startOfToday();
  const { _rows: rows, opening } = await cashbookData(req, { branch: req.query.branch, from: iso(date), to: iso(date), skipDue: true });
  const n = await names();
  const lines = rows.cur
    .filter((r) => !isDue(r))
    .map((r) => ({
      side: r.side, ref: r.ref || '', particulars: r.particulars || CATEGORY_LABEL.get(r.cat) || '', head: CATEGORY_LABEL.get(r.cat) || (r.cat.startsWith('ledger:') ? n.ledger.get(r.cat.slice(7)) || 'Ledger' : r.cat),
      branch: r.branchId ? n.branch.get(String(r.branchId)) || '' : 'Head office', mode: r.mode, account: r.bank ? n.bank.get(String(r.bank)) || '' : '',
      receive: r.side === 'receive' ? r.amount / 100 : 0, payment: r.side === 'payment' ? r.amount / 100 : 0,
    }));
  const receipts = lines.reduce((s, l) => s + l.receive, 0);
  const payments = lines.reduce((s, l) => s + l.payment, 0);
  res.json({ date: iso(date), opening, lines, totals: { receipts, payments }, closing: opening + receipts - payments });
}

/** Trial Balance of a period: every account with its opening, debit, credit and closing. Receipts credit their account and debit cash / bank, payments the other way round. */
export async function trialBalance(req, res) {
  const { _rows: rows } = await cashbookData(req, { branch: req.query.branch, from: req.query.from, to: req.query.to, skipDue: true });
  const n = await names();
  const ORDER = { Cash: 0, Bank: 1, Ledger: 2, Account: 3 };
  const accounts = new Map();
  const get = (name, group) => {
    const k = `${group}|${name}`;
    if (!accounts.has(k)) accounts.set(k, { name, group, open: 0, dr: 0, cr: 0 });
    return accounts.get(k);
  };
  const bankName = (r) => (r.bank ? n.bank.get(String(r.bank)) || 'Bank account' : 'Bank (account not specified)');
  const post = (r, into) => {
    if (isDue(r)) return;
    const a = r.amount;
    const cash = ['Cash in hand', 'Cash'];
    const bank = [bankName(r), 'Bank'];
    const counter = BANKISH.includes(r.mode) ? bank : cash;
    const apply = (acc, dr, cr) => { const x = get(acc[0], acc[1]); if (into === 'open') x.open += dr - cr; else { x.dr += dr; x.cr += cr; } };
    if (r.kind === 'bank_deposit') { apply(bank, a, 0); apply(cash, 0, a); return; }
    if (r.kind === 'bank_withdraw') { apply(cash, a, 0); apply(bank, 0, a); return; }
    const acct = r.cat.startsWith('ledger:') ? [n.ledger.get(r.cat.slice(7)) || 'Ledger', 'Ledger'] : [CATEGORY_LABEL.get(r.cat) || r.cat, 'Account'];
    if (r.side === 'receive') { apply(counter, a, 0); apply(acct, 0, a); } else { apply(acct, a, 0); apply(counter, 0, a); }
  };
  rows.open.forEach((r) => post(r, 'open'));
  rows.cur.forEach((r) => post(r, 'cur'));
  // the opening amounts of the masters
  const to = parseDateOnly(asString(req.query.to));
  n.banks.forEach((b) => { if (!to || b.openDate <= to) get(accountLabel(b), 'Bank').open += b.openingAmountPaise; });
  n.ledgers.forEach((l) => {
    if (l.isActive === false || (to && l.openingDate > to) || !l.openingAmountPaise) return;
    get(l.name, 'Ledger').open += l.type === 'debit' ? l.openingAmountPaise : -l.openingAmountPaise;
  });
  const side = (v) => ({ dr: v > 0 ? v / 100 : 0, cr: v < 0 ? -v / 100 : 0 });
  const out = [...accounts.values()]
    .filter((a) => a.open || a.dr || a.cr)
    .sort((a, b) => ORDER[a.group] - ORDER[b.group] || a.name.localeCompare(b.name))
    .map((a) => ({ name: a.name, group: a.group, open: side(a.open), debit: a.dr / 100, credit: a.cr / 100, close: side(a.open + a.dr - a.cr) }));
  const sum = (f) => out.reduce((s, r) => s + f(r), 0);
  let openDr = sum((r) => r.open.dr);
  let openCr = sum((r) => r.open.cr);
  const diff = Math.round((openDr - openCr) * 100) / 100;
  if (diff !== 0) {
    // the opening balances of the masters do not balance by themselves: the difference is shown, so the totals agree
    const row = { name: 'Difference in opening balances', group: 'Difference', open: { dr: diff < 0 ? -diff : 0, cr: diff > 0 ? diff : 0 }, debit: 0, credit: 0, close: { dr: diff < 0 ? -diff : 0, cr: diff > 0 ? diff : 0 } };
    out.push(row);
    openDr += row.open.dr;
    openCr += row.open.cr;
  }
  const totals = { openDr, openCr, debit: sum((r) => r.debit), credit: sum((r) => r.credit), closeDr: sum((r) => r.close.dr), closeCr: sum((r) => r.close.cr) };
  res.json({ from: iso(parseDateOnly(asString(req.query.from))), to: iso(to), rows: out, totals, balanced: Math.abs(totals.closeDr - totals.closeCr) < 0.005 });
}

import mongoose from 'mongoose';
import { EmiPayment } from '../models/EmiPayment.js';
import { LoanSettlement } from '../models/LoanSettlement.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { SecurityWithdrawal } from '../models/SecurityWithdrawal.js';
import { ProductPayment } from '../models/ProductPayment.js';
import { Branch } from '../models/Branch.js';
import { asString, parseDateOnly, HttpError } from '../utils/http.js';
import { isAdmin } from './groupController.js';

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const MODES = ['cash', 'bank', 'upi', 'cheque'];

/**
 * Cashbook: money received (receipts side) and money paid (payments side) of one branch, of head office, or of everything
 * (admin). Product payments a branch makes show on its payments side; once the admin receives them they show on the
 * head-office receipts side.
 */
export async function cashbook(req, res) {
  const admin = isAdmin(req.user);
  const wanted = asString(req.query.branch);
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
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  const mode = MODES.includes(asString(req.query.mode)) ? asString(req.query.mode) : '';
  const range = (field, before) => {
    if (before) return from ? { [field]: { $lt: from } } : null; // opening balance: everything before the from date
    const r = {};
    if (from) r.$gte = from;
    if (to) r.$lte = to;
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

  async function collect(before) {
    const r = range('paidOn', before);
    const s = range('settledOn', before);
    const d = range('decidedAt', before);
    const rv = range('receivedOn', before);
    if (before && !r) return { receipts: [], payments: [] };
    const receipts = [];
    const payments = [];
    // receipts: EMI collected (not the security amount put against it) and loan settlements
    const emis = await EmiPayment.find({ ...scope, status: 'paid', payMode: mode ? mode : { $ne: 'security' }, ...r }).limit(20000);
    emis.forEach((e) => receipts.push({ date: iso(e.paidOn), particulars: `${e.type === 'advance' ? 'Advance EMI' : 'EMI'} — ${e.memberCode} ${e.memberName || ''}`.trim(), ref: `${e.receiptNo} · ${e.loanId || e.formId}`, mode: e.payMode, amount: e.amountPaise, branchId: e.branch }));
    const sets = await LoanSettlement.find({ ...scope, kind: 'loan', status: 'active', amountPaise: { $gt: 0 }, ...modeFilter('payMode'), ...s }).limit(20000);
    sets.forEach((x) => receipts.push({ date: iso(x.settledOn), particulars: `Loan settlement — ${x.memberCode} ${x.memberName || ''}`.trim(), ref: `${x.receiptNo} · ${x.loanId || x.formId}`, mode: x.payMode, amount: x.amountPaise, branchId: x.branch }));
    // payments: loans paid out, security paid back, product payments to head office
    const loans = await LoanPayment.find({ ...scope, status: 'paid', totalCashPaise: { $gt: 0 }, ...modeFilter('payMode'), ...r }).limit(20000);
    loans.forEach((l) => payments.push({ date: iso(l.paidOn), particulars: `Loan paid — ${l.group?.code ? `${l.group.code} ${l.group.name}` : `${l.lines[0]?.code} ${l.lines[0]?.name || ''}`}`.trim(), ref: `${l.receiptNo} · ${l.loanId || l.formId}`, mode: l.payMode, amount: l.totalCashPaise, branchId: l.branch }));
    const sec = await SecurityWithdrawal.find({ ...scope, kind: 'withdraw', status: 'approved', ...modeFilter('payMode'), ...d }).limit(20000);
    sec.forEach((w) => payments.push({ date: iso(w.decidedAt), particulars: `Security paid back — ${w.memberCode} ${w.memberName || ''}`.trim(), ref: w.receiptNo, mode: w.payMode, amount: w.amountPaise, branchId: w.branch }));
    const pays = await ProductPayment.find({ ...scope, isDeleted: false, status: { $ne: 'rejected' }, ...modeFilter('mode'), ...r }).limit(20000);
    pays.forEach((p) => payments.push({ date: iso(p.paidOn), particulars: 'Product payment to head office', ref: p.reference || '', mode: p.mode, amount: p.amountPaise, branchId: p.branch }));
    // head office receipts: product payments the admin has received
    if (head) {
      const got = await ProductPayment.find({ isDeleted: false, status: { $nin: ['paid', 'rejected'] }, ...(wanted === 'ho' || !scope.branch ? {} : {}), ...modeFilter('mode'), ...rv }).limit(20000);
      got.forEach((p) => receipts.push({ date: iso(p.receivedOn || p.paidOn), particulars: 'Product payment received from branch', ref: p.reference || '', mode: p.mode, amount: p.amountPaise, branchId: p.branch, head: true }));
    }
    return { receipts, payments };
  }

  const cur = await collect(false);
  const open = from ? await collect(true) : { receipts: [], payments: [] };
  const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);
  const label = async (rows) => {
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
  const openingPaise = sum(open.receipts) - sum(open.payments);
  const recP = sum(cur.receipts);
  const payP = sum(cur.payments);
  const totals = { receipts: recP / 100, payments: payP / 100 };
  const receipts = await label(cur.receipts);
  const payments = await label(cur.payments);
  res.json({
    from: iso(from), to: iso(to), opening: openingPaise / 100, receipts, payments, totals, closing: (openingPaise + recP - payP) / 100,
  });
}

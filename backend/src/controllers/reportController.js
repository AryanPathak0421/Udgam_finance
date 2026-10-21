import mongoose from 'mongoose';
import { LoanPayment } from '../models/LoanPayment.js';
import { LoanRequisition } from '../models/LoanRequisition.js';
import { LoanSettlement } from '../models/LoanSettlement.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { Member } from '../models/Member.js';
import { Branch } from '../models/Branch.js';
import { User } from '../models/User.js';
import { ReportCall } from '../models/ReportCall.js';
import { asString, parseDateOnly, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { branchFilter, showMobile } from './groupController.js';
import { dueSummary, loanDetail, loadLoan, receive, borrowerState } from './emiController.js';
import { readBankAccount } from '../services/bankAccountPick.js';
import { toMinor } from '../utils/money.js';

/**
 * The Report section: loan account ledger, requisition, approval, disbursement, due, over due, outstanding, EMI collection, member joining and NPA.
 * Every row has a "Call done" button (ReportCall): who called the borrower and when.
 */
const DAY = 24 * 3600 * 1000;
const MAX_ROWS = 5000;
const NPA_TERM = 120; // a loan of 120 days: once the 121st day has come and it is still due, it is NPA
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const rupees = (p) => (p || 0) / 100;
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

/** The branches of a request: the user's own, narrowed to the chosen one (never widened). */
function branchScope(req) {
  const filter = branchFilter(req.user);
  const wanted = asString(req.query.branch);
  if (mongoose.isValidObjectId(wanted)) {
    const own = filter.branch?.$in?.map(String);
    return own && !own.includes(wanted) ? { branch: { $in: [] } } : { branch: new mongoose.Types.ObjectId(wanted) };
  }
  return filter.branch ? { branch: { $in: filter.branch.$in.map((b) => new mongoose.Types.ObjectId(String(b))) } } : {};
}
const dateRange = (req, field) => {
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  return from || to ? { [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {};
};
const matches = (q, ...vals) => !q || vals.some((v) => String(v || '').toLowerCase().includes(q));

/** Works through every running borrower (loans in batches of 250) and hands each one's figures to `pick`. */
export async function scanBorrowers(req, asOf, pick) {
  const ids = (await LoanPayment.find({ status: 'paid', ...branchScope(req) }).sort({ createdAt: -1 }).select('_id').limit(20000).lean()).map((x) => x._id);
  const branches = new Map((await Branch.find({}).select('code name').lean()).map((b) => [String(b._id), b.code]));
  const rows = [];
  for (let at = 0; at < ids.length; at += 250) {
    const part = ids.slice(at, at + 250);
    // eslint-disable-next-line no-await-in-loop
    const [loans, recv, settled] = await Promise.all([
      LoanPayment.find({ _id: { $in: part } }).select('loanId formId kind loanType mode installments emiStartDate emiEndDate paidOn branch group schemeName employeeCode lines schedule').lean(),
      EmiPayment.aggregate([
        { $match: { loanPayment: { $in: part }, status: 'paid' } },
        { $unwind: '$items' },
        { $group: { _id: { lp: '$loanPayment', code: '$memberCode', no: '$items.no' }, paid: { $sum: '$items.amountPaise' } } },
      ]),
      LoanSettlement.find({ loanPayment: { $in: part }, status: 'active' }).select('loanPayment memberCode').lean(),
    ]);
    const byKey = new Map();
    recv.forEach((x) => {
      const k = `${x._id.lp}|${x._id.code}`;
      if (!byKey.has(k)) byKey.set(k, new Map());
      byKey.get(k).set(x._id.no, { paid: x.paid });
    });
    const closed = new Set(settled.map((x) => `${x.loanPayment}|${x.memberCode}`));
    const codes = [...new Set(loans.flatMap((l) => l.lines.map((x) => x.code)))];
    // eslint-disable-next-line no-await-in-loop
    const mobiles = new Map((await Member.find({ code: { $in: codes } }).select('code mobile').lean()).map((m) => [m.code, m.mobile]));
    for (const l of loans) {
      for (const line of l.lines) {
        const key = `${l._id}|${line.code}`;
        if (closed.has(key)) continue;
        const sum = dueSummary(l, line, byKey.get(key) || new Map(), asOf);
        const extra = line.extraEmiPaise || 0;
        const scheduled = l.schedule.reduce((s, x) => s + x.installmentPaise + extra, 0);
        const end = l.emiEndDate ? new Date(l.emiEndDate).getTime() : 0;
        const row = {
          key, loanPaymentId: l._id, loanId: l.loanId || l.formId, branch: branches.get(String(l.branch)) || '', group: l.group?.code ? `${l.group.code} — ${l.group.name}` : '',
          memberCode: line.code, memberName: line.name, mobile: showMobile(req.user, mobiles.get(line.code)), loanType: l.kind === 'group' ? 'group' : l.loanType || l.kind, scheme: l.schemeName || '',
          mode: l.mode, term: l.installments, loanAmount: rupees(line.amountPaise), emi: rupees((l.schedule[0]?.installmentPaise || 0) + extra), scheduled: rupees(scheduled),
          paid: rupees(scheduled - sum.outstandingPaise), outstanding: rupees(sum.outstandingPaise), due: rupees(sum.duePaise), dueCount: sum.dueCount, overdueDays: sum.overdueDays,
          firstDue: sum.firstDue || '', lastInstallment: iso(l.emiEndDate), daysPastEnd: end && end < asOf.getTime() ? Math.floor((asOf.getTime() - end) / DAY) : 0,
          npaTerm: l.mode === 'daily' && l.installments === NPA_TERM, staff: l.employeeCode || '',
        };
        const keep = pick(row);
        if (keep) rows.push(keep);
      }
    }
  }
  return rows;
}

const sumOf = (rows, f) => Math.round(rows.reduce((s, r) => s + (r[f] || 0), 0) * 100) / 100;
const borrowerMatch = (q) => (r) => matches(q, r.loanId, r.memberCode, r.memberName, r.group);

const REPORTS = {
  // borrowers whose installment falls due on the date and is not paid yet
  async due(req) {
    const asOf = parseDateOnly(asString(req.query.date)) || startOfToday();
    const q = asString(req.query.q).toLowerCase();
    const rows = (await scanBorrowers(req, asOf, (r) => (r.due > 0 && r.overdueDays === 0 && borrowerMatch(q)(r) ? r : null))).sort((a, b) => b.due - a.due);
    return { asOf: iso(asOf), rows, summary: { borrowers: rows.length, due: sumOf(rows, 'due') } };
  },
  // borrowers with an installment that is older than the date and still not paid
  async overdue(req) {
    const asOf = parseDateOnly(asString(req.query.date)) || startOfToday();
    const q = asString(req.query.q).toLowerCase();
    const rows = (await scanBorrowers(req, asOf, (r) => (r.overdueDays > 0 && borrowerMatch(q)(r) ? r : null))).sort((a, b) => b.overdueDays - a.overdueDays);
    return { asOf: iso(asOf), rows, summary: { borrowers: rows.length, due: sumOf(rows, 'due'), outstanding: sumOf(rows, 'outstanding') } };
  },
  // what every running borrower still has to pay
  async outstanding(req) {
    const asOf = parseDateOnly(asString(req.query.date)) || startOfToday();
    const q = asString(req.query.q).toLowerCase();
    const rows = (await scanBorrowers(req, asOf, (r) => (r.outstanding > 0 && borrowerMatch(q)(r) ? r : null))).sort((a, b) => b.outstanding - a.outstanding);
    return { asOf: iso(asOf), rows, summary: { borrowers: rows.length, loanAmount: sumOf(rows, 'loanAmount'), paid: sumOf(rows, 'paid'), outstanding: sumOf(rows, 'outstanding') } };
  },
  // a loan of 120 days whose 121st day has come and which is still due
  async npa(req) {
    const asOf = parseDateOnly(asString(req.query.date)) || startOfToday();
    const q = asString(req.query.q).toLowerCase();
    const rows = (await scanBorrowers(req, asOf, (r) => (r.npaTerm && r.outstanding > 0 && r.daysPastEnd >= 1 && borrowerMatch(q)(r) ? r : null))).sort((a, b) => b.daysPastEnd - a.daysPastEnd);
    return { asOf: iso(asOf), rows, summary: { borrowers: rows.length, outstanding: sumOf(rows, 'outstanding'), loanAmount: sumOf(rows, 'loanAmount') } };
  },
  async emiCollection(req) {
    const q = asString(req.query.q).toLowerCase();
    const pays = await EmiPayment.find({ status: 'paid', legacy: { $ne: true }, ...branchScope(req), ...dateRange(req, 'paidOn') }).sort({ paidOn: -1, createdAt: -1 }).limit(20000).populate('branch', 'code').lean();
    const rows = pays.filter((e) => matches(q, e.receiptNo, e.loanId, e.formId, e.memberCode, e.memberName, e.employeeCode)).map((e) => ({
      key: String(e._id), receiptNo: e.receiptNo, date: iso(e.paidOn), loanId: e.loanId || e.formId, memberCode: e.memberCode, memberName: e.memberName, group: e.group || '', branch: e.branch?.code || '',
      type: e.type, installments: (e.installments || []).join(', '), amount: rupees(e.amountPaise), payMode: e.payMode, collectedBy: e.employeeCode || '',
    }));
    return { rows, summary: { receipts: rows.length, amount: sumOf(rows, 'amount') } };
  },
  async disbursement(req) {
    const q = asString(req.query.q).toLowerCase();
    const loans = await LoanPayment.find({ status: 'paid', ...branchScope(req), ...dateRange(req, 'paidOn') }).sort({ paidOn: -1, createdAt: -1 }).limit(20000).select('-schedule').populate('branch', 'code').lean();
    const rows = loans.filter((l) => matches(q, l.loanId, l.formId, l.receiptNo, l.group?.name, ...l.lines.map((x) => `${x.code} ${x.name}`))).map((l) => ({
      key: String(l._id), loanId: l.loanId || l.formId, receiptNo: l.receiptNo, date: iso(l.paidOn), branch: l.branch?.code || '', loanType: l.kind === 'group' ? 'group' : l.loanType || l.kind,
      borrowers: l.group?.code ? `${l.group.code} — ${l.group.name} (${l.lines.length} members)` : l.lines.map((x) => `${x.code} ${x.name}`).join(', '), scheme: l.schemeName || '', mode: l.modeLabel || l.mode,
      installments: l.installments, amount: rupees(l.totalAmountPaise ?? l.lines.reduce((s, x) => s + (x.amountPaise || 0), 0)), cash: rupees(l.totalCashPaise), payMode: l.payMode, paidBy: l.employeeCode || '',
    }));
    return { rows, summary: { loans: rows.length, amount: sumOf(rows, 'amount'), cash: sumOf(rows, 'cash') } };
  },
  async requisition(req) {
    const q = asString(req.query.q).toLowerCase();
    const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(asString(req.query.status)) ? asString(req.query.status) : '';
    const reqs = await LoanRequisition.find({ isDeleted: false, ...branchScope(req), ...dateRange(req, 'loanDate'), ...(status ? { status } : {}) }).sort({ loanDate: -1, createdAt: -1 }).limit(20000)
      .select('kind formId batchFormId branch loanDate borrower groupInfo memberCount amountPaise totalAmountPaise schemeName mode term status employeeCode requestedAmountPaise').populate('branch', 'code').lean();
    const rows = reqs.filter((r) => matches(q, r.formId, r.batchFormId, r.borrower?.code, r.borrower?.name, r.groupInfo?.name, r.groupInfo?.code)).map((r) => ({
      key: String(r._id), formId: r.formId, date: iso(r.loanDate), branch: r.branch?.code || '', loanType: r.kind, applicant: r.kind === 'group' ? `${r.groupInfo?.code || ''} — ${r.groupInfo?.name || ''} (${r.memberCount || 0} members)` : `${r.borrower?.code || ''} ${r.borrower?.name || ''}`,
      mobile: showMobile(req.user, r.borrower?.mobile), scheme: r.schemeName || '', mode: r.mode, term: r.term, amount: rupees(r.totalAmountPaise ?? r.amountPaise), status: r.status, requestedBy: r.employeeCode || '',
    }));
    return { rows, summary: { requisitions: rows.length, amount: sumOf(rows, 'amount') } };
  },
  async approval(req) {
    const q = asString(req.query.q).toLowerCase();
    const status = ['approved', 'rejected'].includes(asString(req.query.status)) ? asString(req.query.status) : '';
    const reqs = await LoanRequisition.find({ isDeleted: false, status: status || { $in: ['approved', 'rejected'] }, ...branchScope(req), ...dateRange(req, 'decidedAt') }).sort({ decidedAt: -1 }).limit(20000)
      .select('kind formId branch borrower groupInfo memberCount amountPaise totalAmountPaise requestedAmountPaise schemeName requestedSchemeName status decidedAt decidedByCode rejectReason disbursedAt').populate('branch', 'code').lean();
    const rows = reqs.filter((r) => matches(q, r.formId, r.borrower?.code, r.borrower?.name, r.groupInfo?.name, r.groupInfo?.code)).map((r) => ({
      key: String(r._id), formId: r.formId, date: iso(r.decidedAt), branch: r.branch?.code || '', loanType: r.kind, applicant: r.kind === 'group' ? `${r.groupInfo?.code || ''} — ${r.groupInfo?.name || ''} (${r.memberCount || 0} members)` : `${r.borrower?.code || ''} ${r.borrower?.name || ''}`,
      mobile: showMobile(req.user, r.borrower?.mobile), scheme: r.schemeName || '', requested: rupees(r.requestedAmountPaise ?? r.amountPaise), amount: rupees(r.totalAmountPaise ?? r.amountPaise), status: r.status, decidedBy: r.decidedByCode || '',
      reason: r.rejectReason || '', paidOut: r.disbursedAt ? iso(r.disbursedAt) : '',
    }));
    return { rows, summary: { decided: rows.length, approved: rows.filter((r) => r.status === 'approved').length, rejected: rows.filter((r) => r.status === 'rejected').length, amount: sumOf(rows.filter((r) => r.status === 'approved'), 'amount') } };
  },
  async memberJoining(req) {
    const q = asString(req.query.q).toLowerCase();
    const members = await Member.find({ ...branchScope(req), ...dateRange(req, 'joiningDate') }).sort({ joiningDate: -1, createdAt: -1 }).limit(20000).select('code name mobile branch joiningDate employeeCode gender district legacyImport').populate('branch', 'code').lean();
    const rows = members.filter((m) => matches(q, m.code, m.name, m.mobile)).map((m) => ({
      key: String(m._id), memberCode: m.code, memberName: m.name, mobile: showMobile(req.user, m.mobile), branch: m.branch?.code || '', date: iso(m.joiningDate), gender: m.gender || '', district: m.district || '', registeredBy: m.employeeCode || '', fromOldSystem: Boolean(m.legacyImport),
    }));
    return { rows, summary: { members: rows.length } };
  },
};
const isNpa = (r) => r.npaTerm && r.outstanding > 0 && r.daysPastEnd >= 1;
const staffNames = async (codes) => new Map((await User.find({ employeeCode: { $in: codes } }).select('employeeCode name').lean()).map((u) => [u.employeeCode, u.name]));
const rowsByStaff = async (map) => {
  const names = await staffNames([...map.keys()].filter(Boolean));
  return [...map.entries()].map(([code, v]) => ({ key: code || 'none', staff: code || 'Not recorded', staffName: names.get(code) || '', ...v })).sort((a, b) => (b.amount ?? b.outstanding ?? 0) - (a.amount ?? a.outstanding ?? 0));
};
const collectionSheet = (match) => async (req) => {
  const asOf = parseDateOnly(asString(req.query.date)) || startOfToday();
  const q = asString(req.query.q).toLowerCase();
  const rows = (await scanBorrowers(req, asOf, (r) => (match(r) && r.due > 0 && borrowerMatch(q)(r) ? r : null))).sort((a, b) => b.overdueDays - a.overdueDays || a.loanId.localeCompare(b.loanId));
  return { asOf: iso(asOf), rows, summary: { borrowers: rows.length, due: sumOf(rows, 'due'), outstanding: sumOf(rows, 'outstanding') } };
};

Object.assign(REPORTS, {
  personalCollectionSheet: collectionSheet((r) => r.loanType === 'personal'),
  msmeCollectionSheet: collectionSheet((r) => ['business', 'msme'].includes(r.loanType)),
  // balance given up: death settlements, automatic settlements and loan settlements with a waiver
  async writeOff(req) {
    const q = asString(req.query.q).toLowerCase();
    const kind = ['death', 'auto', 'loan'].includes(asString(req.query.status)) ? asString(req.query.status) : '';
    const sets = await LoanSettlement.find({ status: 'active', waiverPaise: { $gt: 0 }, ...(kind ? { kind } : {}), ...branchScope(req), ...dateRange(req, 'settledOn') }).sort({ settledOn: -1 }).limit(20000).populate('branch', 'code').lean();
    const rows = sets.filter((x) => matches(q, x.receiptNo, x.loanId, x.formId, x.memberCode, x.memberName, x.group)).map((x) => ({
      key: String(x._id), receiptNo: x.receiptNo, date: iso(x.settledOn), kind: x.kind, loanId: x.loanId || x.formId, memberCode: x.memberCode, memberName: x.memberName, group: x.group || '', branch: x.branch?.code || '',
      outstanding: rupees(x.outstandingPaise), received: rupees(x.amountPaise), writtenOff: rupees(x.waiverPaise), remark: x.remark || x.claimRef || '',
    }));
    return { rows, summary: { loans: rows.length, outstanding: sumOf(rows, 'outstanding'), received: sumOf(rows, 'received'), writtenOff: sumOf(rows, 'writtenOff') } };
  },
  async staffNpa(req) {
    const asOf = parseDateOnly(asString(req.query.date)) || startOfToday();
    const list = await scanBorrowers(req, asOf, (r) => (isNpa(r) ? r : null));
    const by = new Map();
    list.forEach((r) => {
      const v = by.get(r.staff) || { borrowers: 0, loanAmount: 0, outstanding: 0, oldest: 0 };
      v.borrowers += 1; v.loanAmount += r.loanAmount; v.outstanding += r.outstanding; v.oldest = Math.max(v.oldest, r.daysPastEnd);
      by.set(r.staff, v);
    });
    const rows = await rowsByStaff(by);
    rows.forEach((r) => { r.loanAmount = Math.round(r.loanAmount * 100) / 100; r.outstanding = Math.round(r.outstanding * 100) / 100; });
    return { asOf: iso(asOf), rows, noCall: true, summary: { staff: rows.length, borrowers: sumOf(rows, 'borrowers'), outstanding: sumOf(rows, 'outstanding') } };
  },
  // what each staff member collected on NPA loans
  async staffNpaPayment(req) {
    const agg = await EmiPayment.aggregate([
      { $match: { status: 'paid', npa: true, ...branchScope(req), ...dateRange(req, 'paidOn') } },
      { $group: { _id: '$employeeCode', receipts: { $sum: 1 }, amount: { $sum: '$amountPaise' } } },
    ]);
    const by = new Map(agg.map((a) => [a._id || '', { receipts: a.receipts, amount: rupees(a.amount) }]));
    const rows = await rowsByStaff(by);
    return { rows, noCall: true, summary: { staff: rows.length, receipts: sumOf(rows, 'receipts'), amount: sumOf(rows, 'amount') } };
  },
  async staffDisbursement(req) {
    const agg = await LoanPayment.aggregate([
      { $match: { status: 'paid', ...branchScope(req), ...dateRange(req, 'paidOn') } },
      { $group: { _id: '$employeeCode', loans: { $sum: 1 }, borrowers: { $sum: { $size: '$lines' } }, amount: { $sum: { $ifNull: ['$totalAmountPaise', 0] } }, cash: { $sum: { $ifNull: ['$totalCashPaise', 0] } } } },
    ]);
    const by = new Map(agg.map((a) => [a._id || '', { loans: a.loans, borrowers: a.borrowers, amount: rupees(a.amount), cash: rupees(a.cash) }]));
    const rows = await rowsByStaff(by);
    return { rows, noCall: true, summary: { staff: rows.length, loans: sumOf(rows, 'loans'), borrowers: sumOf(rows, 'borrowers'), amount: sumOf(rows, 'amount'), cash: sumOf(rows, 'cash') } };
  },
  // per group: the EMI that fell due in the period (demand), what was collected, and the share collected (CDS: collection and demand statement)
  async groupCollection(req) {
    const from = parseDateOnly(asString(req.query.from)) || startOfToday();
    const to = parseDateOnly(asString(req.query.to)) || startOfToday();
    const q = asString(req.query.q).toLowerCase();
    const ids = (await LoanPayment.find({ status: 'paid', kind: 'group', ...branchScope(req) }).select('_id').limit(20000).lean()).map((x) => x._id);
    const branches = new Map((await Branch.find({}).select('code').lean()).map((b) => [String(b._id), b.code]));
    const groups = new Map();
    const at = (l) => {
      const k = l.group?.code ? `${l.group.code} — ${l.group.name}` : 'No group';
      if (!groups.has(k)) groups.set(k, { key: k, group: k, branch: branches.get(String(l.branch)) || '', members: new Set(), demand: 0, collected: 0 });
      return groups.get(k);
    };
    for (let i = 0; i < ids.length; i += 250) {
      // eslint-disable-next-line no-await-in-loop
      const loans = await LoanPayment.find({ _id: { $in: ids.slice(i, i + 250) } }).select('branch group lines schedule.dueDate schedule.installmentPaise').lean();
      loans.forEach((l) => {
        const g = at(l);
        const inRange = l.schedule.filter((x) => new Date(x.dueDate) >= from && new Date(x.dueDate) <= to);
        if (!inRange.length) return;
        l.lines.forEach((line) => {
          g.members.add(line.code);
          g.demand += inRange.reduce((sum, x) => sum + x.installmentPaise + (line.extraEmiPaise || 0), 0);
        });
      });
    }
    const coll = await EmiPayment.aggregate([
      { $match: { status: 'paid', legacy: { $ne: true }, group: { $ne: '' }, ...branchScope(req), paidOn: { $gte: from, $lte: to } } },
      { $group: { _id: '$group', amount: { $sum: '$amountPaise' } } },
    ]);
    coll.forEach((c) => { if (groups.has(c._id)) groups.get(c._id).collected = c.amount; else groups.set(c._id, { key: c._id, group: c._id, branch: '', members: new Set(), demand: 0, collected: c.amount }); });
    const rows = [...groups.values()].filter((g) => (g.demand || g.collected) && matches(q, g.group)).map((g) => ({
      key: g.key, group: g.group, branch: g.branch, members: g.members.size, demand: rupees(g.demand), collected: rupees(g.collected), balance: rupees(g.demand - g.collected),
      efficiency: g.demand ? Math.round((g.collected / g.demand) * 1000) / 10 : null,
    })).sort((a, b) => a.group.localeCompare(b.group));
    const demand = sumOf(rows, 'demand');
    const collected = sumOf(rows, 'collected');
    return { rows, summary: { groups: rows.length, demand, collected, balance: Math.round((demand - collected) * 100) / 100 } };
  },
});
const NAMES = { due: 'due', overdue: 'overdue', outstanding: 'outstanding', npa: 'npa', 'personal-collection-sheet': 'personalCollectionSheet', 'msme-collection-sheet': 'msmeCollectionSheet', 'write-off': 'writeOff', 'staff-npa': 'staffNpa', 'staff-npa-payment': 'staffNpaPayment', 'staff-disbursement': 'staffDisbursement', 'group-collection': 'groupCollection', 'emi-collection': 'emiCollection', disbursement: 'disbursement', requisition: 'requisition', approval: 'approval', 'member-joining': 'memberJoining' };

/** Loan account ledger: a loan ID gives the loan, every borrower's installments and every receipt. */
async function loanLedger(req) {
  const id = asString(req.query.loanId).toUpperCase();
  if (id.length < 3) throw new HttpError(422, 'Enter the Loan ID', { loanId: 'Enter the Loan ID' });
  const p = await LoanPayment.findOne({ status: 'paid', $or: [{ loanId: id }, { formId: id }, { receiptNo: id }], ...branchFilter(req.user) }).select('_id').lean();
  if (!p) throw new HttpError(404, 'No loan with this ID (or it is not in your branches)', { loanId: 'Loan not found' });
  const detail = await new Promise((resolve, reject) => {
    loanDetail({ user: req.user, params: { id: String(p._id) } }, { json: resolve }).catch(reject);
  });
  const receipts = await EmiPayment.find({ loanPayment: p._id, status: 'paid' }).sort({ paidOn: 1, createdAt: 1 }).select('receiptNo paidOn memberCode memberName amountPaise payMode type installments employeeCode').lean();
  const settled = await LoanSettlement.find({ loanPayment: p._id, status: 'active' }).select('kind receiptNo memberCode settledOn amountPaise waiverPaise').lean();
  return {
    ...detail,
    receipts: receipts.map((e) => ({ receiptNo: e.receiptNo, date: iso(e.paidOn), memberCode: e.memberCode, memberName: e.memberName, installments: (e.installments || []).join(', '), amount: rupees(e.amountPaise), payMode: e.payMode, type: e.type, by: e.employeeCode || '' })),
    settlements: settled.map((s) => ({ kind: s.kind, receiptNo: s.receiptNo, memberCode: s.memberCode, date: iso(s.settledOn), amount: rupees(s.amountPaise), waiver: rupees(s.waiverPaise) })),
  };
}

export async function report(req, res) {
  const name = asString(req.params.name);
  if (name === 'loan-ledger') return res.json(await loanLedger(req));
  const fn = REPORTS[NAMES[name]];
  if (!fn) throw new HttpError(404, 'Unknown report');
  const out = await fn(req);
  const total = out.rows.length;
  const rows = out.rows.slice(0, MAX_ROWS);
  const calls = out.noCall ? [] : await ReportCall.find({ report: name, key: { $in: rows.map((r) => r.key) } }).lean();
  const byKey = new Map(calls.map((c) => [c.key, c]));
  rows.forEach((r) => {
    const c = byKey.get(r.key);
    r.call = c ? { at: c.lastCalledAt, by: c.lastCalledByCode || '', count: c.count || 1, note: c.note || '' } : null;
  });
  res.json({ report: name, ...out, rows, total, truncated: total > rows.length });
}

/** "Call done": the borrower of a row was called. */
export async function callDone(req, res) {
  const b = req.body || {};
  const name = asString(b.report);
  const key = asString(b.key);
  if (!Object.keys(NAMES).includes(name) || !key) throw new HttpError(422, 'Unknown report row');
  const c = await ReportCall.findOneAndUpdate(
    { report: name, key },
    { $set: { lastCalledAt: new Date(), lastCalledByCode: req.user.employeeCode || '', lastCalledBy: req.user._id, note: asString(b.note).slice(0, 200) }, $inc: { count: 1 } },
    { upsert: true, new: true }
  );
  await audit(req, { action: 'report.callDone', entity: 'ReportCall', entityId: c._id, after: { report: name, key, count: c.count } });
  res.json({ call: { at: c.lastCalledAt, by: c.lastCalledByCode, count: c.count, note: c.note || '' } });
}

/**
 * NPA payment: money received on a loan that is NPA (a 120-day loan still due after its last installment). It goes to the earliest unpaid installments like any EMI,
 * and shows as "NPA receive" in the Cashbook.
 */
export async function npaPayment(req, res) {
  const b = req.body || {};
  const p = await loadLoan(req, asString(b.loan));
  const line = p.lines.find((l) => l.code === asString(b.member));
  if (!line) throw new HttpError(422, 'Select the borrower', { member: 'Select the borrower' });
  const today = startOfToday();
  const st = await borrowerState(p, line, today);
  const npa = p.mode === 'daily' && p.installments === NPA_TERM && p.emiEndDate < today && st.totals.outstanding > 0 && !st.settled;
  if (!npa) throw new HttpError(409, 'This loan is not NPA (a 120-day loan that is still due after its last installment)');
  const amountPaise = toMinor(typeof b.amount === 'number' ? String(b.amount) : asString(b.amount));
  if (amountPaise === null || amountPaise < 100) throw new HttpError(422, 'Enter the amount (₹1 or more, up to 2 decimals)', { amount: 'Enter the amount (₹1 or more, up to 2 decimals)' });
  if (amountPaise > st.totals.outstanding) throw new HttpError(422, 'The amount is more than what is outstanding', { amount: `The borrower owes only ₹${st.totals.outstanding / 100}` });
  const payMode = asString(b.payMode) || 'cash';
  if (!['cash', 'bank', 'upi', 'cheque'].includes(payMode)) throw new HttpError(422, 'Select how the payment is made', { payMode: 'Select how the payment is made' });
  const bankAccount = await readBankAccount(b, payMode);
  const doc = await receive(req, p, line, { amountPaise, paidOn: today, payMode, reference: asString(b.reference), bankAccount, npa: true });
  await audit(req, { action: 'report.npaPayment', entity: 'EmiPayment', entityId: doc._id, after: { loan: p.loanId, member: line.code, amount: amountPaise / 100 } });
  res.status(201).json({ receiptNo: doc.receiptNo, outstanding: Math.max(st.totals.outstanding - amountPaise, 0) / 100 });
}

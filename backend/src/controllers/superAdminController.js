import mongoose from 'mongoose';
import { Holiday, Notification, UserNotification, AUDIENCES } from '../models/SuperAdmin.js';
import { User, ROLES } from '../models/User.js';
import { Member } from '../models/Member.js';
import { Group } from '../models/Group.js';
import { Branch } from '../models/Branch.js';
import { Ledger } from '../models/Ledger.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { LoanRequisition } from '../models/LoanRequisition.js';
import { LoanSettlement } from '../models/LoanSettlement.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { ProductComplaint } from '../models/ProductComplaint.js';
import { AppEmiCollection } from '../models/AppEmiCollection.js';
import { DayClose } from '../models/DayClose.js';
import { Employee, Attendance } from '../models/Hr.js';
import { Complaint, Task, Leave, Requirement } from '../models/HrExtra.js';
import { SecurityWithdrawal } from '../models/SecurityWithdrawal.js';
import { GroupLeaderCommission } from '../models/GroupLeaderCommission.js';
import { slowRun } from '../services/slowRun.js';
import { sendSms } from '../services/sms.js';
import { asString, parseDateOnly, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { cashbookData, CATEGORY_LABEL } from './cashbookController.js';
import { scanBorrowers } from './reportController.js';
import { redateDailyLoans } from '../services/holidays.js';

/**
 * Super Admin: bulk notification, holiday master, profit and loss, complaints of the whole company, company summary, monitoring and graphs.
 */
const DAY = 24 * 3600 * 1000;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const rupees = (p) => (p || 0) / 100;
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const MOBILE_RE = /^[6-9]\d{9}$/;
const oid = (v) => mongoose.isValidObjectId(String(v || ''));
const round2 = (n) => Math.round(n * 100) / 100;

const branchMatch = (req) => (oid(asString(req.query.branch)) ? { branch: new mongoose.Types.ObjectId(asString(req.query.branch)) } : {});
const rangeOf = (req, defFrom) => {
  const from = parseDateOnly(asString(req.query.from)) || defFrom;
  const to = parseDateOnly(asString(req.query.to)) || startOfToday();
  return { from, to };
};

// ---- Bulk notification -------------------------------------------------------------------------------------------------------

const SMS_LIMIT = 500;

async function audienceOf(b) {
  const audience = asString(b.audience);
  if (!AUDIENCES.includes(audience)) throw invalid({ audience: 'Choose who gets it' });
  const branch = asString(b.branch);
  const role = asString(b.role);
  if (['branch_staff', 'branch_members'].includes(audience) && (!oid(branch) || !(await Branch.exists({ _id: branch })))) throw invalid({ branch: 'Select the branch' });
  if (audience === 'role_staff' && !ROLES.includes(role)) throw invalid({ role: 'Select the role' });
  let users = [];
  let mobiles = [];
  if (audience.endsWith('_staff')) {
    const filter = { isActive: true };
    if (audience === 'branch_staff') filter.branches = branch;
    if (audience === 'role_staff') filter.role = role;
    users = await User.find(filter).select('name mobile').lean();
    mobiles = users.map((u) => u.mobile).filter((m) => MOBILE_RE.test(m || ''));
  } else {
    const filter = { isDeleted: false, mobile: { $regex: MOBILE_RE } };
    if (audience === 'branch_members') filter.branch = branch;
    mobiles = (await Member.find(filter).select('mobile').lean()).map((m) => m.mobile);
  }
  mobiles = [...new Set(mobiles)];
  return { audience, branch: oid(branch) ? branch : undefined, role: role || undefined, users, mobiles, staff: audience.endsWith('_staff') };
}

export async function notificationPreview(req, res) {
  const a = await audienceOf(req.body || {});
  res.json({ staff: a.staff, people: a.staff ? a.users.length : a.mobiles.length, withMobile: a.mobiles.length, smsLimit: SMS_LIMIT });
}

export async function sendNotification(req, res) {
  const b = req.body || {};
  const title = asString(b.title).replace(/\s+/g, ' ');
  if (title.length < 3 || title.length > 80) throw invalid({ title: 'Enter the title (3–80 characters)' });
  const message = asString(b.message);
  if (message.length < 5 || message.length > 300) throw invalid({ message: 'Write the message (5–300 characters)' });
  const a = await audienceOf(b);
  const inApp = Boolean(b.inApp) && a.staff;
  const sms = Boolean(b.sms);
  if (!inApp && !sms) throw invalid({ channels: a.staff ? 'Choose in the app, by SMS, or both' : 'Members get it by SMS: tick SMS' });
  if (sms && a.mobiles.length > SMS_LIMIT) throw invalid({ audience: `More than ${SMS_LIMIT} SMS in one go. Choose a branch or a role.` });
  const n = await Notification.create({ title, message, audience: a.audience, branch: a.branch, role: a.role, inApp, sms, recipients: a.staff ? a.users.length : a.mobiles.length, createdByCode: req.user.employeeCode || '', createdBy: req.user._id });
  if (inApp) {
    await UserNotification.insertMany(a.users.map((u) => ({ user: u._id, notification: n._id, title, message })));
    n.appCount = a.users.length;
  }
  if (sms) {
    // five at a time; a number that fails is counted, it does not stop the others
    for (let i = 0; i < a.mobiles.length; i += 5) {
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.allSettled(a.mobiles.slice(i, i + 5).map((to) => sendSms({ to, text: `Udgam Microfinance: ${title}. ${message}` })));
      results.forEach((r) => { if (r.status === 'fulfilled') n.smsSent += 1; else n.smsFailed += 1; });
    }
  }
  await n.save();
  await audit(req, { action: 'notification.send', entity: 'Notification', entityId: n._id, after: { title, audience: a.audience, recipients: n.recipients, appCount: n.appCount, smsSent: n.smsSent, smsFailed: n.smsFailed } });
  res.status(201).json({ id: n._id, recipients: n.recipients, appCount: n.appCount, smsSent: n.smsSent, smsFailed: n.smsFailed });
}

export async function listNotifications(_req, res) {
  const rows = await Notification.find({}).sort({ createdAt: -1 }).limit(200).populate('branch', 'code name').lean();
  res.json({ items: rows.map((n) => ({ id: n._id, title: n.title, message: n.message, audience: n.audience, branch: n.branch ? `${n.branch.code} — ${n.branch.name}` : '', role: n.role || '', inApp: n.inApp, sms: n.sms, recipients: n.recipients, appCount: n.appCount, smsSent: n.smsSent, smsFailed: n.smsFailed, by: n.createdByCode || '', at: n.createdAt })) });
}

/** The bell of the signed-in user. */
export async function myNotifications(req, res) {
  const [rows, unread] = await Promise.all([UserNotification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(30).lean(), UserNotification.countDocuments({ user: req.user._id, readAt: { $exists: false } })]);
  res.json({ unread, items: rows.map((n) => ({ id: n._id, title: n.title, message: n.message, at: n.createdAt, read: Boolean(n.readAt) })) });
}
export async function readNotifications(req, res) {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(oid);
  await UserNotification.updateMany({ user: req.user._id, readAt: { $exists: false }, ...(ids.length ? { _id: { $in: ids } } : {}) }, { $set: { readAt: new Date() } });
  res.json({ ok: true });
}

// ---- Holiday master -----------------------------------------------------------------------------------------------------------

const presentHoliday = (h) => ({ id: h._id, date: iso(h.date), day: new Date(h.date).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }), name: h.name, branch: h.branch?._id ? { id: h.branch._id, code: h.branch.code, name: h.branch.name } : null, isActive: h.isActive });

// the due dates of the daily loans that fall on or after the holiday are counted again (it takes a while for thousands of loans, so it runs after the answer)
function redateInBackground(date, branch) {
  redateDailyLoans(date, branch || undefined).then((n) => console.log(`Holiday: ${n} daily loan(s) got new due dates`)).catch((err) => console.error('holiday redate failed', err.message));
}

export async function listHolidays(req, res) {
  const year = Number(asString(req.query.year)) || new Date().getUTCFullYear();
  const rows = await Holiday.find({ isDeleted: false, date: { $gte: new Date(Date.UTC(year, 0, 1)), $lte: new Date(Date.UTC(year, 11, 31)) } }).sort({ date: 1 }).populate('branch', 'code name').lean();
  res.json({ year, items: rows.map(presentHoliday) });
}
async function readHoliday(b, id) {
  const date = parseDateOnly(asString(b.date));
  if (!date) throw invalid({ date: 'Enter a valid date' });
  const name = asString(b.name).replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw invalid({ name: 'Enter the name of the holiday (2–60 characters)' });
  let branch = null;
  if (asString(b.branch)) {
    if (!oid(b.branch) || !(await Branch.exists({ _id: b.branch }))) throw invalid({ branch: 'Select a branch from the list' });
    branch = b.branch;
  }
  if (await Holiday.exists({ date, branch, isDeleted: false, ...(id ? { _id: { $ne: id } } : {}) })) throw new HttpError(409, 'This day is already a holiday', { date: 'Already a holiday' });
  return { date, name, branch };
}
export async function createHoliday(req, res) {
  const h = await Holiday.create({ ...(await readHoliday(req.body || {})), createdByCode: req.user.employeeCode || '' });
  await h.populate('branch', 'code name');
  await audit(req, { action: 'holiday.create', entity: 'Holiday', entityId: h._id, after: { date: iso(h.date), name: h.name } });
  redateInBackground(h.date, h.branch?._id || h.branch);
  res.status(201).json({ item: presentHoliday(h), redating: true });
}
export async function updateHoliday(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Holiday not found');
  const h = await Holiday.findOne({ _id: req.params.id, isDeleted: false });
  if (!h) throw new HttpError(404, 'Holiday not found');
  const before = { date: h.date, branch: h.branch };
  Object.assign(h, await readHoliday(req.body || {}, h._id));
  await h.save();
  await h.populate('branch', 'code name');
  redateInBackground(new Date(Math.min(before.date.getTime(), h.date.getTime())), String(before.branch || '') === String(h.branch?._id || h.branch || '') ? before.branch : null);
  res.json({ item: presentHoliday(h), redating: true });
}
export async function removeHoliday(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Holiday not found');
  const h = await Holiday.findOne({ _id: req.params.id, isDeleted: false });
  if (!h) throw new HttpError(404, 'Holiday not found');
  h.isDeleted = true;
  await h.save();
  await audit(req, { action: 'holiday.delete', entity: 'Holiday', entityId: h._id, after: { date: iso(h.date), name: h.name } });
  redateInBackground(h.date, h.branch);
  res.json({ message: 'Deleted', redating: true });
}
/** The holidays of a range as { date: name }, for a branch (the company-wide ones and the branch's own). */
export async function holidaysBetween(from, to, branchId) {
  const rows = await Holiday.find({ isDeleted: false, isActive: true, date: { $gte: from, $lte: to }, $or: [{ branch: null }, ...(branchId ? [{ branch: branchId }] : [])] }).select('date name').lean();
  return new Map(rows.map((h) => [iso(h.date), h.name]));
}

// ---- Profit and loss ----------------------------------------------------------------------------------------------------------

/** The share of what was collected that was interest (every installment carries its own principal / interest split). */
async function interestCollected(branchFilter, from, to, perBranch = false) {
  const agg = await EmiPayment.aggregate([
    { $match: { status: 'paid', legacy: { $ne: true }, paidOn: { $gte: from, $lte: to }, ...branchFilter } },
    { $unwind: '$items' },
    { $group: { _id: { lp: '$loanPayment', no: '$items.no', br: '$branch' }, paid: { $sum: '$items.amountPaise' } } },
  ]);
  const split = new Map(); // branch id -> interest (paise)
  const byLoan = new Map();
  agg.forEach((r) => { const k = String(r._id.lp); if (!byLoan.has(k)) byLoan.set(k, []); byLoan.get(k).push({ no: r._id.no, paid: r.paid, br: String(r._id.br) }); });
  const ids = [...byLoan.keys()];
  let interest = 0;
  let principal = 0;
  for (let i = 0; i < ids.length; i += 250) {
    // eslint-disable-next-line no-await-in-loop
    const loans = await LoanPayment.find({ _id: { $in: ids.slice(i, i + 250) } }).select('schedule.no schedule.installmentPaise schedule.interestPaise').lean();
    loans.forEach((l) => {
      const sched = new Map(l.schedule.map((s) => [s.no, s]));
      (byLoan.get(String(l._id)) || []).forEach((p) => {
        const s = sched.get(p.no);
        const ratio = s && s.installmentPaise ? Math.min((s.interestPaise || 0) / s.installmentPaise, 1) : 0;
        interest += p.paid * ratio;
        principal += p.paid * (1 - ratio);
        split.set(p.br, (split.get(p.br) || 0) + p.paid * ratio);
      });
    });
  }
  if (perBranch) return split;
  return { interest: Math.round(interest), principal: Math.round(principal) };
}

export async function profitLoss(req, res) {
  const monthStart = new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`);
  const { from, to } = rangeOf(req, monthStart);
  const { _rows: rows } = await cashbookData(req, { branch: req.query.branch, from: iso(from), to: iso(to), skipDue: true });
  const ledgers = new Map((await Ledger.find({ isDeleted: false }).select('name group').populate('group', 'nature').lean()).map((l) => [String(l._id), l]));
  const add = (map, key, label, amount) => { const x = map.get(key) || { label, amount: 0 }; x.amount += amount; map.set(key, x); };
  const income = new Map();
  const expense = new Map();
  for (const r of rows.cur) {
    if (r.memo || /_due$/.test(r.cat)) continue;
    if (['processing_fee', 'insurance_fee', 'civil_fee'].includes(r.cat)) add(income, r.cat, CATEGORY_LABEL.get(r.cat), r.amount);
    else if (['staff_salary', 'room_rent', 'leader_commission', 'other_payment'].includes(r.cat)) add(expense, r.cat, CATEGORY_LABEL.get(r.cat), r.amount);
    else if (r.cat.startsWith('ledger:')) {
      const l = ledgers.get(r.cat.slice(7));
      const nature = l?.group?.nature;
      if (nature === 'income' && r.side === 'receive') add(income, r.cat, `${l.name} (ledger)`, r.amount);
      else if (nature === 'expense' && r.side === 'payment') add(expense, r.cat, `${l.name} (ledger)`, r.amount);
    }
  }
  const scope = oid(asString(req.query.branch)) ? { branch: new mongoose.Types.ObjectId(asString(req.query.branch)) } : {};
  const { interest, principal } = await interestCollected(scope, from, to);
  const waived = (await LoanSettlement.aggregate([{ $match: { status: 'active', waiverPaise: { $gt: 0 }, settledOn: { $gte: from, $lte: to }, ...scope } }, { $group: { _id: null, t: { $sum: '$waiverPaise' } } }]))[0]?.t || 0;
  const incomeLines = [{ key: 'interest', label: 'Interest on loans (collected)', amount: rupees(interest) }, ...[...income.entries()].map(([key, v]) => ({ key, label: v.label, amount: rupees(v.amount) }))];
  const expenseLines = [...expense.entries()].map(([key, v]) => ({ key, label: v.label, amount: rupees(v.amount) }));
  if (waived) expenseLines.push({ key: 'written_off', label: 'Balance written off (settlement waiver)', amount: rupees(waived) });
  const totalIncome = round2(incomeLines.reduce((s, l) => s + l.amount, 0));
  const totalExpense = round2(expenseLines.reduce((s, l) => s + l.amount, 0));
  res.json({ from: iso(from), to: iso(to), income: incomeLines, expense: expenseLines, totalIncome, totalExpense, profit: round2(totalIncome - totalExpense), principalCollected: rupees(principal) });
}

// ---- Complaints of the whole company -------------------------------------------------------------------------------------------

export async function complaintOverview(req, res) {
  const st = asString(req.query.status);
  const branch = branchMatch(req);
  const q = asString(req.query.q).toLowerCase();
  const toll = await Complaint.find(branch).sort({ date: -1 }).limit(1000).populate('branch', 'code name').lean();
  const prod = await ProductComplaint.find(branch).sort({ createdAt: -1 }).limit(1000).populate('branch', 'code name').lean();
  const today = startOfToday().getTime();
  const rows = [
    ...toll.map((c) => ({ id: String(c._id), source: 'toll_free', no: c.complaintNo, date: iso(c.date), branch: c.branch?.code || '—', who: `${c.callerName}${c.memberCode ? ` (${c.memberCode})` : ''}`, about: `${c.category}: ${c.description}`, status: c.status === 'resolved' ? 'closed' : 'open', statusLabel: c.status, handledBy: c.assignedToCode || '', ageDays: c.status === 'resolved' ? 0 : Math.floor((today - new Date(c.date).getTime()) / DAY) })),
    ...prod.map((c) => ({ id: String(c._id), source: 'product', no: c.code, date: iso(c.createdAt), branch: c.branch?.code || '—', who: `${c.memberCode} ${c.memberName || ''}`.trim(), about: `Product ${c.product?.name || ''}${c.remark ? `: ${c.remark}` : ''}`, status: c.status === 'delivered' ? 'closed' : 'open', statusLabel: c.status, handledBy: c.resolvedByCode || '', ageDays: c.status === 'delivered' ? 0 : Math.floor((today - new Date(c.createdAt).getTime()) / DAY) })),
  ].filter((r) => (!st || r.status === st) && (!q || [r.no, r.who, r.about].some((v) => String(v).toLowerCase().includes(q)))).sort((a, b) => b.date.localeCompare(a.date));
  const open = rows.filter((r) => r.status === 'open');
  const byBranch = new Map();
  open.forEach((r) => byBranch.set(r.branch, (byBranch.get(r.branch) || 0) + 1));
  res.json({ items: rows.slice(0, 1000), summary: { total: rows.length, open: open.length, tollFreeOpen: open.filter((r) => r.source === 'toll_free').length, productOpen: open.filter((r) => r.source === 'product').length, over7: open.filter((r) => r.ageDays > 7).length }, openByBranch: [...byBranch.entries()].map(([branch, n]) => ({ branch, open: n })).sort((a, b) => b.open - a.open) });
}

// ---- Company summary -------------------------------------------------------------------------------------------------------------

const countBy = async (Model, match, field = 'branch', extra = {}) => new Map((await Model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 }, ...extra } }])).map((r) => [String(r._id), r]));
const sumBy = async (Model, match, valueExpr) => new Map((await Model.aggregate([{ $match: match }, { $group: { _id: '$branch', n: { $sum: 1 }, t: { $sum: valueExpr } } }])).map((r) => [String(r._id), r]));

async function branchBorrowers(req, asOf, split = false) {
  const by = new Map();
  await scanBorrowers(req, asOf, (r) => {
    const v = by.get(r.branch) || { borrowers: 0, outstanding: 0, overdue: 0, overdueBorrowers: 0, due: 0, npa: 0, npaOutstanding: 0, loanAmount: 0, duePrincipal: 0, dueInterest: 0, perMember: new Map() };
    if (r.outstanding > 0) {
      v.borrowers += 1; v.outstanding += r.outstanding; v.loanAmount += r.loanAmount;
      v.perMember.set(r.memberCode, (v.perMember.get(r.memberCode) || 0) + 1);
      if (split) { v.duePrincipal += r.duePrincipal || 0; v.dueInterest += r.dueInterest || 0; }
    }
    if (r.due > 0) v.due += r.due;
    if (r.overdueDays > 0) { v.overdue += r.due; v.overdueBorrowers += 1; }
    if (r.npaTerm && r.outstanding > 0 && r.daysPastEnd >= 1) { v.npa += 1; v.npaOutstanding += r.outstanding; }
    by.set(r.branch, v);
    return null;
  }, { light: true, split });
  return by;
}

/** Sum per branch over the lines of the loans disbursed in the range: processing, insurance, security deposit, product pieces and amount, number of loans. */
async function disbursedLines(scope, from, to) {
  const rows = await LoanPayment.aggregate([
    { $match: { status: 'paid', paidOn: { $gte: from, $lte: to }, ...scope } },
    { $unwind: '$lines' },
    { $group: {
      _id: '$branch', loans: { $sum: 1 }, amount: { $sum: { $ifNull: ['$lines.amountPaise', 0] } }, processing: { $sum: { $ifNull: ['$lines.processingFeePaise', 0] } }, insurance: { $sum: { $ifNull: ['$lines.insuranceFeePaise', 0] } },
      security: { $sum: { $ifNull: ['$lines.securityPaise', 0] } }, product: { $sum: { $ifNull: ['$lines.productPaise', 0] } },
      qty: { $sum: { $reduce: { input: { $ifNull: ['$lines.products', []] }, initialValue: 0, in: { $add: ['$$value', { $ifNull: ['$$this.quantity', 0] }] } } } },
    } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

async function buildCompanySummary(req) {
  const monthStart = new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`);
  const { from, to } = rangeOf(req, monthStart);
  const branches = await Branch.find(oid(asString(req.query.branch)) ? { _id: req.query.branch } : { isDeleted: { $ne: true } }).select('code name').sort({ code: 1 }).lean();
  const scope = oid(asString(req.query.branch)) ? { branch: new mongoose.Types.ObjectId(asString(req.query.branch)) } : {};
  const fromMonth = iso(from).slice(0, 7);
  const toMonth = iso(to).slice(0, 7);
  const grp = (Model, match, extra) => new Promise((resolve, reject) => Model.aggregate([{ $match: match }, { $group: { _id: '$branch', n: { $sum: 1 }, ...extra } }]).then((r) => resolve(new Map(r.map((x) => [String(x._id), x])))).catch(reject));
  const [members, joined, blocked, groups, newGroups, employees, lines, collected, interest, openComplaints, drawn, settles, commission, borrowers] = await Promise.all([
    countBy(Member, { isDeleted: false, ...scope }),
    countBy(Member, { isDeleted: false, joiningDate: { $gte: from, $lte: to }, ...scope }),
    countBy(Member, { isDeleted: false, isBlocked: true, ...scope }),
    countBy(Group, { isDeleted: false, ...scope }),
    countBy(Group, { isDeleted: false, openingDate: { $gte: from, $lte: to }, ...scope }),
    countBy(Employee, { isDeleted: false, status: 'active', ...scope }),
    disbursedLines(scope, from, to),
    sumBy(EmiPayment, { status: 'paid', legacy: { $ne: true }, paidOn: { $gte: from, $lte: to }, ...scope }, '$amountPaise'),
    interestCollected(scope, from, to, true),
    countBy(Complaint, { status: { $ne: 'resolved' }, ...scope }),
    grp(SecurityWithdrawal, { status: 'approved', kind: 'withdraw', decidedAt: { $gte: from, $lt: new Date(to.getTime() + 86400000) }, ...scope }, { amount: { $sum: '$amountPaise' }, interest: { $sum: { $ifNull: ['$interestPaise', 0] } } }),
    LoanSettlement.aggregate([{ $match: { status: 'active', settledOn: { $gte: from, $lte: to }, ...scope } }, { $group: { _id: { b: '$branch', k: '$kind' }, n: { $sum: 1 }, amount: { $sum: '$amountPaise' }, waiver: { $sum: { $ifNull: ['$waiverPaise', 0] } }, waivers: { $sum: { $cond: [{ $gt: ['$waiverPaise', 0] }, 1, 0] } } } }]),
    grp(GroupLeaderCommission, { month: { $gte: fromMonth, $lte: toMonth }, ...scope }, { amount: { $sum: '$amountPaise' } }),
    branchBorrowers(req, to, true),
  ]);
  const settle = new Map();
  settles.forEach((r) => { settle.set(`${r._id.b}|${r._id.k}`, r); });
  const get = (m, id, f = 'n') => m.get(String(id))?.[f] || 0;
  const st = (id, kind, f) => settle.get(`${id}|${kind}`)?.[f] || 0;
  const rows = branches.map((b) => {
    const bw = borrowers.get(b.code) || {};
    const dual = [...(bw.perMember || new Map()).values()].filter((n) => n > 1).length;
    const duePrincipal = round2((bw.duePrincipal || 0));
    const dueInterest = round2((bw.dueInterest || 0));
    const waivers = st(b._id, 'loan', 'waivers') + st(b._id, 'auto', 'waivers') + st(b._id, 'death', 'waivers');
    const waived = st(b._id, 'loan', 'waiver') + st(b._id, 'auto', 'waiver') + st(b._id, 'death', 'waiver');
    return {
      branchId: b._id, branch: `${b.code} — ${b.name}`,
      members: get(members, b._id), joined: get(joined, b._id), blocked: get(blocked, b._id), groups: get(groups, b._id), newGroups: get(newGroups, b._id), employees: get(employees, b._id),
      borrowers: bw.borrowers || 0, loanMembers: bw.perMember ? bw.perMember.size : 0, dualMembers: dual,
      loans: get(lines, b._id, 'loans'), disbursed: rupees(get(lines, b._id, 'amount')), processing: rupees(get(lines, b._id, 'processing')), insurance: rupees(get(lines, b._id, 'insurance')), securityDeposit: rupees(get(lines, b._id, 'security')),
      securityWithdrawal: rupees(get(drawn, b._id, 'amount')), securityInterestWithdrawal: rupees(get(drawn, b._id, 'interest')),
      duePrincipal: rupees(Math.round(duePrincipal * 100)), dueInterest: rupees(Math.round(dueInterest * 100)), portfolio: round2(duePrincipal + dueInterest),
      outstanding: round2(bw.outstanding || 0), interestCollection: rupees(Math.round(interest.get(String(b._id)) || 0)), collected: rupees(get(collected, b._id, 't')), penalty: 0,
      npa: bw.npa || 0, npaOutstanding: round2(bw.npaOutstanding || 0), overdueBorrowers: bw.overdueBorrowers || 0, overdue: round2(bw.overdue || 0),
      settlements: st(b._id, 'loan', 'n'), settlementAmount: rupees(st(b._id, 'loan', 'amount')), autoSettle: st(b._id, 'auto', 'n'), autoSettleAmount: rupees(st(b._id, 'auto', 'amount')), deathSettle: st(b._id, 'death', 'n'), deathSettleAmount: rupees(st(b._id, 'death', 'waiver')),
      writeOff: waivers, writeOffAmount: rupees(waived),
      commission: rupees(get(commission, b._id, 'amount')), productQty: get(lines, b._id, 'qty'), productAmount: rupees(get(lines, b._id, 'product')), openComplaints: get(openComplaints, b._id),
    };
  });
  const keys = rows.length ? Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number') : [];
  const totals = Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((a, r) => a + r[k], 0))]));
  return { from: iso(from), to: iso(to), rows, totals, collectionOfDemand: null };
}

/** Company summary: worked out in the background for a big company (see slowRun); the page asks again with poll=1 while it answers pending. */
export async function companySummary(req, res) {
  const q = { ...req.query };
  delete q.poll;
  const r = await slowRun(`summary|${req.user._id}|${JSON.stringify(q)}`, () => buildCompanySummary(req), { poll: req.query.poll === '1' });
  if (!r.done) return res.status(202).json({ pending: true });
  res.json(r.data);
}

// ---- Monitoring ---------------------------------------------------------------------------------------------------------------------

export async function monitoring(req, res) {
  const q = { ...req.query };
  delete q.poll;
  const r = await slowRun(`monitoring|${req.user._id}|${JSON.stringify(q)}`, () => buildMonitoring(req), { poll: req.query.poll === '1' });
  if (!r.done) return res.status(202).json({ pending: true });
  res.json(r.data);
}

async function buildMonitoring(req) {
  const date = parseDateOnly(asString(req.query.date)) || startOfToday();
  const branches = await Branch.find(oid(asString(req.query.branch)) ? { _id: req.query.branch } : { isDeleted: { $ne: true } }).select('code name').sort({ code: 1 }).lean();
  const scope = oid(asString(req.query.branch)) ? { branch: new mongoose.Types.ObjectId(asString(req.query.branch)) } : {};
  const [collected, lastRcpt, closes, lastApproved, emps, pLoans, pAppEmi, pLeaves, pReq, openComplaint, overdueTasks, borrowers] = await Promise.all([
    sumBy(EmiPayment, { status: 'paid', legacy: { $ne: true }, paidOn: date, ...scope }, '$amountPaise'),
    new Promise((resolve) => EmiPayment.aggregate([{ $match: { status: 'paid', legacy: { $ne: true }, ...scope } }, { $group: { _id: '$branch', t: { $max: '$createdAt' } } }]).then((r) => resolve(new Map(r.map((x) => [String(x._id), x.t])))).catch(() => resolve(new Map()))),
    new Promise((resolve) => DayClose.find({ date, ...scope }).select('branch status').lean().then((r) => resolve(new Map(r.map((x) => [String(x.branch), x.status]))))),
    new Promise((resolve) => DayClose.aggregate([{ $match: { status: 'approved', ...scope } }, { $group: { _id: '$branch', d: { $max: '$date' } } }]).then((r) => resolve(new Map(r.map((x) => [String(x._id), x.d]))))),
    Employee.find({ isDeleted: false, status: 'active', ...scope }).select('_id branch').lean(),
    countBy(LoanRequisition, { isDeleted: false, status: 'pending', ...scope }),
    countBy(AppEmiCollection, { status: 'pending', ...scope }),
    countBy(Leave, { status: 'pending', ...scope }),
    countBy(Requirement, { status: 'pending', ...scope }),
    countBy(Complaint, { status: { $ne: 'resolved' }, ...scope }),
    countBy(Task, { status: { $in: ['open', 'in_progress'] }, dueDate: { $lt: date }, ...scope }),
    branchBorrowers(req, date),
  ]);
  const present = new Set((await Attendance.find({ date, status: { $in: ['present', 'half_day'] }, employee: { $in: emps.map((e) => e._id) } }).select('employee').lean()).map((a) => String(a.employee)));
  const empBy = new Map();
  emps.forEach((e) => { const k = String(e.branch); const v = empBy.get(k) || { total: 0, present: 0 }; v.total += 1; if (present.has(String(e._id))) v.present += 1; empBy.set(k, v); });
  const get = (m, id) => m.get(String(id))?.n || 0;
  const rows = branches.map((b) => {
    const bw = borrowers.get(b.code) || {};
    const e = empBy.get(String(b._id)) || { total: 0, present: 0 };
    const due = round2(bw.due || 0);
    const col = rupees(collected.get(String(b._id))?.t || 0);
    return {
      branchId: b._id, branch: `${b.code} — ${b.name}`, due, collected: col, collectionPercent: due ? Math.round((col / due) * 1000) / 10 : null, dayClose: closes.get(String(b._id)) || 'not_closed', lastClosed: iso(lastApproved.get(String(b._id))),
      employees: e.total, present: e.present, pendingLoans: get(pLoans, b._id), pendingAppEmi: get(pAppEmi, b._id), pendingLeaves: get(pLeaves, b._id), pendingRequirements: get(pReq, b._id), openComplaints: get(openComplaint, b._id), overdueTasks: get(overdueTasks, b._id),
      lastReceipt: lastRcpt.get(String(b._id)) || null,
    };
  });
  const t = (f) => round2(rows.reduce((s, r) => s + r[f], 0));
  return { date: iso(date), rows, totals: { due: t('due'), collected: t('collected'), employees: t('employees'), present: t('present'), pendingLoans: t('pendingLoans'), pendingAppEmi: t('pendingAppEmi'), pendingLeaves: t('pendingLeaves'), openComplaints: t('openComplaints'), overdueTasks: t('overdueTasks'), notClosed: rows.filter((r) => r.dayClose === 'not_closed').length } };
}

// ---- Company graph -------------------------------------------------------------------------------------------------------------------

export async function graph(req, res) {
  const q = { ...req.query };
  delete q.poll;
  const r = await slowRun(`graph|${req.user._id}|${JSON.stringify(q)}`, () => buildGraph(req), { poll: req.query.poll === '1' });
  if (!r.done) return res.status(202).json({ pending: true });
  res.json(r.data);
}

async function buildGraph(req) {
  const months = Math.min(Math.max(Number(asString(req.query.months)) || 12, 3), 24);
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const keys = Array.from({ length: months }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1)).toISOString().slice(0, 7));
  const scope = oid(asString(req.query.branch)) ? { branch: new mongoose.Types.ObjectId(asString(req.query.branch)) } : {};
  const byMonth = async (Model, match, dateField, valueExpr) => new Map((await Model.aggregate([{ $match: { ...match, [dateField]: { $gte: start }, ...scope } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: `$${dateField}` } }, n: { $sum: 1 }, t: { $sum: valueExpr } } }])).map((r) => [r._id, r]));
  const [disb, coll, mem] = await Promise.all([
    byMonth(LoanPayment, { status: 'paid' }, 'paidOn', { $ifNull: ['$totalAmountPaise', 0] }),
    byMonth(EmiPayment, { status: 'paid', legacy: { $ne: true } }, 'paidOn', '$amountPaise'),
    byMonth(Member, { isDeleted: false }, 'joiningDate', 1),
  ]);
  const series = keys.map((k) => ({ month: k, disbursed: rupees(disb.get(k)?.t || 0), loans: disb.get(k)?.n || 0, collected: rupees(coll.get(k)?.t || 0), members: mem.get(k)?.n || 0 }));
  const bw = await branchBorrowers(req, startOfToday());
  const branches = [...bw.entries()].map(([branch, v]) => ({ branch, outstanding: round2(v.outstanding), overdue: round2(v.overdue), npa: round2(v.npaOutstanding) })).sort((a, b) => b.outstanding - a.outstanding);
  return { months, series, branches };
}

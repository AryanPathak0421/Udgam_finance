import { Member } from '../models/Member.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { LoanRequisition } from '../models/LoanRequisition.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { AppEmiCollection } from '../models/AppEmiCollection.js';
import { DayClose } from '../models/DayClose.js';
import { SecurityWithdrawal } from '../models/SecurityWithdrawal.js';
import { Employee } from '../models/Hr.js';
import { User } from '../models/User.js';
import { Complaint, Leave, Resignation, Requirement } from '../models/HrExtra.js';
import { ProductOrder } from '../models/ProductOrder.js';
import { ProductPayment } from '../models/ProductPayment.js';
import { branchFilter, isAdmin } from './groupController.js';

const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const DAY = 24 * 3600 * 1000;
const rupees = (p) => Math.round((p || 0)) / 100;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const safe = (p) => p.catch(() => 0);
const HR_ROLES = ['super_admin', 'admin', 'branch_manager', 'accountant'];
const MGMT = ['super_admin', 'admin', 'branch_manager'];
const REQ_ROLES = [...MGMT, 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];
const MEMBER_CREATORS = [...MGMT, 'loan_officer', 'field_officer'];
const STOCK_ROLES = [...MGMT, 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];

/** How many things wait for this user, per menu item (the number next to the module in the menu). */
async function pendingCounts(user) {
  const scope = branchFilter(user);
  const mgmt = MGMT.includes(user.role);
  const hr = HR_ROLES.includes(user.role);
  const admin = isAdmin(user);
  const mine = (await Employee.findOne({ user: user._id, isDeleted: false }).select('_id').lean())?._id;
  const jobs = {
    '/hr/leave-approval': hr ? safe(Leave.countDocuments({ status: 'pending', ...scope })) : mine ? safe(Leave.countDocuments({ status: 'pending', approver: mine })) : 0,
    '/app/emi-approval': mgmt ? safe(AppEmiCollection.countDocuments({ status: 'pending', ...scope })) : 0,
    '/app/member-approval': mgmt ? safe(Member.countDocuments({ isDeleted: false, 'joiningApproval.status': 'pending', ...scope })) : 0,
    // Member: the documents to review (admin) and the rejected documents the branch has to upload again
    '/members/kyc-approval': admin ? safe(Member.countDocuments({ isDeleted: false, kycPending: true })) : 0,
    '/members/kyc-reupload': MEMBER_CREATORS.includes(user.role) ? safe(Member.countDocuments({ isDeleted: false, kycRejected: true, ...scope })) : 0,
    // Requisition: the requisitions that wait for a decision
    '/loan-requisition/list': REQ_ROLES.includes(user.role) ? safe(LoanRequisition.countDocuments({ isDeleted: false, status: 'pending', ...scope })) : 0,
    // Product: the orders to approve and the payments to receive (admin); for a branch the orders that were decided in the last 3 days
    '/stock/orders': admin
      ? safe(Promise.all([ProductOrder.countDocuments({ status: 'pending' }), ProductPayment.countDocuments({ status: 'paid', isDeleted: { $ne: true } })]).then(([a, b]) => a + b))
      : STOCK_ROLES.includes(user.role) ? safe(ProductOrder.countDocuments({ status: { $in: ['approved', 'rejected'] }, updatedAt: { $gte: new Date(Date.now() - 3 * DAY) }, ...scope })) : 0,
    '/loan-approval/business': admin ? safe(LoanRequisition.countDocuments({ isDeleted: false, status: 'pending', kind: 'business', ...scope })) : 0,
    '/loan-approval/pending': mgmt ? safe(LoanRequisition.countDocuments({ isDeleted: false, status: 'pending', kind: { $ne: 'business' }, ...scope })) : 0,
    '/loan-payment/pending': mgmt || user.role === 'accountant' ? safe(LoanRequisition.countDocuments({ isDeleted: false, status: 'approved', disbursedAt: { $exists: false }, ...scope })) : 0,
    '/accounts/day-close-approval': admin ? safe(DayClose.countDocuments({ status: 'submitted', ...scope })) : 0,
    '/savings/approval': admin ? safe(SecurityWithdrawal.countDocuments({ status: 'pending', ...scope })) : 0,
    '/hr/resignations': admin ? safe(Resignation.countDocuments({ status: 'pending', ...scope })) : 0,
    '/hr/requirements': mgmt ? safe(Requirement.countDocuments({ status: 'pending', ...scope })) : 0,
    '/hr/complaints': hr ? safe(Complaint.countDocuments({ status: { $ne: 'resolved' }, ...scope })) : 0,
  };
  const out = {};
  const keys = Object.keys(jobs);
  const values = await Promise.all(keys.map((k) => jobs[k]));
  keys.forEach((k, i) => { if (values[i] > 0) out[k] = values[i]; });
  return out;
}

export async function badges(req, res) {
  res.json({ items: await pendingCounts(req.user) });
}

/** The dashboard: figures of the branches of the user, the collection of the last 30 days and the last 6 months. */
export async function summary(req, res) {
  const scope = branchFilter(req.user);
  const today = startOfToday();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const from30 = new Date(today.getTime() - 29 * DAY);
  const from6 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  const cast = (o) => (o.branch?.$in ? { branch: { $in: o.branch.$in.map((b) => b) } } : o); // aggregate needs the same ObjectIds the user has
  const sc = cast(scope);
  const [members, employees, loansMonth, collToday, collMonth, daily, monthColl, monthDisb, complaints, pending] = await Promise.all([
    safe(Member.countDocuments({ isDeleted: false, ...scope })),
    safe(Employee.countDocuments({ isDeleted: false, status: 'active', ...scope })),
    LoanPayment.aggregate([{ $match: { status: 'paid', paidOn: { $gte: monthStart }, ...sc } }, { $group: { _id: null, n: { $sum: { $size: '$lines' } }, t: { $sum: { $ifNull: ['$totalAmountPaise', 0] } } } }]).catch(() => []),
    EmiPayment.aggregate([{ $match: { status: 'paid', legacy: { $ne: true }, paidOn: today, ...sc } }, { $group: { _id: null, t: { $sum: '$amountPaise' } } }]).catch(() => []),
    EmiPayment.aggregate([{ $match: { status: 'paid', legacy: { $ne: true }, paidOn: { $gte: monthStart }, ...sc } }, { $group: { _id: null, t: { $sum: '$amountPaise' } } }]).catch(() => []),
    EmiPayment.aggregate([{ $match: { status: 'paid', legacy: { $ne: true }, paidOn: { $gte: from30, $lte: today }, ...sc } }, { $group: { _id: '$paidOn', t: { $sum: '$amountPaise' } } }]).catch(() => []),
    EmiPayment.aggregate([{ $match: { status: 'paid', legacy: { $ne: true }, paidOn: { $gte: from6 }, ...sc } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$paidOn' } }, t: { $sum: '$amountPaise' } } }]).catch(() => []),
    LoanPayment.aggregate([{ $match: { status: 'paid', paidOn: { $gte: from6 }, ...sc } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$paidOn' } }, t: { $sum: { $ifNull: ['$totalAmountPaise', 0] } } } }]).catch(() => []),
    HR_ROLES.includes(req.user.role) ? safe(Complaint.countDocuments({ status: { $ne: 'resolved' }, ...scope })) : 0,
    pendingCounts(req.user),
  ]);
  const byDay = new Map(daily.map((r) => [iso(r._id), r.t]));
  const days = Array.from({ length: 30 }, (_, i) => { const d = iso(from30.getTime() + i * DAY); return { date: d, collected: rupees(byDay.get(d) || 0) }; });
  const collBy = new Map(monthColl.map((r) => [r._id, r.t]));
  const disbBy = new Map(monthDisb.map((r) => [r._id, r.t]));
  const months = Array.from({ length: 6 }, (_, i) => { const k = iso(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5 + i, 1)).slice(0, 7); return { month: k, collected: rupees(collBy.get(k) || 0), disbursed: rupees(disbBy.get(k) || 0) }; });
  res.json({
    members, employees, loansMonth: loansMonth[0]?.n || 0, disbursedMonth: rupees(loansMonth[0]?.t), collectedToday: rupees(collToday[0]?.t), collectedMonth: rupees(collMonth[0]?.t),
    // admin: the active staff that have no rank (the menus ticked for a rank never reach them)
    usersWithoutRank: isAdmin(req.user) ? await safe(User.countDocuments({ isActive: true, role: { $nin: ['super_admin', 'admin'] }, $or: [{ rank: { $exists: false } }, { rank: null }] })) : 0,
    openComplaints: complaints, pending: Object.values(pending).reduce((s, n) => s + n, 0), days, months,
  });
}

import mongoose from 'mongoose';
import { Employee, Attendance, Department, Designation } from '../models/Hr.js';
import { RoomRent, Task, TASK_STATUS, Complaint, COMPLAINT_STATUS, Requirement, REQUIREMENT_STATUS, Leave, LEAVE_TYPES, Resignation, EmployeeChange } from '../models/HrExtra.js';
import { User } from '../models/User.js';
import { AppUser } from '../models/AppUser.js';
import { Branch } from '../models/Branch.js';
import { Company } from '../models/Company.js';
import { CashEntry } from '../models/CashEntry.js';
import { generateCode } from '../services/codeSequence.js';
import { assertDayOpen, defaultWorkDate } from '../services/dayOpen.js';
import { readBankAccount } from '../services/bankAccountPick.js';
import { asString, parseDateOnly, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { branchFilter, isAdmin } from './groupController.js';

/**
 * HR Department, the rest: room rent entry, task, toll free complaint entry, employee requirement, leave apply and approval, resignation approval,
 * promotion and transfer with their letters, joining / appointment letter, and the employee list with block.
 */
const DAY = 24 * 3600 * 1000;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const rupees = (p) => (p || 0) / 100;
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const MOBILE_RE = /^[6-9]\d{9}$/;
const oid = (v) => mongoose.isValidObjectId(String(v || ''));
const brRef = (b) => (b?._id ? { id: b._id, code: b.code, name: b.name } : null);
const POP_BRANCH = { path: 'branch', select: 'code name' };

function scope(req) {
  const filter = branchFilter(req.user);
  const wanted = asString(req.query.branch);
  if (oid(wanted)) {
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
/** An employee of the user's branches. */
async function employeeOf(req, id, field = 'employee') {
  if (!oid(id)) throw invalid({ [field]: 'Select the employee' });
  const e = await Employee.findOne({ _id: id, isDeleted: false, ...branchFilter(req.user) }).populate([{ path: 'designation', select: 'name' }, POP_BRANCH]);
  if (!e) throw invalid({ [field]: 'Employee not found in your branches' });
  return e;
}
async function branchOf(req, id) {
  const mine = (req.user.branches || []).map(String);
  const b = oid(id) ? String(id) : mine.length === 1 ? mine[0] : '';
  if (!b) throw invalid({ branch: 'Select the branch' });
  if (!isAdmin(req.user) && !mine.includes(b)) throw new HttpError(403, 'You can only use your own branches');
  if (!(await Branch.exists({ _id: b }))) throw invalid({ branch: 'Branch not found' });
  return b;
}
const readDate = (v, label, { future = true } = {}) => {
  const d = parseDateOnly(asString(v));
  if (!d) throw invalid({ [label]: 'Enter a valid date' });
  if (!future && d > startOfToday()) throw invalid({ [label]: 'The date cannot be in the future' });
  return d;
};
const push = (doc, status, remark, req) => doc.history.push({ status, remark: asString(remark).slice(0, 300), byCode: req.user.employeeCode || '', at: new Date() });

// ---- Room rent entry ---------------------------------------------------------------------------------------------------------

const presentRent = (r) => ({ id: r._id, branch: brRef(r.branch), month: r.month, landlord: r.landlord, amount: rupees(r.amountPaise), paidOn: iso(r.paidOn), payMode: r.payMode, reference: r.reference || '', remark: r.remark || '', status: r.status, cancelReason: r.cancelReason || '', by: r.enteredByCode || '' });

export async function listRoomRents(req, res) {
  const q = asString(req.query.q).toLowerCase();
  const rows = await RoomRent.find({ ...scope(req), ...dateRange(req, 'paidOn') }).sort({ paidOn: -1, createdAt: -1 }).limit(1000).populate(POP_BRANCH).lean();
  const items = rows.map(presentRent).filter((r) => !q || [r.landlord, r.reference, r.month].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items, summary: { entries: items.length, amount: items.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0) } });
}
export async function createRoomRent(req, res) {
  const b = req.body || {};
  const branch = await branchOf(req, asString(b.branch));
  const month = asString(b.month);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid({ month: 'Choose the month the rent is for' });
  const landlord = asString(b.landlord).replace(/\s+/g, ' ');
  if (landlord.length < 2 || landlord.length > 80) throw invalid({ landlord: 'Enter the name of the landlord (2–80 characters)' });
  const amountPaise = toMinor(typeof b.amount === 'number' ? String(b.amount) : asString(b.amount));
  if (amountPaise === null || amountPaise < 100) throw invalid({ amount: 'Enter the rent (₹1 or more, up to 2 decimals)' });
  const paidOn = b.paidOn ? readDate(b.paidOn, 'paidOn', { future: false }) : await defaultWorkDate(branch, req.user);
  if (!isAdmin(req.user) && startOfToday().getTime() - paidOn.getTime() > 30 * DAY) throw invalid({ paidOn: 'The date cannot be older than 30 days' });
  const payMode = asString(b.payMode) || 'cash';
  if (!['cash', 'bank', 'upi', 'cheque'].includes(payMode)) throw invalid({ payMode: 'Select how the rent is paid' });
  const bankAccount = await readBankAccount(b, payMode);
  await assertDayOpen(branch, paidOn, req.user);
  const entry = await CashEntry.create({ branch, date: paidOn, side: 'payment', category: 'room_rent', amountPaise, mode: payMode, bankAccount, remark: `Room rent ${month} — ${landlord}`.slice(0, 200), enteredByCode: req.user.employeeCode || '', createdBy: req.user._id });
  const r = await RoomRent.create({ branch, month, landlord, amountPaise, paidOn, payMode, bankAccount, reference: asString(b.reference).slice(0, 60), remark: asString(b.remark).slice(0, 200), cashEntry: entry._id, enteredByCode: req.user.employeeCode || '' });
  await r.populate(POP_BRANCH);
  await audit(req, { action: 'roomRent.create', entity: 'RoomRent', entityId: r._id, after: { branch: String(branch), month, amount: amountPaise / 100 } });
  res.status(201).json({ item: presentRent(r) });
}
export async function cancelRoomRent(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Entry not found');
  const r = await RoomRent.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (!r) throw new HttpError(404, 'Entry not found');
  if (r.status === 'cancelled') throw new HttpError(409, 'This entry is already cancelled');
  const reason = asString(req.body?.reason).slice(0, 200);
  if (reason.length < 3) throw invalid({ reason: 'Enter the reason' });
  r.status = 'cancelled';
  r.cancelReason = reason;
  await r.save();
  if (r.cashEntry) await CashEntry.updateOne({ _id: r.cashEntry }, { $set: { isDeleted: true } });
  await audit(req, { action: 'roomRent.cancel', entity: 'RoomRent', entityId: r._id, after: { reason } });
  res.json({ status: 'cancelled' });
}

// ---- Task --------------------------------------------------------------------------------------------------------------------

const presentTask = (t) => ({ id: t._id, title: t.title, description: t.description || '', branch: brRef(t.branch), assignedTo: { code: t.assignedToCode, name: t.assignedToName }, dueDate: iso(t.dueDate), priority: t.priority, status: t.status, overdue: Boolean(t.dueDate && t.dueDate < startOfToday() && ['open', 'in_progress'].includes(t.status)), history: (t.history || []).map((h) => ({ status: h.status, remark: h.remark || '', by: h.byCode || '', at: h.at })), createdBy: t.createdByCode || '' });

export async function listTasks(req, res) {
  const filter = { ...scope(req) };
  const st = asString(req.query.status);
  if (TASK_STATUS.includes(st)) filter.status = st;
  else if (st === 'active') filter.status = { $in: ['open', 'in_progress'] };
  const q = asString(req.query.q).toLowerCase();
  const rows = await Task.find(filter).sort({ dueDate: 1, createdAt: -1 }).limit(1000).populate(POP_BRANCH).lean();
  const items = rows.map(presentTask).filter((t) => !q || [t.title, t.assignedTo.code, t.assignedTo.name].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items, summary: { tasks: items.length, open: items.filter((t) => t.status === 'open').length, inProgress: items.filter((t) => t.status === 'in_progress').length, done: items.filter((t) => t.status === 'done').length, overdue: items.filter((t) => t.overdue).length } });
}
export async function createTask(req, res) {
  const b = req.body || {};
  const e = await employeeOf(req, b.employee);
  const title = asString(b.title).replace(/\s+/g, ' ');
  if (title.length < 3 || title.length > 120) throw invalid({ title: 'Enter the task (3–120 characters)' });
  const priority = asString(b.priority) || 'medium';
  if (!['low', 'medium', 'high'].includes(priority)) throw invalid({ priority: 'Choose low, medium or high' });
  const t = await Task.create({
    title, description: asString(b.description).slice(0, 500), branch: e.branch?._id, assignedTo: e._id, assignedToCode: e.employeeCode, assignedToName: e.name, dueDate: b.dueDate ? readDate(b.dueDate, 'dueDate') : undefined, priority,
    history: [{ status: 'open', remark: 'Task given', byCode: req.user.employeeCode || '', at: new Date() }], createdByCode: req.user.employeeCode || '',
  });
  await t.populate(POP_BRANCH);
  await audit(req, { action: 'task.create', entity: 'Task', entityId: t._id, after: { title, employee: e.employeeCode } });
  res.status(201).json({ item: presentTask(t) });
}
export async function setTaskStatus(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Task not found');
  const t = await Task.findOne({ _id: req.params.id, ...branchFilter(req.user) }).populate(POP_BRANCH);
  if (!t) throw new HttpError(404, 'Task not found');
  const status = asString(req.body?.status);
  if (!TASK_STATUS.includes(status)) throw invalid({ status: 'Choose the status' });
  if (status === t.status) throw invalid({ status: 'The task is already at this status' });
  t.status = status;
  push(t, status, req.body?.remark, req);
  await t.save();
  res.json({ item: presentTask(t) });
}

// ---- Toll free complaint entry ----------------------------------------------------------------------------------------------

const presentComplaint = (c) => ({ id: c._id, complaintNo: c.complaintNo, date: iso(c.date), callerName: c.callerName, callerMobile: c.callerMobile || '', branch: brRef(c.branch), memberCode: c.memberCode || '', category: c.category, description: c.description, assignedTo: c.assignedToCode || '', status: c.status, resolution: c.resolution || '', resolvedAt: c.resolvedAt, history: (c.history || []).map((h) => ({ status: h.status, remark: h.remark || '', by: h.byCode || '', at: h.at })), enteredBy: c.enteredByCode || '' });

export async function listComplaints(req, res) {
  const filter = { ...dateRange(req, 'date') };
  const sc = scope(req);
  // a complaint without a branch is seen by the admin only
  if (sc.branch) filter.branch = sc.branch;
  const st = asString(req.query.status);
  if (COMPLAINT_STATUS.includes(st)) filter.status = st;
  const q = asString(req.query.q).toLowerCase();
  const rows = await Complaint.find(filter).sort({ date: -1, createdAt: -1 }).limit(1000).populate(POP_BRANCH).lean();
  const items = rows.map(presentComplaint).filter((c) => !q || [c.complaintNo, c.callerName, c.callerMobile, c.memberCode, c.description].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items, summary: { complaints: items.length, open: items.filter((c) => c.status === 'open').length, inProgress: items.filter((c) => c.status === 'in_progress').length, resolved: items.filter((c) => c.status === 'resolved').length } });
}
export async function createComplaint(req, res) {
  const b = req.body || {};
  const callerName = asString(b.callerName).replace(/\s+/g, ' ');
  if (callerName.length < 2 || callerName.length > 80) throw invalid({ callerName: 'Enter the name of the caller' });
  const callerMobile = asString(b.callerMobile);
  if (callerMobile && !MOBILE_RE.test(callerMobile)) throw invalid({ callerMobile: 'Enter a 10-digit mobile number' });
  const description = asString(b.description);
  if (description.length < 5 || description.length > 1000) throw invalid({ description: 'Write the complaint (5–1000 characters)' });
  const category = asString(b.category) || 'other';
  if (!['loan', 'emi', 'staff', 'insurance', 'other'].includes(category)) throw invalid({ category: 'Choose the kind of complaint' });
  let branch;
  if (asString(b.branch)) branch = await branchOf(req, asString(b.branch));
  else if (!isAdmin(req.user)) branch = await branchOf(req, '');
  let assigned;
  if (asString(b.assignedTo)) assigned = await employeeOf(req, b.assignedTo, 'assignedTo');
  const c = await Complaint.create({
    complaintNo: await generateCode('complaint'), date: b.date ? readDate(b.date, 'date', { future: false }) : startOfToday(), callerName, callerMobile, branch, memberCode: asString(b.memberCode).toUpperCase().slice(0, 30), category, description,
    assignedTo: assigned?._id, assignedToCode: assigned?.employeeCode, status: 'open', history: [{ status: 'open', remark: 'Complaint entered', byCode: req.user.employeeCode || '', at: new Date() }], enteredByCode: req.user.employeeCode || '',
  });
  await c.populate(POP_BRANCH);
  await audit(req, { action: 'complaint.create', entity: 'Complaint', entityId: c._id, after: { complaintNo: c.complaintNo, category } });
  res.status(201).json({ item: presentComplaint(c) });
}
export async function setComplaintStatus(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Complaint not found');
  const c = await Complaint.findById(req.params.id).populate(POP_BRANCH);
  if (!c || (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === String(c.branch?._id)))) throw new HttpError(404, 'Complaint not found');
  const status = asString(req.body?.status);
  if (!COMPLAINT_STATUS.includes(status)) throw invalid({ status: 'Choose the status' });
  const resolution = asString(req.body?.resolution).slice(0, 500);
  if (status === 'resolved' && resolution.length < 3) throw invalid({ resolution: 'Write what was done to resolve it' });
  if (asString(req.body?.assignedTo)) {
    const e = await employeeOf(req, req.body.assignedTo, 'assignedTo');
    c.assignedTo = e._id;
    c.assignedToCode = e.employeeCode;
  }
  c.status = status;
  if (status === 'resolved') { c.resolution = resolution; c.resolvedAt = new Date(); }
  push(c, status, resolution || req.body?.remark, req);
  await c.save();
  res.json({ item: presentComplaint(c) });
}

// ---- Employee requirement ---------------------------------------------------------------------------------------------------

const presentReq = (r) => ({ id: r._id, reqNo: r.reqNo, branch: brRef(r.branch), department: r.department?.name || '', designation: r.designation?.name || '', count: r.count, reason: r.reason || '', requiredBy: iso(r.requiredBy), status: r.status, remark: r.remark || '', decidedBy: r.decidedByCode || '', requestedBy: r.requestedByCode || '', createdAt: r.createdAt });
const REQ_POP = [POP_BRANCH, { path: 'department', select: 'name' }, { path: 'designation', select: 'name' }];

export async function listRequirements(req, res) {
  const filter = { ...scope(req) };
  const st = asString(req.query.status);
  if (REQUIREMENT_STATUS.includes(st)) filter.status = st;
  const rows = await Requirement.find(filter).sort({ createdAt: -1 }).limit(500).populate(REQ_POP).lean();
  const items = rows.map(presentReq);
  res.json({ items, summary: { requirements: items.length, pending: items.filter((r) => r.status === 'pending').length, approved: items.filter((r) => r.status === 'approved').length, positions: items.filter((r) => ['pending', 'approved'].includes(r.status)).reduce((s, r) => s + r.count, 0) } });
}
export async function createRequirement(req, res) {
  const b = req.body || {};
  const branch = await branchOf(req, asString(b.branch));
  const count = Number(b.count);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw invalid({ count: 'Enter how many employees are needed (1–100)' });
  const ids = {};
  for (const [k, Model] of [['department', Department], ['designation', Designation]]) {
    if (!asString(b[k])) continue;
    if (!oid(b[k]) || !(await Model.exists({ _id: b[k], isDeleted: false }))) throw invalid({ [k]: `Select the ${k} from the list` });
    ids[k] = b[k];
  }
  const reason = asString(b.reason).slice(0, 300);
  if (reason.length < 3) throw invalid({ reason: 'Write why the employees are needed' });
  const r = await Requirement.create({ reqNo: await generateCode('empRequirement'), branch, ...ids, count, reason, requiredBy: b.requiredBy ? readDate(b.requiredBy, 'requiredBy') : undefined, requestedByCode: req.user.employeeCode || '' });
  await r.populate(REQ_POP);
  await audit(req, { action: 'requirement.create', entity: 'Requirement', entityId: r._id, after: { reqNo: r.reqNo, count } });
  res.status(201).json({ item: presentReq(r) });
}
export async function decideRequirement(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Requirement not found');
  const r = await Requirement.findById(req.params.id).populate(REQ_POP);
  if (!r) throw new HttpError(404, 'Requirement not found');
  const status = asString(req.body?.status);
  if (!['approved', 'rejected', 'filled'].includes(status)) throw invalid({ status: 'Choose approve, reject or filled' });
  if (status === 'filled' && r.status !== 'approved') throw new HttpError(409, 'Only an approved requirement can be marked as filled');
  if (status !== 'filled' && r.status !== 'pending') throw new HttpError(409, `This requirement is already ${r.status}`);
  const remark = asString(req.body?.remark).slice(0, 300);
  if (status === 'rejected' && remark.length < 3) throw invalid({ remark: 'Enter the reason' });
  r.status = status; r.remark = remark; r.decidedByCode = req.user.employeeCode || ''; r.decidedAt = new Date();
  await r.save();
  await audit(req, { action: `requirement.${status}`, entity: 'Requirement', entityId: r._id, after: { reqNo: r.reqNo } });
  res.json({ item: presentReq(r) });
}

// ---- Leave apply, leave approval --------------------------------------------------------------------------------------------

const presentLeave = (l) => ({ id: l._id, employeeCode: l.employeeCode, employeeName: l.employeeName, branch: brRef(l.branch), type: l.type, from: iso(l.from), to: iso(l.to), days: l.days, reason: l.reason || '', status: l.status, rejectReason: l.rejectReason || '', decidedBy: l.decidedByCode || '', appliedBy: l.appliedByCode || '', createdAt: l.createdAt });
const leaveDates = (from, to) => { const out = []; for (let d = from.getTime(); d <= to.getTime(); d += DAY) { const x = new Date(d); if (x.getUTCDay() !== 0) out.push(x); } return out; };

export async function listLeaves(req, res) {
  const filter = { ...scope(req), ...dateRange(req, 'from') };
  const st = asString(req.query.status);
  if (['pending', 'approved', 'rejected'].includes(st)) filter.status = st;
  const q = asString(req.query.q).toLowerCase();
  const rows = await Leave.find(filter).sort({ from: -1, createdAt: -1 }).limit(1000).populate(POP_BRANCH).lean();
  const items = rows.map(presentLeave).filter((l) => !q || [l.employeeCode, l.employeeName].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items, summary: { applications: items.length, pending: items.filter((l) => l.status === 'pending').length, approvedDays: items.filter((l) => l.status === 'approved').reduce((s, l) => s + l.days, 0) } });
}
export async function applyLeave(req, res) {
  const b = req.body || {};
  const e = await employeeOf(req, b.employee);
  if (e.status !== 'active') throw invalid({ employee: 'This employee has left' });
  const from = readDate(b.from, 'from');
  const to = readDate(b.to, 'to');
  if (to < from) throw invalid({ to: 'The last day cannot be before the first day' });
  if ((to.getTime() - from.getTime()) / DAY > 90) throw invalid({ to: 'A leave can be up to 90 days' });
  const type = asString(b.type) || 'casual';
  if (!LEAVE_TYPES.includes(type)) throw invalid({ type: 'Choose the kind of leave' });
  const days = leaveDates(from, to).length;
  if (!days) throw invalid({ to: 'These dates are only Sundays (the weekly off)' });
  const clash = await Leave.findOne({ employee: e._id, status: { $in: ['pending', 'approved'] }, from: { $lte: to }, to: { $gte: from } }).select('from to status').lean();
  if (clash) throw new HttpError(409, `The employee already has a ${clash.status} leave from ${iso(clash.from)} to ${iso(clash.to)}`, { from: 'Overlaps another leave' });
  const reason = asString(b.reason).slice(0, 300);
  if (reason.length < 3) throw invalid({ reason: 'Write the reason for the leave' });
  const l = await Leave.create({ employee: e._id, employeeCode: e.employeeCode, employeeName: e.name, branch: e.branch?._id, type, from, to, days, reason, appliedByCode: req.user.employeeCode || '' });
  await l.populate(POP_BRANCH);
  await audit(req, { action: 'leave.apply', entity: 'Leave', entityId: l._id, after: { employee: e.employeeCode, from: iso(from), to: iso(to), days } });
  res.status(201).json({ item: presentLeave(l) });
}
/** Approved leave is marked as Leave in the attendance of every working day of it (so it is paid in the salary). */
export async function decideLeave(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Leave not found');
  const l = await Leave.findOne({ _id: req.params.id, ...branchFilter(req.user) }).populate(POP_BRANCH);
  if (!l) throw new HttpError(404, 'Leave not found');
  if (l.status !== 'pending') throw new HttpError(409, `This leave is already ${l.status}`);
  const status = asString(req.body?.status);
  if (!['approved', 'rejected'].includes(status)) throw invalid({ status: 'Choose approve or reject' });
  const reason = asString(req.body?.reason).slice(0, 200);
  if (status === 'rejected' && reason.length < 3) throw invalid({ reason: 'Enter the reason' });
  l.status = status; l.decidedByCode = req.user.employeeCode || ''; l.decidedAt = new Date(); l.rejectReason = status === 'rejected' ? reason : undefined;
  await l.save();
  if (status === 'approved') {
    const ops = leaveDates(l.from, l.to).map((d) => ({ updateOne: { filter: { employee: l.employee, date: d }, update: { $set: { status: 'leave', source: 'manual', remark: 'Leave approved', markedByCode: req.user.employeeCode || '' }, $unset: { firstActivity: '', lastActivity: '' } }, upsert: true } }));
    if (ops.length) await Attendance.bulkWrite(ops);
  }
  await audit(req, { action: `leave.${status}`, entity: 'Leave', entityId: l._id, after: { employee: l.employeeCode, days: l.days } });
  res.json({ item: presentLeave(l) });
}

// ---- Resignation approval ---------------------------------------------------------------------------------------------------

const presentResign = (r) => ({ id: r._id, employeeCode: r.employeeCode, employeeName: r.employeeName, branch: brRef(r.branch), appliedOn: iso(r.appliedOn), lastWorkingDate: iso(r.lastWorkingDate), reason: r.reason || '', status: r.status, rejectReason: r.rejectReason || '', decidedBy: r.decidedByCode || '' });

export async function listResignations(req, res) {
  const filter = { ...scope(req) };
  const st = asString(req.query.status);
  if (['pending', 'approved', 'rejected'].includes(st)) filter.status = st;
  const rows = await Resignation.find(filter).sort({ appliedOn: -1 }).limit(500).populate(POP_BRANCH).lean();
  res.json({ items: rows.map(presentResign) });
}
export async function applyResignation(req, res) {
  const b = req.body || {};
  const e = await employeeOf(req, b.employee);
  if (e.status !== 'active') throw invalid({ employee: 'This employee has already left' });
  if (await Resignation.exists({ employee: e._id, status: 'pending' })) throw new HttpError(409, 'A resignation of this employee is already waiting for approval', { employee: 'Already applied' });
  const lastWorkingDate = readDate(b.lastWorkingDate, 'lastWorkingDate');
  const appliedOn = b.appliedOn ? readDate(b.appliedOn, 'appliedOn', { future: false }) : startOfToday();
  if (lastWorkingDate < appliedOn) throw invalid({ lastWorkingDate: 'The last working day cannot be before the date of the resignation' });
  const reason = asString(b.reason).slice(0, 300);
  if (reason.length < 3) throw invalid({ reason: 'Write the reason' });
  const r = await Resignation.create({ employee: e._id, employeeCode: e.employeeCode, employeeName: e.name, branch: e.branch?._id, appliedOn, lastWorkingDate, reason, appliedByCode: req.user.employeeCode || '' });
  await r.populate(POP_BRANCH);
  await audit(req, { action: 'resignation.apply', entity: 'Resignation', entityId: r._id, after: { employee: e.employeeCode } });
  res.status(201).json({ item: presentResign(r) });
}
/** Approved: the employee is marked as left on the last working day (salary stops after it). */
export async function decideResignation(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Resignation not found');
  const r = await Resignation.findOne({ _id: req.params.id, ...branchFilter(req.user) }).populate(POP_BRANCH);
  if (!r) throw new HttpError(404, 'Resignation not found');
  if (r.status !== 'pending') throw new HttpError(409, `This resignation is already ${r.status}`);
  const status = asString(req.body?.status);
  if (!['approved', 'rejected'].includes(status)) throw invalid({ status: 'Choose approve or reject' });
  const reason = asString(req.body?.reason).slice(0, 200);
  if (status === 'rejected' && reason.length < 3) throw invalid({ reason: 'Enter the reason' });
  r.status = status; r.decidedByCode = req.user.employeeCode || ''; r.decidedAt = new Date(); r.rejectReason = status === 'rejected' ? reason : undefined;
  await r.save();
  if (status === 'approved') await Employee.updateOne({ _id: r.employee }, { $set: { status: 'left', leftOn: r.lastWorkingDate } });
  await audit(req, { action: `resignation.${status}`, entity: 'Resignation', entityId: r._id, after: { employee: r.employeeCode } });
  res.json({ item: presentResign(r) });
}

// ---- Promotion and transfer, with the letter -------------------------------------------------------------------------------

const presentChange = (c) => ({ id: c._id, letterNo: c.letterNo, kind: c.kind, employeeCode: c.employeeCode, employeeName: c.employeeName, effectiveDate: iso(c.effectiveDate), fromDesignation: c.fromDesignation || '', toDesignation: c.toDesignation || '', fromBranch: c.fromBranchName || '', toBranch: c.toBranchName || '', fromSalary: rupees(c.fromSalaryPaise), toSalary: rupees(c.toSalaryPaise), remark: c.remark || '', by: c.byCode || '' });

export async function listChanges(req, res) {
  const emps = await Employee.find({ isDeleted: false, ...branchFilter(req.user) }).select('_id').lean();
  const filter = { employee: { $in: emps.map((e) => e._id) }, ...dateRange(req, 'effectiveDate') };
  if (['promotion', 'transfer'].includes(asString(req.query.kind))) filter.kind = req.query.kind;
  const rows = await EmployeeChange.find(filter).sort({ effectiveDate: -1, createdAt: -1 }).limit(500).lean();
  res.json({ items: rows.map(presentChange) });
}
export async function createChange(req, res) {
  const b = req.body || {};
  const e = await employeeOf(req, b.employee);
  if (e.status !== 'active') throw invalid({ employee: 'This employee has left' });
  const kind = asString(b.kind);
  if (!['promotion', 'transfer'].includes(kind)) throw invalid({ kind: 'Choose promotion or transfer' });
  const effectiveDate = readDate(b.effectiveDate, 'effectiveDate');
  const remark = asString(b.remark).slice(0, 300);
  const doc = { kind, employee: e._id, employeeCode: e.employeeCode, employeeName: e.name, effectiveDate, remark, byCode: req.user.employeeCode || '', fromDesignation: e.designation?.name || '', fromBranch: e.branch?._id, fromBranchName: e.branch ? `${e.branch.code} — ${e.branch.name}` : '', fromSalaryPaise: e.monthlySalaryPaise || 0 };
  const set = {};
  if (kind === 'promotion') {
    const des = oid(b.toDesignation) ? await Designation.findOne({ _id: b.toDesignation, isDeleted: false }) : null;
    if (!des) throw invalid({ toDesignation: 'Select the new designation' });
    set.designation = des._id;
    doc.toDesignation = des.name;
    doc.toSalaryPaise = e.monthlySalaryPaise || 0;
    if (asString(b.toSalary) !== '') {
      const p = toMinor(typeof b.toSalary === 'number' ? String(b.toSalary) : asString(b.toSalary));
      if (p === null || p < 0) throw invalid({ toSalary: 'Enter the new monthly salary (₹, up to 2 decimals)' });
      set.monthlySalaryPaise = p;
      doc.toSalaryPaise = p;
    }
    doc.toBranch = e.branch?._id;
    doc.toBranchName = doc.fromBranchName;
  } else {
    if (!oid(b.toBranch) || !(await Branch.exists({ _id: b.toBranch }))) throw invalid({ toBranch: 'Select the branch to transfer to' });
    if (String(e.branch?._id) === String(b.toBranch)) throw invalid({ toBranch: 'The employee is already in this branch' });
    const nb = await Branch.findById(b.toBranch).select('code name').lean();
    set.branch = b.toBranch;
    doc.toBranch = b.toBranch;
    doc.toBranchName = `${nb.code} — ${nb.name}`;
    doc.toDesignation = doc.fromDesignation;
    doc.toSalaryPaise = doc.fromSalaryPaise;
  }
  doc.letterNo = await generateCode('hrLetter');
  const c = await EmployeeChange.create(doc);
  await Employee.updateOne({ _id: e._id }, { $set: set });
  // a transfer also moves the branch of the staff login (the branch the employee leaves is replaced by the new one)
  if (kind === 'transfer' && e.user && e.branch) {
    const u = await User.findById(e.user);
    if (u && (u.branches || []).some((x) => String(x) === String(e.branch._id))) {
      u.branches = [...new Set([...(u.branches || []).filter((x) => String(x) !== String(e.branch._id)).map(String), String(b.toBranch)])];
      await u.save();
    }
  }
  await audit(req, { action: `employee.${kind}`, entity: 'Employee', entityId: e._id, after: { letterNo: c.letterNo, from: doc.fromDesignation || doc.fromBranchName, to: doc.toDesignation || doc.toBranchName } });
  res.status(201).json({ item: presentChange(c) });
}

/** The letterhead of the company for the letters. */
export async function letterhead(_req, res) {
  const c = await Company.findOne({ singleton: 'company' }).lean();
  res.json({ company: c ? { name: c.name, address: c.address, city: c.city || '', state: c.state || '', pincode: c.pincode || '', email: c.email, mobile: c.mobile, stamp: c.stampImage || null, signature: c.signatureImage || null } : null });
}

// ---- Employee list and block --------------------------------------------------------------------------------------------------

/** Blocking an employee also stops the staff login (and the app) at once; unblocking gives them back. */
export async function blockEmployee(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Employee not found');
  const e = await Employee.findOne({ _id: req.params.id, isDeleted: false });
  if (!e) throw new HttpError(404, 'Employee not found');
  const block = req.body?.block !== false;
  const reason = asString(req.body?.reason).slice(0, 200);
  if (block) {
    if (reason.length < 3) throw invalid({ reason: 'Enter the reason' });
    if (e.user && String(e.user) === String(req.user._id)) throw new HttpError(409, 'You cannot block yourself');
    const u = e.user ? await User.findById(e.user).select('role') : null;
    if (u?.role === 'super_admin') throw new HttpError(409, 'A super admin cannot be blocked');
  }
  e.isBlocked = block;
  e.blockReason = block ? reason : undefined;
  e.blockedAt = block ? new Date() : undefined;
  e.blockedByCode = block ? req.user.employeeCode || '' : undefined;
  await e.save();
  if (e.user) {
    await User.updateOne({ _id: e.user }, { $set: { isActive: !block } });
    if (block) await AppUser.updateOne({ user: e.user }, { $set: { isActive: false, deactivatedAt: new Date() } });
  }
  await audit(req, { action: block ? 'employee.block' : 'employee.unblock', entity: 'Employee', entityId: e._id, after: { employeeCode: e.employeeCode, reason } });
  res.json({ isBlocked: e.isBlocked });
}

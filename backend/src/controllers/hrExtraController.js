import mongoose from 'mongoose';
import { Employee, Attendance, Department, Designation } from '../models/Hr.js';
import { TargetTask, RoomRent, RentParty, Task, TASK_STATUS, Complaint, COMPLAINT_STATUS, Requirement, REQUIREMENT_STATUS, Leave, LEAVE_TYPES, Resignation, EmployeeChange } from '../models/HrExtra.js';
import { User } from '../models/User.js';
import { Rank } from '../models/Rank.js';
import { Member } from '../models/Member.js';
import { Group } from '../models/Group.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { elBalance, elBalances } from '../services/earnedLeave.js';
import { notifyEmployee } from '../services/hrNotify.js';
import { EARN_FIXED, fixedOf } from '../services/salaryLines.js';
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

const KIND_LABEL = { room: 'Room rent', messenger: 'Messenger', other: 'Room rent' };
const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 1_500_000;
const round2 = (n) => Math.round(n * 100) / 100;
const readPhoto = (v, field, label, { required }) => {
  if (v === undefined || v === null || v === '') { if (required) throw invalid({ [field]: `${label} is required` }); return undefined; }
  if (typeof v !== 'string' || !IMAGE_RE.test(v)) throw invalid({ [field]: `${label} must be a PNG or JPEG image` });
  if (v.length > MAX_IMAGE_CHARS) throw invalid({ [field]: `${label} is too large` });
  return v;
};
const readMoney = (v, field, label, { min = 0 } = {}) => {
  const p = v === '' || v === undefined || v === null ? 0 : toMinor(typeof v === 'number' ? String(v) : asString(v));
  if (p === null || p < min) throw invalid({ [field]: `Enter ${label} (₹${min ? ` ${min / 100} or more,` : ''} up to 2 decimals)` });
  return p;
};

const presentRent = (r) => ({
  id: r._id, branch: brRef(r.branch), month: r.month, landlord: r.landlord, kind: r.kind || 'room', amount: rupees(r.amountPaise), rent: rupees(r.rentPaise ?? r.amountPaise), electricity: rupees(r.electricityPaise),
  prevReading: r.prevReading ?? null, currentReading: r.currentReading ?? null, units: r.units ?? null, perUnit: rupees(r.perUnitPaise), hasMeter: r.currentReading !== undefined && r.currentReading !== null,
  paidOn: iso(r.paidOn), payMode: r.payMode, reference: r.reference || '', remark: r.remark || '', status: r.status, cancelReason: r.cancelReason || '', by: r.enteredByCode || '',
});

export async function listRoomRents(req, res) {
  const q = asString(req.query.q).toLowerCase();
  const rows = await RoomRent.find({ ...scope(req), ...dateRange(req, 'paidOn') }).sort({ paidOn: -1, createdAt: -1 }).limit(1000).populate(POP_BRANCH).lean();
  const items = rows.map(presentRent).filter((r) => !q || [r.landlord, r.reference, r.month].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items, summary: { entries: items.length, amount: items.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0) } });
}

/** The meter photo of one entry (kept out of the list). */
export async function roomRentPhoto(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Entry not found');
  const r = await RoomRent.findOne({ _id: req.params.id, ...branchFilter(req.user) }).select('+meterPhoto');
  if (!r) throw new HttpError(404, 'Entry not found');
  res.json({ photo: r.meterPhoto || null });
}

export async function createRoomRent(req, res) {
  const b = req.body || {};
  let party = null;
  if (asString(b.party)) {
    party = oid(asString(b.party)) ? await RentParty.findOne({ _id: b.party, isDeleted: false, isActive: true }) : null;
    if (!party) throw invalid({ party: 'Select the room owner / messenger from the list' });
  }
  const branch = await branchOf(req, party ? String(party.branch) : asString(b.branch));
  const month = asString(b.month);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid({ month: 'Choose the month the rent is for' });
  const landlord = party ? party.name : asString(b.landlord).replace(/\s+/g, ' ');
  if (landlord.length < 2 || landlord.length > 80) throw invalid({ landlord: 'Enter the name of the landlord (2–80 characters)' });
  // rent: what is typed; when nothing is typed, the amount set for the room owner / messenger
  const typed = b.rent !== undefined && b.rent !== '' ? b.rent : b.amount;
  const rentPaise = readMoney(typed === undefined || typed === '' ? party ? party.amountPaise / 100 : '' : typed, 'rent', 'the rent');
  // the meter of a room with an electricity meter: units used since the last reading, at the rate per unit
  let meter = {};
  let electricityPaise = 0;
  if (party?.kind === 'room' && party.meterIncluded) {
    const current = Number(asString(b.currentReading));
    if (!Number.isFinite(current) || asString(b.currentReading) === '') throw invalid({ currentReading: 'Enter the current meter reading' });
    if (current < party.lastReading) throw invalid({ currentReading: `The current reading cannot be less than the old reading (${party.lastReading})` });
    const photo = readPhoto(b.meterPhoto, 'meterPhoto', 'The photo of the current meter reading', { required: true });
    const units = round2(current - party.lastReading);
    electricityPaise = Math.round(units * (party.perUnitPaise || 0));
    meter = { prevReading: party.lastReading, currentReading: current, units, perUnitPaise: party.perUnitPaise || 0, electricityPaise, meterPhoto: photo };
  }
  const amountPaise = rentPaise + electricityPaise; // the total paid
  if (amountPaise < 100) throw invalid({ rent: 'The total to pay must be ₹1 or more' });
  const paidOn = b.paidOn ? readDate(b.paidOn, 'paidOn', { future: false }) : await defaultWorkDate(branch, req.user);
  if (!isAdmin(req.user) && startOfToday().getTime() - paidOn.getTime() > 30 * DAY) throw invalid({ paidOn: 'The date cannot be older than 30 days' });
  const payMode = asString(b.payMode) || 'cash';
  if (!['cash', 'bank', 'upi', 'cheque'].includes(payMode)) throw invalid({ payMode: 'Select how the rent is paid' });
  const bankAccount = await readBankAccount(b, payMode);
  await assertDayOpen(branch, paidOn, req.user);
  const label = KIND_LABEL[party?.kind || 'room'];
  const entry = await CashEntry.create({ branch, date: paidOn, side: 'payment', category: 'room_rent', amountPaise, mode: payMode, bankAccount, remark: `${label} ${month} — ${landlord}${electricityPaise ? ` (rent ${rentPaise / 100} + electricity ${electricityPaise / 100})` : ''}`.slice(0, 200), enteredByCode: req.user.employeeCode || '', createdBy: req.user._id });
  const r = await RoomRent.create({ branch, month, landlord, kind: party?.kind || 'other', party: party?._id, rentPaise, amountPaise, ...meter, paidOn, payMode, bankAccount, reference: asString(b.reference).slice(0, 60), remark: asString(b.remark).slice(0, 200), cashEntry: entry._id, enteredByCode: req.user.employeeCode || '' });
  if (meter.currentReading !== undefined) await RentParty.updateOne({ _id: party._id }, { $set: { lastReading: meter.currentReading } });
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
  // the meter goes back to the old reading when this was the last reading taken
  if (r.party && r.currentReading !== undefined && r.currentReading !== null) await RentParty.updateOne({ _id: r.party, lastReading: r.currentReading }, { $set: { lastReading: r.prevReading ?? 0 } });
  await audit(req, { action: 'roomRent.cancel', entity: 'RoomRent', entityId: r._id, after: { reason } });
  res.json({ status: 'cancelled' });
}

// ---- Room owners and messengers (registered by the admin only) ----------------------------------------------------------------

const presentParty = (p) => ({
  id: p._id, branch: brRef(p.branch), kind: p.kind, name: p.name, mobile: p.mobile || '', address: p.address || '', meterIncluded: Boolean(p.meterIncluded),
  openingReading: p.openingReading ?? 0, lastReading: p.lastReading ?? 0, perUnit: rupees(p.perUnitPaise), amount: rupees(p.amountPaise), isActive: p.isActive,
});

export async function listRentParties(req, res) {
  const filter = { isDeleted: false, ...scope(req) };
  if (['room', 'messenger'].includes(asString(req.query.kind))) filter.kind = req.query.kind;
  if (asString(req.query.active) === '1') filter.isActive = true;
  const rows = await RentParty.find(filter).sort({ kind: 1, name: 1 }).populate(POP_BRANCH).lean();
  res.json({ items: rows.map(presentParty) });
}

export async function getRentParty(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Not found');
  const p = await RentParty.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) }).select('+meterPhoto').populate(POP_BRANCH);
  if (!p) throw new HttpError(404, 'Not found');
  res.json({ item: { ...presentParty(p), meterPhoto: p.meterPhoto || '' } });
}

async function readParty(req, existing) {
  const b = req.body || {};
  const d = {};
  d.kind = existing ? existing.kind : asString(b.kind);
  if (!['room', 'messenger'].includes(d.kind)) throw invalid({ kind: 'Choose room owner or messenger' });
  d.branch = existing ? existing.branch : await branchOf(req, asString(b.branch));
  d.name = asString(b.name).replace(/\s+/g, ' ');
  if (d.name.length < 2 || d.name.length > 80) throw invalid({ name: 'Enter the name (2–80 characters)' });
  d.mobile = asString(b.mobile);
  if (!/^[6-9]\d{9}$/.test(d.mobile)) throw invalid({ mobile: 'Enter a valid 10-digit mobile number' });
  d.address = asString(b.address).slice(0, 300);
  if (d.kind === 'room') {
    if (d.address.length < 3) throw invalid({ address: 'Enter the address of the room' });
    d.meterIncluded = b.meterIncluded === true || b.meterIncluded === 'yes';
    d.amountPaise = readMoney(b.amount, 'amount', 'the monthly room rent');
    if (d.meterIncluded) {
      const opening = Number(asString(b.openingReading));
      if (!Number.isFinite(opening) || opening < 0 || asString(b.openingReading) === '') throw invalid({ openingReading: 'Enter the meter reading' });
      d.perUnitPaise = readMoney(b.perUnit, 'perUnit', 'the rate per unit', { min: 1 });
      const photo = readPhoto(b.meterPhoto, 'meterPhoto', 'The photo of the meter', { required: !existing });
      if (photo) d.meterPhoto = photo;
      d.openingReading = opening;
      if (!existing) d.lastReading = opening;
      else if (opening !== existing.openingReading && existing.lastReading === existing.openingReading) d.lastReading = opening; // no rent paid on the meter yet
    }
  } else {
    d.meterIncluded = false;
    d.amountPaise = readMoney(b.amount, 'amount', 'the amount', { min: 100 });
  }
  return d;
}

export async function createRentParty(req, res) {
  const d = await readParty(req, null);
  const p = await RentParty.create({ ...d, createdByCode: req.user.employeeCode || '' });
  await p.populate(POP_BRANCH);
  await audit(req, { action: 'rentParty.create', entity: 'RentParty', entityId: p._id, after: { kind: p.kind, name: p.name } });
  res.status(201).json({ item: presentParty(p) });
}

export async function updateRentParty(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Not found');
  const p = await RentParty.findOne({ _id: req.params.id, isDeleted: false });
  if (!p) throw new HttpError(404, 'Not found');
  Object.assign(p, await readParty(req, p));
  if (typeof req.body?.isActive === 'boolean') p.isActive = req.body.isActive;
  await p.save();
  await p.populate(POP_BRANCH);
  await audit(req, { action: 'rentParty.update', entity: 'RentParty', entityId: p._id, after: { name: p.name } });
  res.json({ item: presentParty(p) });
}

export async function deleteRentParty(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Not found');
  const p = await RentParty.findOne({ _id: req.params.id, isDeleted: false });
  if (!p) throw new HttpError(404, 'Not found');
  p.isDeleted = true;
  await p.save();
  await audit(req, { action: 'rentParty.delete', entity: 'RentParty', entityId: p._id, after: { name: p.name } });
  res.json({ message: 'Deleted' });
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

const presentComplaint = (c) => ({ id: c._id, complaintNo: c.complaintNo, date: iso(c.date), callerName: c.callerName, callerMobile: c.callerMobile || '', branch: brRef(c.branch), memberCode: c.memberCode || '', husbandName: c.husbandName || '', groupCode: c.groupCode || '', groupName: c.groupName || '', groupLeaderName: c.groupLeaderName || '', category: c.category, description: c.description, assignedTo: c.assignedToCode || '', status: c.status, resolution: c.resolution || '', resolvedAt: c.resolvedAt, history: (c.history || []).map((h) => ({ status: h.status, remark: h.remark || '', by: h.byCode || '', at: h.at })), enteredBy: c.enteredByCode || '' });

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
    complaintNo: await generateCode('complaint'), date: b.date ? readDate(b.date, 'date', { future: false }) : startOfToday(), callerName, callerMobile, branch, memberCode: asString(b.memberCode).toUpperCase().slice(0, 30), husbandName: asString(b.husbandName).replace(/\s+/g, ' ').slice(0, 80), groupCode: asString(b.groupCode).toUpperCase().slice(0, 30), groupName: asString(b.groupName).replace(/\s+/g, ' ').slice(0, 80), groupLeaderName: asString(b.groupLeaderName).replace(/\s+/g, ' ').slice(0, 80), category, description,
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

const presentReq = (r) => ({ id: r._id, reqNo: r.reqNo, branch: brRef(r.branch), department: r.department?.name || '', designation: r.designation?.name || '', count: r.count, reason: r.reason || '', requiredBy: iso(r.requiredBy), expectedTime: r.expectedTime || '', status: r.status, remark: r.remark || '', decidedBy: r.decidedByCode || '', requestedBy: r.requestedByCode || '', createdAt: r.createdAt });
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
  const r = await Requirement.create({ reqNo: await generateCode('empRequirement'), branch, ...ids, count, reason, requiredBy: b.requiredBy ? readDate(b.requiredBy, 'requiredBy') : undefined, expectedTime: asString(b.expectedTime).replace(/\s+/g, ' ').slice(0, 60), requestedByCode: req.user.employeeCode || '' });
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

const presentLeave = (l) => ({ id: l._id, employeeCode: l.employeeCode, employeeName: l.employeeName, branch: brRef(l.branch), type: l.type, from: iso(l.from), to: iso(l.to), days: l.days, reason: l.reason || '', approver: l.approverCode ? `${l.approverCode} ${l.approverName || ''}`.trim() : '', status: l.status, rejectReason: l.rejectReason || '', decisionRemark: l.decisionRemark || '', decidedBy: l.decidedByCode || '', appliedBy: l.appliedByCode || '', createdAt: l.createdAt });
const leaveDates = (from, to) => { const out = []; for (let d = from.getTime(); d <= to.getTime(); d += DAY) { const x = new Date(d); if (x.getUTCDay() !== 0) out.push(x); } return out; };

const HR_ROLES = ['super_admin', 'admin', 'branch_manager', 'accountant'];
const myEmployeeId = async (req) => (await Employee.findOne({ user: req.user._id, isDeleted: false }).select('_id').lean())?._id;

/** The leaves of the branches (admin, branch manager, accountant); a supervisor sees the leaves that came to them. */
export async function listLeaves(req, res) {
  const mine = await myEmployeeId(req);
  let filter;
  if (HR_ROLES.includes(req.user.role)) {
    filter = { ...scope(req), ...dateRange(req, 'from') };
    if (asString(req.query.mine) === '1') filter.approver = mine || null;
  } else {
    if (!mine) return res.json({ items: [], summary: { applications: 0, pending: 0, approvedDays: 0 } });
    filter = { approver: mine, ...dateRange(req, 'from') };
  }
  const st = asString(req.query.status);
  if (['pending', 'approved', 'rejected'].includes(st)) filter.status = st;
  const q = asString(req.query.q).toLowerCase();
  const rows = await Leave.find(filter).sort({ from: -1, createdAt: -1 }).limit(1000).populate(POP_BRANCH).lean();
  const items = rows.map(presentLeave).filter((l) => !q || [l.employeeCode, l.employeeName, l.reason, l.approver].some((v) => String(v).toLowerCase().includes(q)));
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
  const type = asString(b.type) || 'earned';
  if (type !== 'earned') throw invalid({ type: 'Only earned leave (EL) is given: 1 for every month, 12 in a financial year' });
  const days = leaveDates(from, to).length;
  if (!days) throw invalid({ to: 'These dates are only Sundays (the weekly off)' });
  const bal = await elBalance(e);
  if (days > bal.available) throw new HttpError(422, `Only ${bal.available} EL available (carried ${bal.opening} + earned ${bal.earned} − taken ${bal.used}). EL is not given in advance.`, { to: `Only ${bal.available} EL available` });
  const clash = await Leave.findOne({ employee: e._id, status: { $in: ['pending', 'approved'] }, from: { $lte: to }, to: { $gte: from } }).select('from to status').lean();
  if (clash) throw new HttpError(409, `The employee already has a ${clash.status} leave from ${iso(clash.from)} to ${iso(clash.to)}`, { from: 'Overlaps another leave' });
  const reason = asString(b.reason).slice(0, 300);
  if (reason.length < 3) throw invalid({ reason: 'Write the reason for the leave' });
  const sup = e.supervisor ? await Employee.findOne({ _id: e.supervisor, isDeleted: false }).select('employeeCode name') : null;
  const l = await Leave.create({ employee: e._id, employeeCode: e.employeeCode, employeeName: e.name, branch: e.branch?._id, type, from, to, days, reason, approver: sup?._id, approverCode: sup?.employeeCode, approverName: sup?.name, appliedByCode: req.user.employeeCode || '' });
  await l.populate(POP_BRANCH);
  // the leave goes to the supervisor of the employee, by mail and in the app
  if (sup) notifyEmployee(sup._id, 'Leave to approve', `${e.name} (${e.employeeCode}) applied for earned leave from ${iso(from)} to ${iso(to)} (${days} day${days === 1 ? '' : 's'}). Reason: ${reason}`);
  await audit(req, { action: 'leave.apply', entity: 'Leave', entityId: l._id, after: { employee: e.employeeCode, from: iso(from), to: iso(to), days } });
  res.status(201).json({ item: presentLeave(l) });
}
/** Approved leave is marked as Leave in the attendance of every working day of it (so it is paid in the salary). */
export async function decideLeave(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Leave not found');
  // the supervisor of the employee decides; the admin and the branch manager can too
  const mgmt = ['super_admin', 'admin', 'branch_manager'].includes(req.user.role);
  let l = mgmt ? await Leave.findOne({ _id: req.params.id, ...branchFilter(req.user) }) : null;
  if (!l) { const mine = await myEmployeeId(req); if (mine) l = await Leave.findOne({ _id: req.params.id, approver: mine }); }
  if (!l) throw new HttpError(404, 'Leave not found');
  await l.populate(POP_BRANCH);
  if (l.status !== 'pending') throw new HttpError(409, `This leave is already ${l.status}`);
  const status = asString(req.body?.status);
  if (!['approved', 'rejected'].includes(status)) throw invalid({ status: 'Choose approve or reject' });
  const reason = asString(req.body?.reason).slice(0, 200);
  if (status === 'rejected' && reason.length < 3) throw invalid({ reason: 'Enter the reason' });
  l.status = status; l.decidedByCode = req.user.employeeCode || ''; l.decidedAt = new Date(); l.rejectReason = status === 'rejected' ? reason : undefined; l.decisionRemark = status === 'approved' ? reason : undefined;
  await l.save();
  notifyEmployee(l.employee, `Leave ${status}`, `Your earned leave from ${iso(l.from)} to ${iso(l.to)} (${l.days} day${l.days === 1 ? '' : 's'}) is ${status}${reason ? `: ${reason}` : ''}.`);
  if (status === 'approved') {
    const ops = leaveDates(l.from, l.to).map((d) => ({ updateOne: { filter: { employee: l.employee, date: d }, update: { $set: { status: 'leave', source: 'manual', remark: 'Leave approved', markedByCode: req.user.employeeCode || '' }, $unset: { firstActivity: '', lastActivity: '' } }, upsert: true } }));
    if (ops.length) await Attendance.bulkWrite(ops);
  }
  await audit(req, { action: `leave.${status}`, entity: 'Leave', entityId: l._id, after: { employee: l.employeeCode, days: l.days } });
  res.json({ item: presentLeave(l) });
}

// ---- Resignation approval ---------------------------------------------------------------------------------------------------

const presentResign = (r) => ({ id: r._id, employeeCode: r.employeeCode, employeeName: r.employeeName, branch: brRef(r.branch), appliedOn: iso(r.appliedOn), lastWorkingDate: iso(r.lastWorkingDate), noticePeriodDate: iso(r.noticePeriodDate), reason: r.reason || '', status: r.status, rejectReason: r.rejectReason || '', decidedBy: r.decidedByCode || '' });

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
  // the notice period date is set before the resignation is approved: the employee leaves on it
  if (status === 'approved') {
    if (!asString(req.body?.noticePeriodDate)) throw invalid({ noticePeriodDate: 'Enter the notice period date before approving' });
    const notice = readDate(req.body.noticePeriodDate, 'noticePeriodDate');
    if (notice < r.appliedOn) throw invalid({ noticePeriodDate: 'The notice period date cannot be before the date of the resignation' });
    r.noticePeriodDate = notice;
    r.lastWorkingDate = notice;
  }
  r.status = status; r.decidedByCode = req.user.employeeCode || ''; r.decidedAt = new Date(); r.rejectReason = status === 'rejected' ? reason : undefined;
  await r.save();
  if (status === 'approved') await Employee.updateOne({ _id: r.employee }, { $set: { status: 'left', leftOn: r.lastWorkingDate } });
  notifyEmployee(r.employee, `Resignation ${status}`, status === 'approved' ? `Your resignation is approved. The notice period ends on ${iso(r.noticePeriodDate)}, which is your last working day.` : `Your resignation was not approved: ${reason}`);
  await audit(req, { action: `resignation.${status}`, entity: 'Resignation', entityId: r._id, after: { employee: r.employeeCode } });
  res.json({ item: presentResign(r) });
}

// ---- Promotion and transfer, with the letter -------------------------------------------------------------------------------

const presentChange = (c) => ({ id: c._id, letterNo: c.letterNo, kind: c.kind, employeeCode: c.employeeCode, employeeName: c.employeeName, effectiveDate: iso(c.effectiveDate), fromDesignation: c.fromDesignation || '', toDesignation: c.toDesignation || '', fromBranch: c.fromBranchName || '', toBranch: c.toBranchName || '', fromSalary: rupees(c.fromSalaryPaise), toSalary: rupees(c.toSalaryPaise), salaryLines: (c.salaryLines || []).map((l) => ({ key: l.key, label: l.label, amount: rupees(l.amountPaise) })), remark: c.remark || '', by: c.byCode || '' });

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
    // salary boxes: the components that change (basic, HRA ...) with the new amounts, any number of them
    const boxes = Array.isArray(b.salaryLines) ? b.salaryLines.filter((x) => x && asString(x.key) && asString(x.amount) !== '') : [];
    if (boxes.length) {
      const labels = new Map(EARN_FIXED);
      const structure = { ...fixedOf(e) };
      const seen = new Set();
      const lines = [];
      for (const x of boxes) {
        const key = asString(x.key);
        if (!labels.has(key)) throw invalid({ salaryLines: 'Choose the salary box from the list' });
        if (seen.has(key)) throw invalid({ salaryLines: `${labels.get(key)} is added twice` });
        seen.add(key);
        const p = toMinor(typeof x.amount === 'number' ? String(x.amount) : asString(x.amount));
        if (p === null || p < 0) throw invalid({ salaryLines: `Enter the amount of ${labels.get(key)} (₹, up to 2 decimals)` });
        structure[key] = p;
        lines.push({ key, label: labels.get(key), amountPaise: p });
      }
      const total = Object.values(structure).reduce((s, v) => s + v, 0);
      set.salaryStructure = structure;
      set.monthlySalaryPaise = total;
      doc.toSalaryPaise = total;
      doc.salaryLines = lines;
    } else if (asString(b.toSalary) !== '') {
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
  // the employee gets it by mail and in the app
  notifyEmployee(e._id, kind === 'promotion' ? `Promotion — letter ${c.letterNo}` : `Transfer — letter ${c.letterNo}`, kind === 'promotion'
    ? `You are promoted from ${doc.fromDesignation || 'your present post'} to ${doc.toDesignation} with effect from ${iso(effectiveDate)}.${(doc.salaryLines || []).length ? ` Salary: ${doc.salaryLines.map((l) => `${l.label} Rs ${l.amountPaise / 100}`).join(', ')}; monthly total Rs ${doc.toSalaryPaise / 100}.` : doc.toSalaryPaise !== doc.fromSalaryPaise ? ` Your monthly salary is Rs ${doc.toSalaryPaise / 100}.` : ''}${remark ? ` ${remark}` : ''}`
    : `You are transferred from ${doc.fromBranchName} to ${doc.toBranchName} with effect from ${iso(effectiveDate)}.${remark ? ` ${remark}` : ''}`);
  await audit(req, { action: `employee.${kind}`, entity: 'Employee', entityId: e._id, after: { letterNo: c.letterNo, from: doc.fromDesignation || doc.fromBranchName, to: doc.toDesignation || doc.toBranchName } });
  res.status(201).json({ item: presentChange(c) });
}

/** The letterhead of the company for the letters. */
export async function letterhead(_req, res) {
  const c = await Company.findOne({ singleton: 'company' }).lean();
  res.json({ company: c ? { name: c.name, address: c.address, city: c.city || '', state: c.state || '', pincode: c.pincode || '', email: c.email, mobile: c.mobile, pan: c.pan, cin: c.cin, logo: c.logoImage || null, stamp: c.stampImage || null, signature: c.signatureImage || null } : null });
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

// ---- Earned leave balance -------------------------------------------------------------------------------------------------------

/** The EL of one employee: carried from the earlier years, earned this financial year, taken, and what can be taken now. */
export async function leaveBalance(req, res) {
  const e = await employeeOf(req, req.query.employee);
  res.json({ balance: await elBalance(e) });
}

/** The EL of every working employee of the branch(es). */
export async function leaveBalances(req, res) {
  const emps = await Employee.find({ isDeleted: false, status: 'active', ...scope(req) }).select('employeeCode name branch joiningDate').populate(POP_BRANCH).sort({ employeeCode: 1 }).limit(2000).lean();
  const bal = await elBalances(emps);
  const q = asString(req.query.q).toLowerCase();
  const items = emps.map((e) => ({ id: e._id, employeeCode: e.employeeCode, name: e.name, branch: brRef(e.branch), joiningDate: iso(e.joiningDate), ...bal.get(String(e._id)) })).filter((x) => !q || [x.employeeCode, x.name].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items, financialYear: items[0]?.financialYear || '' });
}

// ---- Target tasks ---------------------------------------------------------------------------------------------------------------------

const TARGET_KEYS = ['newMember', 'd6', 'newGroup', 'npaRecovery'];

/** What the employees of a target task achieved in its period: members registered, groups opened and NPA recovered under their employee code. */
async function achievements(task) {
  const codes = task.employees.map((e) => e.code);
  const range = { $gte: task.fromDate, $lte: task.toDate };
  const [mem, grp, npa] = await Promise.all([
    Member.aggregate([{ $match: { isDeleted: false, employeeCode: { $in: codes }, joiningDate: range } }, { $group: { _id: '$employeeCode', n: { $sum: 1 } } }]),
    Group.aggregate([{ $match: { isDeleted: false, employeeCode: { $in: codes }, openingDate: range } }, { $group: { _id: '$employeeCode', n: { $sum: 1 } } }]),
    EmiPayment.aggregate([{ $match: { status: 'paid', npa: true, employeeCode: { $in: codes }, paidOn: range } }, { $group: { _id: '$employeeCode', t: { $sum: '$amountPaise' } } }]),
  ]);
  return { mem: new Map(mem.map((r) => [r._id, r.n])), grp: new Map(grp.map((r) => [r._id, r.n])), npa: new Map(npa.map((r) => [r._id, r.t])) };
}

/** One task with the result of every employee: target, achieved and what is pending (shown as −). */
async function presentTarget(t, allowed) {
  const a = await achievements(t);
  const tg = t.targets || {};
  const employees = t.employees.filter((e) => !allowed || allowed.has(String(e.branch))).map((e) => {
    const line = (target, achieved) => ({ target, achieved, pending: Math.max(target - achieved, 0) });
    const r = {
      newMember: line(tg.newMember || 0, a.mem.get(e.code) || 0), d6: line(tg.d6 || 0, e.d6Achieved || 0), newGroup: line(tg.newGroup || 0, a.grp.get(e.code) || 0), npaRecovery: line(rupees(tg.npaRecoveryPaise), rupees(a.npa.get(e.code) || 0)),
    };
    const done = TARGET_KEYS.every((k) => r[k].pending === 0);
    return { id: e.employee, code: e.code, name: e.name, branch: String(e.branch || ''), ...r, status: done ? 'done' : 'pending' };
  });
  return {
    id: t._id, fromDate: iso(t.fromDate), toDate: iso(t.toDate), rank: t.rankName || '', status: t.status, remark: t.remark || '', by: t.createdByCode || '', ended: t.toDate < startOfToday(),
    targets: { newMember: tg.newMember || 0, d6: tg.d6 || 0, newGroup: tg.newGroup || 0, npaRecovery: rupees(tg.npaRecoveryPaise) }, employees,
    summary: { employees: employees.length, done: employees.filter((x) => x.status === 'done').length, pending: employees.filter((x) => x.status === 'pending').length },
  };
}

const allowedBranches = (req) => { const f = branchFilter(req.user); return f.branch ? new Set(f.branch.$in.map(String)) : null; };

export async function targetOptions(_req, res) {
  const ranks = await Rank.find({ isDeleted: false, isActive: true }).select('code name level').sort({ level: 1 }).lean();
  res.json({ ranks: ranks.map((r) => ({ id: r._id, code: r.code, name: r.name })) });
}

export async function createTargetTask(req, res) {
  const b = req.body || {};
  const fromDate = readDate(b.fromDate, 'fromDate');
  const toDate = readDate(b.toDate, 'toDate');
  if (toDate < fromDate) throw invalid({ toDate: 'The last date cannot be before the first date' });
  const count = (v, label) => {
    const n = v === '' || v === undefined ? 0 : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw invalid({ [label]: 'Enter a whole number' });
    return n;
  };
  const npaRecoveryPaise = b.npaRecovery === '' || b.npaRecovery === undefined ? 0 : toMinor(typeof b.npaRecovery === 'number' ? String(b.npaRecovery) : asString(b.npaRecovery));
  if (npaRecoveryPaise === null || npaRecoveryPaise < 0) throw invalid({ npaRecovery: 'Enter the target amount (₹)' });
  const targets = { newMember: count(b.newMember, 'newMember'), d6: count(b.d6, 'd6'), newGroup: count(b.newGroup, 'newGroup'), npaRecoveryPaise };
  if (!targets.newMember && !targets.d6 && !targets.newGroup && !targets.npaRecoveryPaise) throw invalid({ newMember: 'Give at least one target' });
  // the employees: every working employee of the rank (their staff login has the rank), and/or the ones chosen
  const filter = { isDeleted: false, status: 'active', ...branchFilter(req.user) };
  if (oid(asString(b.branch))) filter.branch = new mongoose.Types.ObjectId(asString(b.branch));
  let rank;
  const ors = [];
  if (asString(b.rank)) {
    rank = oid(b.rank) ? await Rank.findOne({ _id: b.rank, isDeleted: false }).select('name') : null;
    if (!rank) throw invalid({ rank: 'Select the rank from the list' });
    const users = (await User.find({ rank: rank._id }).select('_id').lean()).map((u) => u._id);
    ors.push({ user: { $in: users } });
  }
  const chosen = (Array.isArray(b.employees) ? b.employees : []).filter(oid);
  if (chosen.length) ors.push({ _id: { $in: chosen } });
  if (!ors.length) throw invalid({ rank: 'Select the rank (or the employees) the task is for' });
  const emps = await Employee.find({ ...filter, $or: ors }).select('employeeCode name branch').lean();
  if (!emps.length) throw invalid({ rank: 'No working employee found for this rank in your branches' });
  const t = await TargetTask.create({
    fromDate, toDate, rank: rank?._id, rankName: rank?.name || '', branch: filter.branch instanceof mongoose.Types.ObjectId ? filter.branch : undefined, targets, remark: asString(b.remark).slice(0, 300),
    employees: emps.map((e) => ({ employee: e._id, code: e.employeeCode, name: e.name, branch: e.branch })), createdByCode: req.user.employeeCode || '',
  });
  await audit(req, { action: 'targetTask.create', entity: 'TargetTask', entityId: t._id, after: { from: iso(fromDate), to: iso(toDate), employees: emps.length } });
  res.status(201).json({ item: await presentTarget(t, allowedBranches(req)) });
}

/** The target tasks of a month (the ones that run in it), with the result of each employee. */
export async function listTargetTasks(req, res) {
  const month = asString(req.query.month);
  const filter = {};
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    filter.fromDate = { $lte: new Date(Date.UTC(y, m, 0)) };
    filter.toDate = { $gte: new Date(Date.UTC(y, m - 1, 1)) };
  }
  const allowed = allowedBranches(req);
  if (allowed) filter['employees.branch'] = { $in: [...allowed].map((x) => new mongoose.Types.ObjectId(x)) };
  const rows = await TargetTask.find(filter).sort({ fromDate: -1, createdAt: -1 }).limit(100);
  const items = [];
  for (const t of rows) items.push(await presentTarget(t, allowed)); // eslint-disable-line no-await-in-loop
  res.json({ items });
}

/** The employees whose earlier (ended) tasks are still pending, with what they owe. */
export async function pendingOldTargets(req, res) {
  const allowed = allowedBranches(req);
  const filter = { status: 'active', toDate: { $lt: startOfToday() } };
  if (allowed) filter['employees.branch'] = { $in: [...allowed].map((x) => new mongoose.Types.ObjectId(x)) };
  const rows = await TargetTask.find(filter).sort({ toDate: -1 }).limit(60);
  const by = new Map();
  for (const t of rows) {
    // eslint-disable-next-line no-await-in-loop
    const p = await presentTarget(t, allowed);
    p.employees.filter((e) => e.status === 'pending').forEach((e) => {
      const v = by.get(e.code) || { code: e.code, name: e.name, tasks: [] };
      v.tasks.push({ id: p.id, from: p.fromDate, to: p.toDate, newMember: e.newMember.pending, d6: e.d6.pending, newGroup: e.newGroup.pending, npaRecovery: e.npaRecovery.pending });
      by.set(e.code, v);
    });
  }
  res.json({ items: [...by.values()].sort((a, b) => b.tasks.length - a.tasks.length) });
}

/** D6 has no figure in the system: what an employee did is entered by hand. */
export async function setTargetD6(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Task not found');
  const n = Number(req.body?.achieved);
  if (!Number.isInteger(n) || n < 0) throw invalid({ achieved: 'Enter a whole number' });
  const t = await TargetTask.findById(req.params.id);
  const allowed = allowedBranches(req);
  const e = t?.employees.find((x) => String(x.employee) === String(req.body?.employee) && (!allowed || allowed.has(String(x.branch))));
  if (!e) throw new HttpError(404, 'Task or employee not found');
  e.d6Achieved = n;
  await t.save();
  res.json({ item: await presentTarget(t, allowed) });
}

export async function cancelTargetTask(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Task not found');
  const t = await TargetTask.findById(req.params.id);
  if (!t) throw new HttpError(404, 'Task not found');
  t.status = 'cancelled';
  await t.save();
  await audit(req, { action: 'targetTask.cancel', entity: 'TargetTask', entityId: t._id });
  res.json({ status: 'cancelled' });
}

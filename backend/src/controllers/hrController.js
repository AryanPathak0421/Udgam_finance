import mongoose from 'mongoose';
import { Department, Designation, Employee, Attendance, Salary, ATTENDANCE_STATUS } from '../models/Hr.js';
import { User } from '../models/User.js';
import { Branch } from '../models/Branch.js';
import { CashEntry } from '../models/CashEntry.js';
import { AuditLog } from '../models/AuditLog.js';
import { generateCode } from '../services/codeSequence.js';
import { assertDayOpen } from '../services/dayOpen.js';
import { readBankAccount } from '../services/bankAccountPick.js';
import { sendSms } from '../services/sms.js';
import { asString, parseDateOnly, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { branchFilter, isAdmin, showMobile } from './groupController.js';

/**
 * HR Department: departments and designations, employee registration, attendance (automatic from the work done in the system, and manual),
 * salary (generated from the attendance, sent to the employee, paid through the Cashbook) and the salary branch wise.
 */
const DAY = 24 * 3600 * 1000;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const rupees = (p) => (p || 0) / 100;
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const MOBILE_RE = /^[6-9]\d{9}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** The branches of a request: the user's own, narrowed to the chosen one (never widened). */
function scope(req, field = 'branch') {
  const filter = branchFilter(req.user);
  const wanted = asString(req.query.branch);
  if (mongoose.isValidObjectId(wanted)) {
    const own = filter.branch?.$in?.map(String);
    return own && !own.includes(wanted) ? { [field]: { $in: [] } } : { [field]: new mongoose.Types.ObjectId(wanted) };
  }
  return filter.branch ? { [field]: { $in: filter.branch.$in.map((b) => new mongoose.Types.ObjectId(String(b))) } } : {};
}

// ---- Department master and Designation master -------------------------------------------------------------------------

function master(Model, label, extra) {
  const present = (x) => ({ id: x._id, name: x.name, isActive: x.isActive, ...(extra?.present ? extra.present(x) : {}), createdAt: x.createdAt });
  return {
    async list(req, res) {
      const q = asString(req.query.q).toLowerCase();
      let query = Model.find({ isDeleted: false }).sort({ name: 1 });
      if (extra?.populate) query = query.populate(extra.populate);
      const rows = await query.lean();
      const used = await extra.usage();
      res.json({ items: rows.filter((x) => !q || x.name.toLowerCase().includes(q)).map((x) => ({ ...present(x), employees: used.get(String(x._id)) || 0 })) });
    },
    async create(req, res) {
      const name = asString(req.body?.name).replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 60) throw invalid({ name: `Enter the ${label} name (2–60 characters)` });
      const data = { name, createdByCode: req.user.employeeCode || '', ...(await extra.read(req.body)) };
      try {
        const x = await Model.create(data);
        await audit(req, { action: `${label}.create`, entity: Model.modelName, entityId: x._id, after: { name } });
        res.status(201).json({ item: present(x) });
      } catch (err) {
        if (err.code === 11000) throw new HttpError(409, `A ${label} with this name already exists`, { name: 'This name is already used' });
        throw err;
      }
    },
    async update(req, res) {
      const x = await load(Model, req.params.id, label);
      const name = asString(req.body?.name).replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 60) throw invalid({ name: `Enter the ${label} name (2–60 characters)` });
      x.name = name;
      Object.assign(x, await extra.read(req.body));
      try { await x.save(); } catch (err) {
        if (err.code === 11000) throw new HttpError(409, `A ${label} with this name already exists`, { name: 'This name is already used' });
        throw err;
      }
      await audit(req, { action: `${label}.update`, entity: Model.modelName, entityId: x._id, after: { name } });
      res.json({ item: present(x) });
    },
    async status(req, res) {
      const x = await load(Model, req.params.id, label);
      x.isActive = Boolean(req.body?.isActive);
      await x.save();
      res.json({ isActive: x.isActive });
    },
    async remove(req, res) {
      const x = await load(Model, req.params.id, label);
      if ((await extra.usage()).get(String(x._id))) throw new HttpError(409, `This ${label} is used by employees. Stop it instead of deleting it.`);
      x.isDeleted = true;
      await x.save();
      await audit(req, { action: `${label}.delete`, entity: Model.modelName, entityId: x._id, after: { name: x.name } });
      res.json({ message: 'Deleted' });
    },
  };
}
async function load(Model, id, label) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, `${label} not found`);
  const x = await Model.findOne({ _id: id, isDeleted: false });
  if (!x) throw new HttpError(404, `${label} not found`);
  return x;
}
const countBy = async (field) => new Map((await Employee.aggregate([{ $match: { isDeleted: false, [field]: { $exists: true, $ne: null } } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }])).map((r) => [String(r._id), r.n]));

export const departments = master(Department, 'department', { usage: () => countBy('department'), read: async () => ({}) });
export const designations = master(Designation, 'designation', {
  usage: () => countBy('designation'),
  populate: 'department',
  present: (x) => ({ department: x.department?._id ? { id: x.department._id, name: x.department.name } : x.department ? { id: x.department } : null }),
  read: async (b) => {
    const dep = asString(b.department);
    if (!dep) return { department: undefined };
    if (!mongoose.isValidObjectId(dep) || !(await Department.exists({ _id: dep, isDeleted: false }))) throw invalid({ department: 'Select a department from the list' });
    return { department: dep };
  },
});

// ---- Employee registration ------------------------------------------------------------------------------------------------

const presentEmployee = (e, user) => ({
  id: e._id, employeeCode: e.employeeCode, name: e.name, mobile: showMobile(user, e.mobile), email: e.email || '', address: e.address || '',
  department: e.department?._id ? { id: e.department._id, name: e.department.name } : null, designation: e.designation?._id ? { id: e.designation._id, name: e.designation.name } : null,
  branch: e.branch?._id ? { id: e.branch._id, code: e.branch.code, name: e.branch.name } : null, joiningDate: iso(e.joiningDate), monthlySalary: rupees(e.monthlySalaryPaise),
  bankName: e.bankName || '', ifsc: e.ifsc || '', accountNumber: isAdmin(user) ? e.accountNumber || '' : e.accountNumber ? `XXXXX${String(e.accountNumber).slice(-4)}` : '',
  status: e.status, leftOn: iso(e.leftOn), hasLogin: Boolean(e.user), isBlocked: Boolean(e.isBlocked), blockReason: e.blockReason || '',
});
const EMP_POPULATE = [{ path: 'department', select: 'name' }, { path: 'designation', select: 'name' }, { path: 'branch', select: 'code name' }];

export async function listEmployees(req, res) {
  const filter = { isDeleted: false, ...scope(req) };
  const st = asString(req.query.status);
  if (['active', 'left'].includes(st)) filter.status = st;
  for (const k of ['department', 'designation']) if (mongoose.isValidObjectId(asString(req.query[k]))) filter[k] = req.query[k];
  const q = asString(req.query.q).toLowerCase();
  const rows = await Employee.find(filter).sort({ employeeCode: 1 }).limit(3000).populate(EMP_POPULATE);
  const items = rows.map((e) => presentEmployee(e, req.user)).filter((e) => !q || [e.employeeCode, e.name, e.mobile].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items, summary: { employees: items.length, active: items.filter((e) => e.status === 'active').length, monthlySalary: items.filter((e) => e.status === 'active').reduce((s, e) => s + e.monthlySalary, 0) } });
}

/** Staff logins that have no HR record yet. */
export async function employeeStaffOptions(_req, res) {
  const linked = (await Employee.find({ isDeleted: false, user: { $exists: true } }).select('user').lean()).map((e) => e.user);
  const users = await User.find({ _id: { $nin: linked }, employeeCode: { $exists: true, $ne: '' } }).select('name employeeCode mobile role branches').populate('branches', 'code').sort({ name: 1 }).lean();
  res.json({ items: users.map((u) => ({ id: u._id, employeeCode: u.employeeCode, name: u.name, mobile: u.mobile || '', role: u.role, branches: (u.branches || []).map((b) => b.code).join(', ') })) });
}

async function readEmployee(b) {
  const d = {};
  d.name = asString(b.name).replace(/\s+/g, ' ');
  if (d.name.length < 2 || d.name.length > 80) throw invalid({ name: 'Enter the name (2–80 characters)' });
  d.mobile = asString(b.mobile);
  if (d.mobile && !MOBILE_RE.test(d.mobile)) throw invalid({ mobile: 'Enter a valid 10-digit mobile number' });
  d.email = asString(b.email).toLowerCase();
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) throw invalid({ email: 'Enter a valid email address' });
  d.address = asString(b.address).slice(0, 300);
  for (const [k, Model] of [['department', Department], ['designation', Designation]]) {
    const v = asString(b[k]);
    if (!v) { d[k] = undefined; continue; }
    if (!mongoose.isValidObjectId(v) || !(await Model.exists({ _id: v, isDeleted: false }))) throw invalid({ [k]: `Select the ${k} from the list` });
    d[k] = v;
  }
  const branch = asString(b.branch);
  if (!mongoose.isValidObjectId(branch) || !(await Branch.exists({ _id: branch }))) throw invalid({ branch: 'Select the branch' });
  d.branch = branch;
  if (b.joiningDate) {
    d.joiningDate = parseDateOnly(asString(b.joiningDate));
    if (!d.joiningDate) throw invalid({ joiningDate: 'Enter a valid date' });
  }
  const sal = b.monthlySalary === '' || b.monthlySalary === undefined ? 0 : toMinor(typeof b.monthlySalary === 'number' ? String(b.monthlySalary) : asString(b.monthlySalary));
  if (sal === null || sal < 0) throw invalid({ monthlySalary: 'Enter the monthly salary (₹, up to 2 decimals)' });
  d.monthlySalaryPaise = sal;
  d.bankName = asString(b.bankName).slice(0, 80);
  d.ifsc = asString(b.ifsc).toUpperCase();
  if (d.ifsc && !IFSC_RE.test(d.ifsc)) throw invalid({ ifsc: 'Enter a valid IFSC code' });
  d.accountNumber = asString(b.accountNumber);
  if (d.accountNumber && !/^\d{9,18}$/.test(d.accountNumber)) throw invalid({ accountNumber: 'Account number must be 9–18 digits' });
  return d;
}

export async function createEmployee(req, res) {
  const b = req.body || {};
  const d = await readEmployee(b);
  let user;
  if (asString(b.user)) {
    user = mongoose.isValidObjectId(asString(b.user)) ? await User.findById(b.user) : null;
    if (!user || !user.employeeCode) throw invalid({ user: 'Select a staff login that has an employee code' });
    if (await Employee.exists({ user: user._id, isDeleted: false })) throw new HttpError(409, 'This staff login already has an HR record', { user: 'Already registered' });
    d.employeeCode = user.employeeCode;
  } else {
    d.employeeCode = await generateCode('employee');
  }
  try {
    const e = await Employee.create({ ...d, user: user?._id, status: 'active', createdByCode: req.user.employeeCode || '' });
    await e.populate(EMP_POPULATE);
    await audit(req, { action: 'employee.register', entity: 'Employee', entityId: e._id, after: { employeeCode: e.employeeCode, name: e.name } });
    res.status(201).json({ item: presentEmployee(e, req.user) });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'This employee is already registered', { name: 'Already registered' });
    throw err;
  }
}

export async function updateEmployee(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Employee not found');
  const e = await Employee.findOne({ _id: req.params.id, isDeleted: false });
  if (!e) throw new HttpError(404, 'Employee not found');
  Object.assign(e, await readEmployee(req.body || {}));
  await e.save();
  await e.populate(EMP_POPULATE);
  await audit(req, { action: 'employee.update', entity: 'Employee', entityId: e._id, after: { employeeCode: e.employeeCode, name: e.name } });
  res.json({ item: presentEmployee(e, req.user) });
}

/** An employee who leaves is kept (their salary and attendance stay) and no longer gets salary generated from the leaving month on. */
export async function setEmployeeStatus(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Employee not found');
  const e = await Employee.findOne({ _id: req.params.id, isDeleted: false });
  if (!e) throw new HttpError(404, 'Employee not found');
  const left = req.body?.status === 'left';
  e.status = left ? 'left' : 'active';
  e.leftOn = left ? parseDateOnly(asString(req.body?.leftOn)) || startOfToday() : undefined;
  await e.save();
  await audit(req, { action: 'employee.status', entity: 'Employee', entityId: e._id, after: { status: e.status } });
  res.json({ status: e.status, leftOn: iso(e.leftOn) });
}

/** Creates an HR record for every staff login (User Master) that has none: name, mobile and branch are taken over; department, designation and salary are filled in afterwards. */
export async function syncFromUsers(req, res) {
  const linked = new Set((await Employee.find({ isDeleted: false, user: { $exists: true } }).select('user').lean()).map((e) => String(e.user)));
  const codes = new Set((await Employee.find({ isDeleted: false }).select('employeeCode').lean()).map((e) => e.employeeCode));
  const users = await User.find({ employeeCode: { $exists: true, $ne: '' } }).select('name employeeCode mobile branches role').lean();
  let made = 0;
  let skipped = 0;
  for (const u of users) {
    if (linked.has(String(u._id)) || codes.has(u.employeeCode)) { skipped += 1; continue; }
    // eslint-disable-next-line no-await-in-loop
    await Employee.create({ employeeCode: u.employeeCode, user: u._id, name: u.name, mobile: MOBILE_RE.test(u.mobile || '') ? u.mobile : undefined, branch: (u.branches || [])[0], status: 'active', createdByCode: req.user.employeeCode || '' });
    made += 1;
  }
  await audit(req, { action: 'employee.sync', entity: 'Employee', after: { made, skipped } });
  res.json({ made, skipped });
}

export async function hrOptions(_req, res) {
  const [deps, desigs] = await Promise.all([
    Department.find({ isDeleted: false, isActive: true }).select('name').sort({ name: 1 }).lean(),
    Designation.find({ isDeleted: false, isActive: true }).select('name department').sort({ name: 1 }).lean(),
  ]);
  res.json({ departments: deps.map((d) => ({ id: d._id, name: d.name })), designations: desigs.map((d) => ({ id: d._id, name: d.name, department: d.department || null })) });
}

// ---- Attendance -----------------------------------------------------------------------------------------------------------------

const activeOn = (e, date) => e.status === 'active' || (e.leftOn && e.leftOn >= date);

/** The employees of the branch(es) for a date with what is marked for them. */
export async function attendanceDay(req, res) {
  const date = parseDateOnly(asString(req.query.date)) || startOfToday();
  const emps = (await Employee.find({ isDeleted: false, ...scope(req) }).sort({ employeeCode: 1 }).populate(EMP_POPULATE)).filter((e) => activeOn(e, date) && (!e.joiningDate || e.joiningDate <= date));
  const marks = new Map((await Attendance.find({ date, employee: { $in: emps.map((e) => e._id) } }).lean()).map((a) => [String(a.employee), a]));
  const items = emps.map((e) => {
    const a = marks.get(String(e._id));
    return { id: e._id, employeeCode: e.employeeCode, name: e.name, branch: e.branch?.code || '', designation: e.designation?.name || '', status: a?.status || '', source: a?.source || '', firstActivity: a?.firstActivity || null, lastActivity: a?.lastActivity || null, remark: a?.remark || '', hasLogin: Boolean(e.user) };
  });
  const count = (s) => items.filter((i) => i.status === s).length;
  res.json({ date: iso(date), sunday: date.getUTCDay() === 0, items, summary: { employees: items.length, present: count('present'), half_day: count('half_day'), leave: count('leave'), holiday: count('holiday'), absent: count('absent'), notMarked: items.filter((i) => !i.status).length } });
}

/** Marks attendance by hand for a date. Marking replaces what was there (auto or manual). */
export async function markAttendance(req, res) {
  const date = parseDateOnly(asString(req.body?.date));
  if (!date) throw invalid({ date: 'Enter a valid date' });
  if (date > startOfToday()) throw invalid({ date: 'Attendance cannot be marked for a future date' });
  if (!isAdmin(req.user) && startOfToday().getTime() - date.getTime() > 30 * DAY) throw invalid({ date: 'The date cannot be older than 30 days' });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) throw invalid({ items: 'Mark at least one employee' });
  const emps = new Map((await Employee.find({ _id: { $in: items.map((i) => i.employee).filter((x) => mongoose.isValidObjectId(String(x))) }, isDeleted: false, ...scope({ query: {}, user: req.user }) }).select('_id').lean()).map((e) => [String(e._id), e]));
  const ops = [];
  for (const it of items) {
    if (!emps.has(String(it.employee))) continue;
    if (it.status === '') { ops.push({ deleteOne: { filter: { employee: it.employee, date } } }); continue; }
    if (!ATTENDANCE_STATUS.includes(it.status)) throw invalid({ items: 'Choose present, absent, half day, leave or holiday' });
    ops.push({ updateOne: { filter: { employee: it.employee, date }, update: { $set: { status: it.status, source: 'manual', remark: asString(it.remark).slice(0, 100), markedByCode: req.user.employeeCode || '' }, $unset: { firstActivity: '', lastActivity: '' } }, upsert: true } });
  }
  if (ops.length) await Attendance.bulkWrite(ops);
  await audit(req, { action: 'attendance.mark', entity: 'Attendance', after: { date: iso(date), count: ops.length } });
  res.json({ saved: ops.length });
}

/**
 * Automatic attendance: an employee with a staff login who did anything in the system on the date (collected EMI, registered a member, made an entry ...) is
 * present, with the first and last time of that work. What was marked by hand is left alone.
 */
export async function autoAttendanceFor(date, employees) {
  const emps = employees || (await Employee.find({ isDeleted: false, user: { $exists: true } }).lean()).filter((e) => activeOn(e, date) && (!e.joiningDate || e.joiningDate <= date));
  const withLogin = emps.filter((e) => e.user);
  if (!withLogin.length) return 0;
  const acts = await AuditLog.aggregate([
    { $match: { actor: { $in: withLogin.map((e) => e.user) }, createdAt: { $gte: date, $lt: new Date(date.getTime() + DAY) } } },
    { $group: { _id: '$actor', first: { $min: '$createdAt' }, last: { $max: '$createdAt' } } },
  ]);
  const byUser = new Map(acts.map((a) => [String(a._id), a]));
  const manual = new Set((await Attendance.find({ date, employee: { $in: withLogin.map((e) => e._id) }, source: 'manual' }).select('employee').lean()).map((a) => String(a.employee)));
  const ops = [];
  for (const e of withLogin) {
    const a = byUser.get(String(e.user));
    if (!a || manual.has(String(e._id))) continue;
    ops.push({ updateOne: { filter: { employee: e._id, date }, update: { $set: { status: 'present', source: 'auto', firstActivity: a.first, lastActivity: a.last } }, upsert: true } });
  }
  if (ops.length) await Attendance.bulkWrite(ops);
  return ops.length;
}
export async function autoAttendance(req, res) {
  const date = parseDateOnly(asString(req.body?.date)) || startOfToday();
  if (date > startOfToday()) throw invalid({ date: 'Attendance cannot be marked for a future date' });
  const emps = (await Employee.find({ isDeleted: false, ...scope({ query: { branch: req.body?.branch }, user: req.user }) }).lean()).filter((e) => activeOn(e, date) && (!e.joiningDate || e.joiningDate <= date));
  const n = await autoAttendanceFor(date, emps);
  res.json({ marked: n });
}

// ---- Salary ---------------------------------------------------------------------------------------------------------------------

const monthRange = (month) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  return { from, to, days: to.getUTCDate() };
};

function compute(emp, marks, range, bonusPaise = 0, otherDeductionPaise = 0) {
  let sundays = 0;
  let present = 0; let half = 0; let leave = 0; let holiday = 0; let absent = 0; let unmarked = 0;
  for (let i = 0; i < range.days; i += 1) {
    const day = new Date(range.from.getTime() + i * DAY);
    if (emp.joiningDate && day < emp.joiningDate) { continue; }
    if (emp.leftOn && day > emp.leftOn) { continue; }
    const m = marks.get(iso(day));
    if (day.getUTCDay() === 0 && !m) { sundays += 1; continue; } // Sunday is the weekly off, paid
    if (!m) { unmarked += 1; absent += 1; continue; }
    if (m === 'present') present += 1;
    else if (m === 'half_day') half += 1;
    else if (m === 'leave') leave += 1;
    else if (m === 'holiday') holiday += 1;
    else absent += 1;
  }
  const payable = present + half * 0.5 + leave + holiday + sundays;
  const gross = emp.monthlySalaryPaise || 0;
  const perDay = gross / range.days;
  const earned = Math.round(perDay * payable);
  const net = Math.max(earned + bonusPaise - otherDeductionPaise, 0);
  return { sundays, presentDays: present, halfDays: half, leaveDays: leave, holidayDays: holiday, absentDays: absent, unmarkedDays: unmarked, payableDays: payable, grossPaise: gross, earnedPaise: earned, netPaise: net };
}

const presentSalary = (s, user) => ({
  id: s._id, employeeId: s.employee, employeeCode: s.employeeCode, name: s.name, mobile: showMobile(user, s.mobile), branch: s.branch?._id ? { id: s.branch._id, code: s.branch.code, name: s.branch.name } : null,
  department: s.department || '', designation: s.designation || '', month: s.month, daysInMonth: s.daysInMonth, sundays: s.sundays, presentDays: s.presentDays, halfDays: s.halfDays, leaveDays: s.leaveDays, holidayDays: s.holidayDays,
  absentDays: s.absentDays, unmarkedDays: s.unmarkedDays, payableDays: s.payableDays, gross: rupees(s.grossPaise), earned: rupees(s.earnedPaise), bonus: rupees(s.bonusPaise), otherDeduction: rupees(s.otherDeductionPaise), net: rupees(s.netPaise),
  remark: s.remark || '', status: s.status, sentAt: s.sentAt, paidOn: iso(s.paidOn), payMode: s.payMode || '',
});

/** Generates (or works out again) the salary of a month from the attendance, for the active employees of the branch(es). Paid salaries are left as they are. */
export async function generateSalary(req, res) {
  const month = asString(req.body?.month);
  const range = monthRange(month);
  if (!range) throw invalid({ month: 'Choose the month' });
  if (range.to > startOfToday()) throw invalid({ month: 'The salary of a month is generated once the month is over' });
  const emps = (await Employee.find({ isDeleted: false, ...scope({ query: { branch: req.body?.branch }, user: req.user }) }).populate(EMP_POPULATE).lean())
    .filter((e) => (!e.joiningDate || e.joiningDate <= range.to) && (e.status === 'active' || (e.leftOn && e.leftOn >= range.from)));
  const marksAll = await Attendance.find({ date: { $gte: range.from, $lte: range.to }, employee: { $in: emps.map((e) => e._id) } }).select('employee date status').lean();
  const marks = new Map();
  marksAll.forEach((a) => { const k = String(a.employee); if (!marks.has(k)) marks.set(k, new Map()); marks.get(k).set(iso(a.date), a.status); });
  const existing = new Map((await Salary.find({ month, employee: { $in: emps.map((e) => e._id) } }).lean()).map((s) => [String(s.employee), s]));
  let made = 0; let updated = 0; let keptPaid = 0; let noSalary = 0;
  const ops = [];
  for (const e of emps) {
    const ex = existing.get(String(e._id));
    if (ex?.status === 'paid') { keptPaid += 1; continue; }
    if (!e.monthlySalaryPaise) noSalary += 1;
    const c = compute(e, marks.get(String(e._id)) || new Map(), range, ex?.bonusPaise || 0, ex?.otherDeductionPaise || 0);
    const doc = {
      employee: e._id, employeeCode: e.employeeCode, name: e.name, mobile: e.mobile, branch: e.branch?._id, department: e.department?.name || '', designation: e.designation?.name || '', month, daysInMonth: range.days, ...c, generatedByCode: req.user.employeeCode || '',
    };
    if (ex) updated += 1; else made += 1;
    ops.push({ updateOne: { filter: { employee: e._id, month }, update: { $set: doc, $setOnInsert: { status: 'generated', bonusPaise: 0, otherDeductionPaise: 0 } }, upsert: true } });
  }
  if (ops.length) await Salary.bulkWrite(ops);
  await audit(req, { action: 'salary.generate', entity: 'Salary', after: { month, made, updated, keptPaid } });
  res.json({ made, updated, keptPaid, noSalary });
}

export async function listSalary(req, res) {
  const month = asString(req.query.month);
  if (!monthRange(month)) throw invalid({ month: 'Choose the month' });
  const filter = { month, ...scope(req) };
  const st = asString(req.query.status);
  if (['generated', 'sent', 'paid', 'unpaid'].includes(st)) filter.status = st === 'unpaid' ? { $ne: 'paid' } : st;
  const q = asString(req.query.q).toLowerCase();
  const rows = await Salary.find(filter).sort({ employeeCode: 1 }).populate('branch', 'code name').lean();
  const items = rows.map((s) => presentSalary(s, req.user)).filter((s) => !q || [s.employeeCode, s.name].some((v) => String(v).toLowerCase().includes(q)));
  const sum = (f) => Math.round(items.reduce((t, s) => t + f(s), 0) * 100) / 100;
  res.json({ items, summary: { slips: items.length, gross: sum((s) => s.gross), net: sum((s) => s.net), paid: sum((s) => (s.status === 'paid' ? s.net : 0)), due: sum((s) => (s.status === 'paid' ? 0 : s.net)) } });
}

async function loadSlip(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Salary not found');
  const s = await Salary.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (!s) throw new HttpError(404, 'Salary not found');
  return s;
}

/** Bonus / other deduction on a salary that is not paid yet. */
export async function adjustSalary(req, res) {
  const s = await loadSlip(req);
  if (s.status === 'paid') throw new HttpError(409, 'This salary is already paid');
  const read = (v, label) => {
    const p = v === '' || v === undefined || v === null ? 0 : toMinor(typeof v === 'number' ? String(v) : asString(v));
    if (p === null || p < 0) throw invalid({ [label]: 'Enter an amount (₹, up to 2 decimals)' });
    return p;
  };
  s.bonusPaise = read(req.body?.bonus, 'bonus');
  s.otherDeductionPaise = read(req.body?.otherDeduction, 'otherDeduction');
  s.remark = asString(req.body?.remark).slice(0, 200);
  s.netPaise = Math.max((s.earnedPaise || 0) + s.bonusPaise - s.otherDeductionPaise, 0);
  if (s.status === 'sent') s.status = 'generated'; // the slip that was sent is out of date
  await s.save();
  await s.populate('branch', 'code name');
  await audit(req, { action: 'salary.adjust', entity: 'Salary', entityId: s._id, after: { month: s.month, employee: s.employeeCode, net: s.netPaise / 100 } });
  res.json({ item: presentSalary(s, req.user) });
}

/** Sends the salary slip to the employee by SMS (mobile number of the employee). */
export async function sendSalary(req, res) {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => mongoose.isValidObjectId(String(x)));
  if (!ids.length) throw invalid({ ids: 'Select the salaries to send' });
  const slips = await Salary.find({ _id: { $in: ids }, ...branchFilter(req.user) });
  const out = { sent: 0, noMobile: 0, failed: 0 };
  for (const s of slips) {
    if (!MOBILE_RE.test(s.mobile || '')) { out.noMobile += 1; continue; }
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendSms({ to: s.mobile, text: `Udgam Microfinance: salary slip ${s.month} of ${s.employeeCode}. Payable days ${s.payableDays}/${s.daysInMonth}. Net salary Rs ${s.netPaise / 100}.` });
      s.sentAt = new Date();
      s.sentTo = s.mobile;
      if (s.status === 'generated') s.status = 'sent';
      // eslint-disable-next-line no-await-in-loop
      await s.save();
      out.sent += 1;
    } catch (err) {
      console.error('salary sms failed', err.message);
      out.failed += 1;
    }
  }
  await audit(req, { action: 'salary.send', entity: 'Salary', after: out });
  res.json(out);
}

/** Pays salaries: each one becomes a Cashbook entry (Staff salary paid) of the branch of the employee. */
export async function paySalary(req, res) {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => mongoose.isValidObjectId(String(x)));
  if (!ids.length) throw invalid({ ids: 'Select the salaries to pay' });
  const payMode = asString(req.body?.payMode) || 'cash';
  if (!['cash', 'bank', 'upi', 'cheque'].includes(payMode)) throw invalid({ payMode: 'Select how the salary is paid' });
  const bankAccount = await readBankAccount(req.body, payMode);
  const today = startOfToday();
  const slips = await Salary.find({ _id: { $in: ids }, ...branchFilter(req.user) });
  const out = { paid: 0, skipped: 0, amount: 0, failed: [] };
  for (const s of slips) {
    if (s.status === 'paid' || !s.netPaise) { out.skipped += 1; continue; }
    try {
      // eslint-disable-next-line no-await-in-loop
      await assertDayOpen(s.branch, today);
      // eslint-disable-next-line no-await-in-loop
      const entry = await CashEntry.create({
        branch: s.branch || null, date: today, side: 'payment', category: 'staff_salary', amountPaise: s.netPaise, mode: payMode, bankAccount, remark: `Salary ${s.month} — ${s.employeeCode} ${s.name}`.slice(0, 200),
        enteredByCode: req.user.employeeCode || '', createdBy: req.user._id,
      });
      s.status = 'paid'; s.paidOn = today; s.payMode = payMode; s.bankAccount = bankAccount; s.cashEntry = entry._id; s.paidByCode = req.user.employeeCode || '';
      // eslint-disable-next-line no-await-in-loop
      await s.save();
      out.paid += 1; out.amount += s.netPaise / 100;
    } catch (err) {
      out.failed.push({ employeeCode: s.employeeCode, message: err.message });
    }
  }
  await audit(req, { action: 'salary.pay', entity: 'Salary', after: { paid: out.paid, amount: out.amount, payMode } });
  res.json(out);
}

/** The salary of a month branch wise: employees, earned, bonus and deduction, net, paid and still to pay. */
export async function branchWiseSalary(req, res) {
  const month = asString(req.query.month);
  const range = monthRange(month);
  if (!range) throw invalid({ month: 'Choose the month' });
  const agg = await Salary.aggregate([
    { $match: { month, ...scope(req) } },
    { $group: { _id: '$branch', employees: { $sum: 1 }, gross: { $sum: '$grossPaise' }, earned: { $sum: '$earnedPaise' }, bonus: { $sum: '$bonusPaise' }, deduction: { $sum: '$otherDeductionPaise' }, net: { $sum: '$netPaise' },
      paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$netPaise', 0] } }, paidCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } } } },
  ]);
  const active = await Employee.aggregate([{ $match: { isDeleted: false, status: 'active', ...scope(req) } }, { $group: { _id: '$branch', n: { $sum: 1 } } }]);
  const activeBy = new Map(active.map((a) => [String(a._id), a.n]));
  const branches = new Map((await Branch.find({}).select('code name').lean()).map((b) => [String(b._id), b]));
  const rows = agg.map((r) => {
    const b = branches.get(String(r._id));
    return { branchId: r._id, branch: b ? `${b.code} — ${b.name}` : 'No branch', employees: r.employees, notGenerated: Math.max((activeBy.get(String(r._id)) || 0) - r.employees, 0), gross: rupees(r.gross), earned: rupees(r.earned), bonus: rupees(r.bonus), deduction: rupees(r.deduction), net: rupees(r.net), paid: rupees(r.paid), due: rupees(r.net - r.paid), paidCount: r.paidCount };
  }).sort((a, b) => a.branch.localeCompare(b.branch));
  const sum = (f) => Math.round(rows.reduce((t, r) => t + r[f], 0) * 100) / 100;
  res.json({ month, rows, totals: { employees: sum('employees'), gross: sum('gross'), earned: sum('earned'), bonus: sum('bonus'), deduction: sum('deduction'), net: sum('net'), paid: sum('paid'), due: sum('due') } });
}

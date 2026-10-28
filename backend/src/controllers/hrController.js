import mongoose from 'mongoose';
import { Department, Designation, Employee, Attendance, Salary, ATTENDANCE_STATUS } from '../models/Hr.js';
import { User } from '../models/User.js';
import { Branch } from '../models/Branch.js';
import { CashEntry } from '../models/CashEntry.js';
import { AuditLog } from '../models/AuditLog.js';
import { Holiday } from '../models/SuperAdmin.js';
import { generateCode } from '../services/codeSequence.js';
import { assertDayOpen, defaultWorkDate } from '../services/dayOpen.js';
import { readBankAccount } from '../services/bankAccountPick.js';
import { sendSms } from '../services/sms.js';
import { asString, parseDateOnly, HttpError, startOfToday, todayDateString } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { lookupPincode } from '../services/lookup.js';
import crypto from 'crypto';
import { Leave } from '../models/HrExtra.js';
import { notifyEmployee } from '../services/hrNotify.js';
import { ensureEmployees } from '../services/employeeSync.js';
import { OtpChallenge } from '../models/OtpChallenge.js';
import { issueOtp, hashOtp, takeVerified, consumeChallenge } from '../services/otpChallenges.js';
import { sendMail, mailConfigured } from '../services/mailer.js';
import { EARN_FIXED, ALL_LINES, SETUP_KEYS, setupAt, loadVariable, buildLines, totalsOf, legacyLines, fixedOf, isVerified } from '../services/salaryLines.js';
import { effectiveOn, monthDays } from '../services/attendanceRules.js';
import { elBalance } from '../services/earnedLeave.js';
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
const MOBILE_RE = /^[6-9]\d{9}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 1_500_000;
const EMP_IMAGES = ['photo', 'aadhaarCopy', 'aadhaarBackCopy', 'panCopy', 'drivingLicenceCopy', 'voterIdCopy', 'relievingLetter', 'salarySlipCopy'];
const EMP_IMAGE_LABEL = { photo: 'Photo', aadhaarCopy: 'Aadhaar front copy', aadhaarBackCopy: 'Aadhaar back copy', panCopy: 'PAN copy', drivingLicenceCopy: 'Driving licence copy', voterIdCopy: 'Voter ID copy', relievingLetter: 'Relieving letter', salarySlipCopy: 'Salary slip' };
const MARITAL = ['single', 'married', 'divorced', 'widowed'];
const yes = (v) => v === true || v === 'yes' || v === 'true';

/** The branches of a request: the user's own, narrowed to the chosen one (never widened). */
/** The branches the HR pages offer: every branch for an admin and for an accountant (the head office pays the staff of every branch), the own branches for a branch manager. */
export async function hrBranchOptions(req, res) {
  const filter = { isDeleted: false, isActive: true };
  if (!['super_admin', 'admin', 'accountant'].includes(req.user.role)) filter._id = { $in: req.user.branches || [] };
  const items = await Branch.find(filter).sort({ code: 1 }).select('code name').lean();
  res.json({ items: items.map((b) => ({ id: b._id, code: b.code, name: b.name })) });
}

/** Salary slips: an accountant sees and pays the slips of every branch (the head office pays the staff of other branches too); a branch manager only its own. */
const slipScope = (user) => (user.role === 'accountant' ? {} : branchFilter(user));
const salaryScope = (req) => {
  const wanted = asString(req.query.branch);
  if (req.user.role !== 'accountant') return scope(req);
  return mongoose.isValidObjectId(wanted) ? { branch: new mongoose.Types.ObjectId(wanted) } : {};
};

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
  homeTown: e.homeTown || '', homeTownPincode: e.homeTownPincode || '', originalMarksheet: Boolean(e.originalMarksheet), fatherName: e.fatherName || '', fatherMobile: showMobile(user, e.fatherMobile) || '', motherName: e.motherName || '', maritalStatus: e.maritalStatus || '',
  pincode: e.pincode || '', state: e.state || '', district: e.district || '', area: e.area || '', pfDeduction: Boolean(e.pfDeduction), esiDeduction: Boolean(e.esiDeduction),
  aadhaarNo: e.aadhaarNo || '', panNo: e.panNo || '', drivingLicenceNo: e.drivingLicenceNo || '', voterIdNo: e.voterIdNo || '',
  hasExperience: Boolean(e.hasExperience), previousCompany: e.previousCompany || '', previousPost: e.previousPost || '',
  supervisor: e.supervisor?._id ? { id: e.supervisor._id, code: e.supervisor.employeeCode, name: e.supervisor.name } : null,
  supervisedBranches: (e.supervisedBranches || []).map((b) => ({ id: b._id || b, code: b.code || '', name: b.name || '' })),
  pfNumber: e.pfNumber || '', uanNumber: e.uanNumber || '', esiNumber: e.esiNumber || '',
  mobileVerified: Boolean(e.mobileVerifiedAt), emailVerified: Boolean(e.emailVerifiedAt), documentsVerified: Boolean(e.documentsVerifiedAt), verified: isVerified(e),
  salarySetup: {
    ...Object.fromEntries(EARN_FIXED.map(([k]) => [k, rupees(fixedOf(e)[k])])), pfPercent: e.pfPercent ?? 12, esiPercent: e.esiPercent ?? 0.75, professionalTax: rupees(e.professionalTaxPaise),
    advanceDeduction: rupees(e.advanceDeductionPaise), securityAmount: rupees(e.securityAmountPaise), securityMonths: e.securityMonths || 1, securityNeverEnds: Boolean(e.securityNeverEnds), yearlyIncrementPercent: e.yearlyIncrementPercent ?? 10,
    pfDeduction: Boolean(e.pfDeduction), esiDeduction: Boolean(e.esiDeduction),
  },
  salaryHistory: (e.salaryHistory || []).map((h) => ({
    month: h.month, ...Object.fromEntries(EARN_FIXED.map(([k]) => [k, rupees(fixedOf(h)[k])])), pfPercent: h.pfPercent ?? 12, esiPercent: h.esiPercent ?? 0.75, professionalTax: rupees(h.professionalTaxPaise),
    advanceDeduction: rupees(h.advanceDeductionPaise), securityAmount: rupees(h.securityAmountPaise), securityMonths: h.securityMonths || 1, securityNeverEnds: Boolean(h.securityNeverEnds), yearlyIncrementPercent: h.yearlyIncrementPercent ?? 10, pfDeduction: Boolean(h.pfDeduction), esiDeduction: Boolean(h.esiDeduction),
  })).sort((a, b) => a.month.localeCompare(b.month)),
});
const EMP_POPULATE = [{ path: 'department', select: 'name' }, { path: 'designation', select: 'name' }, { path: 'branch', select: 'code name' }, { path: 'supervisor', select: 'employeeCode name' }, { path: 'supervisedBranches', select: 'code name' }];

export async function listEmployees(req, res) {
  await ensureEmployees(); // a staff login that has no HR record yet gets one
  const filter = { isDeleted: false, ...scope(req) };
  const st = asString(req.query.status);
  if (['active', 'left'].includes(st)) filter.status = st;
  // the pickers (leave, resignation ...) do not offer a blocked employee
  if (asString(req.query.pick) === '1') filter.isBlocked = { $ne: true };
  for (const k of ['department', 'designation', 'supervisor']) if (mongoose.isValidObjectId(asString(req.query[k]))) filter[k] = req.query[k];
  const q = asString(req.query.q).toLowerCase();
  const rows = await Employee.find(filter).sort({ employeeCode: 1 }).limit(3000).populate(EMP_POPULATE);
  const team = new Map((await Employee.aggregate([{ $match: { isDeleted: false, status: 'active', supervisor: { $ne: null } } }, { $group: { _id: '$supervisor', n: { $sum: 1 } } }])).map((r) => [String(r._id), r.n]));
  const items = rows.map((e) => ({ ...presentEmployee(e, req.user), teamCount: team.get(String(e._id)) || 0 })).filter((e) => !q || [e.employeeCode, e.name, e.mobile].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items, summary: { employees: items.length, active: items.filter((e) => e.status === 'active').length, monthlySalary: items.filter((e) => e.status === 'active').reduce((s, e) => s + e.monthlySalary, 0) } });
}

/** One employee with the photo and the copies of the documents (they are not part of the list). */
export async function getEmployee(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Employee not found');
  const e = await Employee.findOne({ _id: req.params.id, isDeleted: false, ...scope(req) }).select(EMP_IMAGES.map((k) => `+${k}`).join(' ')).populate(EMP_POPULATE);
  if (!e) throw new HttpError(404, 'Employee not found');
  // the security cut from the salary of this employee so far, and the earned leave due
  const cutRow = (await Salary.aggregate([{ $match: { employee: e._id } }, { $group: { _id: null, cut: { $sum: { $ifNull: ['$securityCutPaise', 0] } }, slips: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$securityCutPaise', 0] }, 0] }, 1, 0] } } } }]))[0] || { cut: 0, slips: 0 };
  const bal = await elBalance(e);
  const security = { amount: rupees(e.securityAmountPaise), months: e.securityMonths || 1, neverEnds: Boolean(e.securityNeverEnds), cut: rupees(cutRow.cut), slips: cutRow.slips, remaining: e.securityNeverEnds ? null : Math.max(rupees(e.securityAmountPaise) - rupees(cutRow.cut), 0), verified: isVerified(e) };
  res.json({ item: { ...presentEmployee(e, req.user), ...Object.fromEntries(EMP_IMAGES.map((k) => [k, e[k] || ''])), security, earnedLeave: bal } });
}

/** Location of a pincode (state, district, post office areas), for the registration form. */
export async function employeePincode(req, res) {
  const pin = String(req.params.pin || '');
  if (!/^[1-9]\d{5}$/.test(pin)) throw new HttpError(422, 'Enter a valid 6-digit pincode');
  res.json(await lookupPincode(pin));
}

// ---- Verification: mobile and email by OTP, documents by hand; the security is cut from the salary once it is complete ----------------

async function loadEmployee(req, extra = '') {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Employee not found');
  const e = await Employee.findOne({ _id: req.params.id, isDeleted: false, ...scope(req) }).select(extra);
  if (!e) throw new HttpError(404, 'Employee not found');
  return e;
}

/** The employees whose verification is not complete, with what is pending for each. */
export async function pendingVerification(req, res) {
  const filter = { isDeleted: false, status: 'active', ...scope(req) };
  const rows = await Employee.find(filter).sort({ employeeCode: 1 }).limit(3000).populate(EMP_POPULATE).lean();
  const flags = new Map((await Employee.aggregate([
    { $match: { _id: { $in: rows.map((r) => r._id) } } },
    { $project: { photo: { $gt: [{ $strLenCP: { $ifNull: ['$photo', ''] } }, 0] }, aadhaar: { $gt: [{ $strLenCP: { $ifNull: ['$aadhaarCopy', ''] } }, 0] }, aadhaarBack: { $gt: [{ $strLenCP: { $ifNull: ['$aadhaarBackCopy', ''] } }, 0] }, pan: { $gt: [{ $strLenCP: { $ifNull: ['$panCopy', ''] } }, 0] } } },
  ])).map((r) => [String(r._id), r]));
  const q = asString(req.query.q).toLowerCase();
  const all = asString(req.query.all) === '1';
  const items = rows.map((e) => {
    const fl = flags.get(String(e._id)) || {};
    const pending = [];
    if (e.mobile && !e.mobileVerifiedAt) pending.push('mobile');
    if (e.email && !e.emailVerifiedAt) pending.push('email');
    if (!e.documentsVerifiedAt) pending.push('documents');
    return {
      id: e._id, employeeCode: e.employeeCode, name: e.name, branch: e.branch?.code || '', branchName: e.branch?.name || '', mobile: e.mobile || '', email: e.email || '', pending,
      mobileVerified: Boolean(e.mobileVerifiedAt), emailVerified: Boolean(e.emailVerifiedAt), documentsVerified: Boolean(e.documentsVerifiedAt),
      has: { photo: Boolean(fl.photo), aadhaar: Boolean(fl.aadhaar), aadhaarBack: Boolean(fl.aadhaarBack), pan: Boolean(fl.pan) }, securityAmount: rupees(e.securityAmountPaise), securityMonths: e.securityMonths || 1,
    };
  }).filter((x) => (all || x.pending.length) && (!q || [x.employeeCode, x.name, x.mobile, x.email].some((v) => String(v).toLowerCase().includes(q))));
  res.json({ items, summary: { pending: items.filter((x) => x.pending.length).length, mobile: items.filter((x) => x.pending.includes('mobile')).length, email: items.filter((x) => x.pending.includes('email')).length, documents: items.filter((x) => x.pending.includes('documents')).length } });
}

const channelOf = (req) => {
  const c = asString(req.body?.channel);
  if (!['mobile', 'email'].includes(c)) throw invalid({ channel: 'Choose mobile or email' });
  return c;
};

/** Sends an OTP to the mobile number or the email of the employee. */
export async function sendEmployeeOtp(req, res) {
  const e = await loadEmployee(req);
  const channel = channelOf(req);
  const to = channel === 'mobile' ? e.mobile : e.email;
  if (!to) throw invalid({ channel: `This employee has no ${channel === 'mobile' ? 'mobile number' : 'email'}. Edit the employee first.` });
  const { challenge, otp } = await issueOtp({ user: req.user, purpose: channel === 'mobile' ? 'employee_mobile' : 'employee_email', subject: `${e._id}:${to}`, sentTo: to });
  let dev = false;
  if (channel === 'mobile') {
    const sms = await sendSms({ to, text: `Udgam Microfinance: OTP ${otp} to verify your mobile number. Valid for 5 minutes. Do not share this OTP.` });
    dev = Boolean(sms.dev);
  } else {
    const sent = await sendMail({ to, subject: 'Udgam Microfinance: email verification OTP', text: `Your OTP to verify your email is ${otp}. It is valid for 5 minutes. Do not share this OTP.` });
    dev = !sent;
  }
  res.json({ challengeId: challenge._id, sentTo: to, expiresAt: challenge.expiresAt, ...(dev && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}) });
}

/**
 * Registration: an OTP to the mobile number or the email typed in the form, before the employee is saved (the same OTP is used when a number is changed in Edit).
 * The verified challenge is sent back with the form and marks the number verified when the employee is saved.
 */
export async function sendNewEmployeeOtp(req, res) {
  const channel = channelOf(req);
  const to = asString(req.body?.value).trim().toLowerCase();
  if (channel === 'mobile' && !MOBILE_RE.test(to)) throw invalid({ mobile: 'Enter a valid 10-digit mobile number first' });
  if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw invalid({ email: 'Enter a valid email address first' });
  const { challenge, otp } = await issueOtp({ user: req.user, purpose: channel === 'mobile' ? 'employee_mobile' : 'employee_email', subject: `new:${to}`, sentTo: to });
  let dev = false;
  if (channel === 'mobile') {
    const sms = await sendSms({ to, text: `Udgam Microfinance: OTP ${otp} to verify your mobile number. Valid for 5 minutes. Do not share this OTP.` });
    dev = Boolean(sms.dev);
  } else {
    const sent = await sendMail({ to, subject: 'Udgam Microfinance: email verification OTP', text: `Your OTP to verify your email is ${otp}. It is valid for 5 minutes. Do not share this OTP.` });
    dev = !sent;
  }
  res.json({ challengeId: challenge._id, sentTo: to, expiresAt: challenge.expiresAt, ...(dev && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}) });
}

export async function verifyNewEmployeeOtp(req, res) {
  const channel = channelOf(req);
  const to = asString(req.body?.value).trim().toLowerCase();
  const otp = asString(req.body?.otp);
  if (!mongoose.isValidObjectId(asString(req.body?.challengeId))) throw new HttpError(422, 'Send an OTP first');
  if (!/^\d{6}$/.test(otp)) throw invalid({ otp: 'Enter the 6-digit OTP' });
  const purpose = channel === 'mobile' ? 'employee_mobile' : 'employee_email';
  const ch = await OtpChallenge.findOne({ _id: req.body.challengeId, createdBy: req.user._id, purpose, subject: `new:${to}` }).select('+hash');
  if (!ch) throw new HttpError(404, 'OTP request not found. Please send a new OTP.');
  if (ch.consumedAt) throw new HttpError(409, 'This OTP has already been used. Please send a new OTP.');
  if (ch.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'The OTP has expired. Please send a new OTP.');
  if (ch.attempts >= 5) throw new HttpError(429, 'Too many wrong attempts. Please send a new OTP.');
  const given = Buffer.from(hashOtp(ch._id, otp), 'hex');
  const stored = Buffer.from(ch.hash, 'hex');
  if (!(given.length === stored.length && crypto.timingSafeEqual(given, stored))) {
    ch.attempts += 1;
    await ch.save();
    throw invalid({ otp: 'Incorrect OTP' });
  }
  ch.verifiedAt = new Date();
  await ch.save();
  res.json({ verified: true, channel });
}

/** A mobile number or email that was verified in the form (by its challenge) is marked verified on the employee. */
async function applyFormVerification(req, e) {
  for (const [channel, field, idKey] of [['mobile', 'mobileVerifiedAt', 'mobileChallengeId'], ['email', 'emailVerifiedAt', 'emailChallengeId']]) {
    const value = String(channel === 'mobile' ? e.mobile || '' : e.email || '').toLowerCase();
    if (!value || e[field]) continue;
    // eslint-disable-next-line no-await-in-loop
    const ch = await takeVerified(asString(req.body?.[idKey]), req.user, channel === 'mobile' ? 'employee_mobile' : 'employee_email', `new:${value}`);
    if (ch) { e[field] = new Date(); await consumeChallenge(ch); } // eslint-disable-line no-await-in-loop
  }
}

/** Checks the OTP and marks the mobile number or the email verified. */
export async function verifyEmployeeOtp(req, res) {
  const e = await loadEmployee(req);
  const channel = channelOf(req);
  const otp = asString(req.body?.otp);
  if (!mongoose.isValidObjectId(asString(req.body?.challengeId))) throw new HttpError(422, 'Send an OTP first');
  if (!/^\d{6}$/.test(otp)) throw invalid({ otp: 'Enter the 6-digit OTP' });
  const to = channel === 'mobile' ? e.mobile : e.email;
  const purpose = channel === 'mobile' ? 'employee_mobile' : 'employee_email';
  const ch = await OtpChallenge.findOne({ _id: req.body.challengeId, createdBy: req.user._id, purpose, subject: `${e._id}:${to}` }).select('+hash');
  if (!ch) throw new HttpError(404, 'OTP request not found. Please send a new OTP.');
  if (ch.consumedAt) throw new HttpError(409, 'This OTP has already been used. Please send a new OTP.');
  if (ch.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'The OTP has expired. Please send a new OTP.');
  if (ch.attempts >= 5) throw new HttpError(429, 'Too many wrong attempts. Please send a new OTP.');
  const given = Buffer.from(hashOtp(ch._id, otp), 'hex');
  const stored = Buffer.from(ch.hash, 'hex');
  if (!(given.length === stored.length && crypto.timingSafeEqual(given, stored))) {
    ch.attempts += 1;
    await ch.save();
    throw invalid({ otp: 'Incorrect OTP' });
  }
  ch.verifiedAt = new Date();
  ch.consumedAt = new Date();
  await ch.save();
  e[channel === 'mobile' ? 'mobileVerifiedAt' : 'emailVerifiedAt'] = new Date();
  await e.save();
  await audit(req, { action: 'employee.verify', entity: 'Employee', entityId: e._id, after: { channel } });
  res.json({ verified: true, channel, complete: isVerified(e) });
}

/** The documents (photo and Aadhaar copy at least) are checked by hand and marked verified, or the mark is taken back. */
export async function verifyEmployeeDocuments(req, res) {
  const e = await loadEmployee(req, '+photo +aadhaarCopy +aadhaarBackCopy');
  const on = yes(req.body?.verified);
  if (on && (!e.photo || !e.aadhaarCopy || !e.aadhaarBackCopy)) throw invalid({ documents: 'Upload the photo and the front and back of the Aadhaar of the employee first (Edit)' });
  e.documentsVerifiedAt = on ? new Date() : undefined;
  await e.save();
  await audit(req, { action: 'employee.documents', entity: 'Employee', entityId: e._id, after: { verified: on } });
  res.json({ documentsVerified: on, complete: isVerified(e) });
}

// ---- Set Salary: the fixed components, PF / ESI, professional tax, advance and security of an employee --------------------------

export async function saveSalarySetup(req, res) {
  const e = await loadEmployee(req);
  const b = req.body || {};
  const before = Object.fromEntries(SETUP_KEYS.map((k) => [k, e[k]?.toObject ? e[k].toObject() : e[k]])); // the set-up as it was: it keeps holding for the months before the one that is set now
  const money = (v, label) => {
    const p = v === '' || v === undefined || v === null ? 0 : toMinor(typeof v === 'number' ? String(v) : asString(v));
    if (p === null || p < 0) throw invalid({ [label]: 'Enter an amount (₹, up to 2 decimals)' });
    return p;
  };
  const pct = (v, label, def) => {
    const n = v === '' || v === undefined || v === null ? def : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw invalid({ [label]: 'Enter a percentage between 0 and 100' });
    return n;
  };
  const st = {};
  for (const [k] of EARN_FIXED) st[k] = money(b[k], k);
  e.salaryStructure = st;
  e.monthlySalaryPaise = Object.values(st).reduce((s, x) => s + x, 0);
  e.pfPercent = pct(b.pfPercent, 'pfPercent', 12);
  e.esiPercent = pct(b.esiPercent, 'esiPercent', 0.75);
  e.professionalTaxPaise = money(b.professionalTax, 'professionalTax');
  e.advanceDeductionPaise = money(b.advanceDeduction, 'advanceDeduction');
  e.securityAmountPaise = money(b.securityAmount, 'securityAmount');
  const never = b.securityMonths === 'never' || yes(b.securityNeverEnds);
  const months = never ? (e.securityMonths || 1) : Number(b.securityMonths || 1);
  if (!Number.isInteger(months) || months < 1 || months > 5) throw invalid({ securityMonths: 'The security is cut in 1 to 5 months, or never ends' });
  e.securityMonths = months;
  e.securityNeverEnds = never;
  if (b.yearlyIncrementPercent !== undefined && b.yearlyIncrementPercent !== '') {
    const yp = Number(b.yearlyIncrementPercent);
    if (!Number.isFinite(yp) || yp < 0 || yp > 100) throw invalid({ yearlyIncrementPercent: 'The yearly increase is between 0 and 100 percent' });
    e.yearlyIncrementPercent = yp;
  }
  Object.assign(e, readStatutory(b)); // the numbers can be filled in here too, when the salary is set
  if (b.pfDeduction !== undefined) e.pfDeduction = yes(b.pfDeduction);
  if (b.esiDeduction !== undefined) e.esiDeduction = yes(b.esiDeduction);
  // the month the salary is set for: this month or an earlier one (it holds from that month on); the salary of a month is worked out with the set-up of that month
  const thisMonth = todayDateString().slice(0, 7);
  const month = asString(b.month) || thisMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid({ month: 'Choose the month' });
  if (month > thisMonth) throw invalid({ month: 'Choose this month or an earlier month' });
  const snap = { month, salaryStructure: { ...(e.salaryStructure?.toObject ? e.salaryStructure.toObject() : e.salaryStructure) }, monthlySalaryPaise: e.monthlySalaryPaise, pfPercent: e.pfPercent, esiPercent: e.esiPercent, professionalTaxPaise: e.professionalTaxPaise, advanceDeductionPaise: e.advanceDeductionPaise, securityAmountPaise: e.securityAmountPaise, securityMonths: e.securityMonths, securityNeverEnds: e.securityNeverEnds, yearlyIncrementPercent: e.yearlyIncrementPercent ?? 10, pfDeduction: Boolean(e.pfDeduction), esiDeduction: Boolean(e.esiDeduction) };
  const hist = (e.salaryHistory || []).map((h) => (h.toObject ? h.toObject() : h));
  if (!hist.length && (before.monthlySalaryPaise || before.securityAmountPaise || before.professionalTaxPaise || before.advanceDeductionPaise)) hist.push({ month: '0000-00', ...before });
  const at = hist.findIndex((h) => h.month === month);
  if (at >= 0) hist[at] = snap; else hist.push(snap);
  e.salaryHistory = hist.sort((x, y) => x.month.localeCompare(y.month));
  // the fields of the employee always hold the latest set-up
  const latest = e.salaryHistory[e.salaryHistory.length - 1];
  if (latest.month !== month) SETUP_KEYS.forEach((k) => { if (latest[k] !== undefined) e[k] = latest[k]; });
  await e.save();
  await e.populate(EMP_POPULATE);
  await audit(req, { action: 'employee.salary-setup', entity: 'Employee', entityId: e._id, after: { employeeCode: e.employeeCode, monthlySalary: rupees(e.monthlySalaryPaise) } });
  res.json({ item: presentEmployee(e, req.user) });
}

/**
 * Moves the employees of supervisor 1 to supervisor 2 (all of them, or the chosen ones). The leaves of them that wait for approval go to supervisor 2 too.
 */
export async function supervisorTransfer(req, res) {
  const b = req.body || {};
  const pick = async (id, field) => {
    const e = mongoose.isValidObjectId(asString(id)) ? await Employee.findOne({ _id: id, isDeleted: false }).select('employeeCode name') : null;
    if (!e) throw invalid({ [field]: 'Select the employee' });
    return e;
  };
  const from = await pick(b.from, 'from');
  const to = await pick(b.to, 'to');
  if (String(from._id) === String(to._id)) throw invalid({ to: 'Choose a different supervisor' });
  const filter = { isDeleted: false, supervisor: from._id, _id: { $ne: to._id } };
  const chosen = (Array.isArray(b.employees) ? b.employees : []).filter((x) => mongoose.isValidObjectId(String(x)));
  if (chosen.length) filter._id = { $in: chosen.filter((x) => String(x) !== String(to._id)) };
  const moved = await Employee.find(filter).select('_id').lean();
  if (!moved.length) throw invalid({ employees: 'Nobody to move: the first supervisor has no employee under them' });
  const ids = moved.map((m) => m._id);
  await Employee.updateMany({ _id: { $in: ids } }, { $set: { supervisor: to._id } });
  const leaves = await Leave.updateMany({ employee: { $in: ids }, status: 'pending' }, { $set: { approver: to._id, approverCode: to.employeeCode, approverName: to.name } });
  await audit(req, { action: 'employee.supervisor-transfer', entity: 'Employee', after: { from: from.employeeCode, to: to.employeeCode, employees: ids.length } });
  notifyEmployee(to._id, 'Employees moved to you', `${ids.length} employee${ids.length === 1 ? ' was' : 's were'} moved from supervisor ${from.name} (${from.employeeCode}) to you. Their leave applications now come to you.`);
  res.json({ moved: ids.length, leavesMoved: leaves.modifiedCount || 0 });
}

/** Staff logins that have no HR record yet. */
export async function employeeStaffOptions(_req, res) {
  const linked = (await Employee.find({ isDeleted: false, user: { $exists: true } }).select('user').lean()).map((e) => e.user);
  const users = await User.find({ _id: { $nin: linked }, employeeCode: { $exists: true, $ne: '' } }).select('name employeeCode mobile role branches').populate('branches', 'code').sort({ name: 1 }).lean();
  res.json({ items: users.map((u) => ({ id: u._id, employeeCode: u.employeeCode, name: u.name, mobile: u.mobile || '', role: u.role, branches: (u.branches || []).map((b) => b.code).join(', ') })) });
}

/** PF number, UAN and ESI number (all optional; only the ones that are sent are read). */
function readStatutory(b) {
  const d = {};
  if (b.pfNumber !== undefined) d.pfNumber = asString(b.pfNumber).toUpperCase().replace(/\s/g, '').slice(0, 30);
  if (b.uanNumber !== undefined) {
    d.uanNumber = asString(b.uanNumber).replace(/\s/g, '');
    if (d.uanNumber && !/^\d{12}$/.test(d.uanNumber)) throw invalid({ uanNumber: 'UAN is 12 digits' });
  }
  if (b.esiNumber !== undefined) {
    d.esiNumber = asString(b.esiNumber).replace(/\s/g, '');
    if (d.esiNumber && !/^(\d{10}|\d{17})$/.test(d.esiNumber)) throw invalid({ esiNumber: 'ESI number is 10 (or 17) digits' });
  }
  return d;
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
  // the monthly salary is not asked at registration: it is set in Set Salary
  d.bankName = asString(b.bankName).slice(0, 80);
  d.ifsc = asString(b.ifsc).toUpperCase();
  if (d.ifsc && !IFSC_RE.test(d.ifsc)) throw invalid({ ifsc: 'Enter a valid IFSC code' });
  d.accountNumber = asString(b.accountNumber);
  if (d.accountNumber && !/^\d{9,18}$/.test(d.accountNumber)) throw invalid({ accountNumber: 'Account number must be 9–18 digits' });

  // personal details, deductions, verification and experience (everything here is optional)
  d.homeTown = asString(b.homeTown).slice(0, 80);
  d.homeTownPincode = asString(b.homeTownPincode);
  if (d.homeTownPincode && !/^[1-9]\d{5}$/.test(d.homeTownPincode)) throw invalid({ homeTownPincode: 'Enter a valid 6-digit pincode' });
  d.originalMarksheet = yes(b.originalMarksheet);
  d.fatherName = asString(b.fatherName).replace(/\s+/g, ' ').slice(0, 80);
  d.fatherMobile = asString(b.fatherMobile);
  if (d.fatherMobile && !MOBILE_RE.test(d.fatherMobile)) throw invalid({ fatherMobile: 'Enter a valid 10-digit mobile number' });
  d.motherName = asString(b.motherName).replace(/\s+/g, ' ').slice(0, 80);
  d.maritalStatus = asString(b.maritalStatus);
  if (d.maritalStatus && !MARITAL.includes(d.maritalStatus)) throw invalid({ maritalStatus: 'Select the marital status' });
  d.pincode = asString(b.pincode);
  if (d.pincode && !/^[1-9]\d{5}$/.test(d.pincode)) throw invalid({ pincode: 'Enter a valid 6-digit pincode' });
  d.state = asString(b.state).slice(0, 60);
  d.district = asString(b.district).slice(0, 60);
  d.area = asString(b.area).slice(0, 80);
  d.pfDeduction = yes(b.pfDeduction);
  d.esiDeduction = yes(b.esiDeduction);
  Object.assign(d, readStatutory(b));
  d.aadhaarNo = asString(b.aadhaarNo).replace(/\s/g, '');
  if (d.aadhaarNo && !/^\d{12}$/.test(d.aadhaarNo)) throw invalid({ aadhaarNo: 'Aadhaar number must be 12 digits' });
  d.panNo = asString(b.panNo).toUpperCase();
  if (d.panNo && !/^[A-Z]{5}\d{4}[A-Z]$/.test(d.panNo)) throw invalid({ panNo: 'Enter a valid PAN (e.g. ABCDE1234F)' });
  d.drivingLicenceNo = asString(b.drivingLicenceNo).toUpperCase().slice(0, 20);
  d.voterIdNo = asString(b.voterIdNo).toUpperCase().slice(0, 20);
  d.hasExperience = yes(b.hasExperience);
  d.previousCompany = d.hasExperience ? asString(b.previousCompany).slice(0, 100) : '';
  d.previousPost = d.hasExperience ? asString(b.previousPost).slice(0, 80) : '';
  const sb = [...new Set((Array.isArray(b.supervisedBranches) ? b.supervisedBranches : []).map(String).filter((x) => mongoose.isValidObjectId(x)))];
  if (sb.length && (await Branch.countDocuments({ _id: { $in: sb } })) !== sb.length) throw invalid({ supervisedBranches: 'Select the branches from the list' });
  d.supervisedBranches = sb;
  const sup = asString(b.supervisor);
  if (!sup) d.supervisor = undefined;
  else {
    if (!mongoose.isValidObjectId(sup) || !(await Employee.exists({ _id: sup, isDeleted: false }))) throw invalid({ supervisor: 'Select the supervisor from the list' });
    d.supervisor = sup;
  }
  // the copies: left alone when the field is not sent, removed when it is sent empty
  const errs = {};
  for (const k of EMP_IMAGES) {
    if (b[k] === undefined) continue;
    if (!d.hasExperience && ['relievingLetter', 'salarySlipCopy'].includes(k)) { d[k] = ''; continue; }
    const value = b[k];
    if (value === '' || value === null) d[k] = '';
    else if (typeof value !== 'string' || !IMAGE_RE.test(value)) errs[k] = `${EMP_IMAGE_LABEL[k]} must be a PNG or JPEG image`;
    else if (value.length > MAX_IMAGE_CHARS) errs[k] = `${EMP_IMAGE_LABEL[k]} is too large`;
    else d[k] = value;
  }
  if (Object.keys(errs).length) throw invalid(errs);
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
    await applyFormVerification(req, e);
    if (e.mobileVerifiedAt || e.emailVerifiedAt) await e.save();
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
  const data = await readEmployee(req.body || {});
  if ((data.mobile || '') !== (e.mobile || '')) e.mobileVerifiedAt = undefined;
  if ((data.email || '') !== (e.email || '')) e.emailVerifiedAt = undefined;
  if (data.supervisor && String(data.supervisor) === String(e._id)) throw invalid({ supervisor: 'An employee cannot be their own supervisor' });
  Object.assign(e, data);
  await applyFormVerification(req, e);
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
  await ensureEmployees();
  const date = parseDateOnly(asString(req.query.date)) || startOfToday();
  // a blocked employee is not on the attendance
  const emps = (await Employee.find({ isDeleted: false, isBlocked: { $ne: true }, ...scope(req) }).sort({ employeeCode: 1 }).populate(EMP_POPULATE)).filter((e) => activeOn(e, date) && (!e.joiningDate || e.joiningDate <= date));
  // the days before it as well: the Sunday and the Monday after an absence on a Saturday are absent too
  const back = new Date(date.getTime() - 2 * DAY);
  const markRows = await Attendance.find({ date: { $gte: back, $lte: date }, employee: { $in: emps.map((e) => e._id) } }).lean();
  const marks = new Map(markRows.filter((a) => iso(a.date) === iso(date)).map((a) => [String(a.employee), a]));
  const markMaps = new Map();
  markRows.forEach((a) => { const k = String(a.employee); if (!markMaps.has(k)) markMaps.set(k, new Map()); markMaps.get(k).set(iso(a.date), { status: a.status, source: a.source }); });
  const holRows = await Holiday.find({ date: { $gte: back, $lte: date }, isDeleted: false, isActive: true }).select('date branch').lean();
  const holidaysOf = (e) => new Set(holRows.filter((h) => !h.branch || String(h.branch) === String(e.branch?._id)).map((h) => iso(h.date)));
  const today = startOfToday();
  const items = emps.map((e) => {
    const a = marks.get(String(e._id));
    // the day as the rules see it: a past working day with no attendance is absent by itself (today is not over); an absence on the Saturday before takes the Sunday and the Monday
    const eff = effectiveOn(date, e, markMaps.get(String(e._id)) || new Map(), holidaysOf(e));
    const auto = !a && date < today && eff?.status === 'absent' && eff.source === 'auto';
    const rule = eff?.source === 'rule';
    return { id: e._id, employeeCode: e.employeeCode, name: e.name, branch: e.branch?.code || '', branchName: e.branch?.name || '', designation: e.designation?.name || '', status: rule || auto ? 'absent' : a?.status || '', source: rule ? 'rule' : auto ? 'auto' : a?.source || '', reason: rule ? eff.reason : auto ? 'No attendance: absent by itself' : '', firstActivity: a?.firstActivity || null, lastActivity: a?.lastActivity || null, remark: a?.remark || '', hasLogin: Boolean(e.user),
      locations: locationsOf(e), distanceM: a?.distanceM ?? null,
      time: e.attendanceTime?.from ? { from: e.attendanceTime.from, to: e.attendanceTime.to } : null };
  });
  const count = (s) => items.filter((i) => i.status === s).length;
  const holidays = (await Holiday.find({ date, isDeleted: false, isActive: true }).select('name').lean()).map((h) => h.name);
  res.json({ date: iso(date), sunday: date.getUTCDay() === 0, holidays, items, summary: { employees: items.length, present: count('present'), half_day: count('half_day'), leave: count('leave'), holiday: count('holiday'), absent: count('absent'), notMarked: items.filter((i) => !i.status).length } });
}

/** The places an employee can mark the attendance from: the list, or (an employee saved before the list existed) the one place. */
const locationsOf = (e) => {
  const list = (e.attendanceLocations || []).filter((l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lng));
  if (list.length) return list.map((l) => ({ name: l.name || '', lat: l.lat, lng: l.lng, radius: l.radius || 100 }));
  const one = e.attendanceLocation;
  return one?.lat !== undefined && one?.lat !== null ? [{ name: '', lat: one.lat, lng: one.lng, radius: one.radius || 100 }] : [];
};

/** One place as typed (latitude, longitude, the distance around it that counts, and an optional name). */
function readPlace(raw, at = '') {
  const lat = Number(asString(raw?.lat));
  const lng = Number(asString(raw?.lng));
  const radius = raw?.radius === '' || raw?.radius === undefined ? 100 : Number(asString(raw.radius));
  const f = (k) => (at ? `locations.${at}.${k}` : k);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || asString(raw?.lat) === '') throw invalid({ [f('lat')]: 'Latitude is between −90 and 90' });
  if (!Number.isFinite(lng) || lng < -180 || lng > 180 || asString(raw?.lng) === '') throw invalid({ [f('lng')]: 'Longitude is between −180 and 180' });
  if (!Number.isFinite(radius) || radius < 20 || radius > 5000) throw invalid({ [f('radius')]: 'The distance is 20 to 5000 metres' });
  return { name: asString(raw?.name).slice(0, 60), lat, lng, radius };
}
const readPlaces = (list) => {
  if (!Array.isArray(list)) throw invalid({ locations: 'Give the places as a list' });
  if (list.length > 10) throw invalid({ locations: 'Up to 10 places for an employee' });
  return list.map((p, i) => readPlace(p, String(i)));
};

/** The places an employee marks the attendance from: send `locations` (the whole list; empty removes them), or the older single lat / lng / radius, or clear. */
export async function setAttendanceLocation(req, res) {
  const e = await loadEmployee(req);
  const b = req.body || {};
  const list = b.clear === true ? [] : Array.isArray(b.locations) ? readPlaces(b.locations) : [readPlace(b)];
  e.attendanceLocations = list;
  e.attendanceLocation = undefined;
  await e.save();
  await audit(req, { action: 'attendance.location', entity: 'Employee', entityId: e._id, after: { employee: e.employeeCode, places: list.length } });
  res.json({ locations: locationsOf(e) });
}

/**
 * The same places and / or attendance time for many employees in one go (all of the branch(es) in view, or the ones chosen).
 * locations: the list; locationMode replace (default) or add; clearLocations removes them; time { from, to } or clearTime.
 */
export async function bulkAttendanceSettings(req, res) {
  const b = req.body || {};
  const filter = { isDeleted: false, status: 'active', ...scope({ query: { branch: b.branch }, user: req.user }) };
  if (!b.all) {
    const ids = (Array.isArray(b.employees) ? b.employees : []).filter((x) => mongoose.isValidObjectId(String(x)));
    if (!ids.length) throw invalid({ employees: 'Choose the employees (or all of them)' });
    filter._id = { $in: ids };
  }
  const doLocations = b.clearLocations === true || (Array.isArray(b.locations) && b.locations.length > 0);
  const doTime = b.clearTime === true || (b.time && (asString(b.time.from) || asString(b.time.to)));
  if (!doLocations && !doTime) throw invalid({ locations: 'Give the places and / or the time to set' });
  let places = [];
  if (doLocations && b.clearLocations !== true) places = readPlaces(b.locations);
  let time;
  if (doTime && b.clearTime !== true) {
    const from = asString(b.time.from);
    const to = asString(b.time.to);
    if (!HHMM.test(from)) throw invalid({ from: 'Enter the time the attendance opens (HH:MM)' });
    if (!HHMM.test(to)) throw invalid({ to: 'Enter the time the attendance closes (HH:MM)' });
    if (to <= from) throw invalid({ to: 'The closing time must be after the opening time' });
    time = { from, to };
  }
  const emps = await Employee.find(filter).select('attendanceLocations attendanceLocation').lean();
  if (!emps.length) throw invalid({ employees: 'No working employee found in your branches' });
  const ops = emps.map((e) => {
    const $set = {};
    const $unset = {};
    if (doLocations) {
      const add = b.locationMode === 'add' && b.clearLocations !== true;
      const merged = add ? [...locationsOf(e), ...places].filter((p, i, all) => all.findIndex((q) => q.lat === p.lat && q.lng === p.lng) === i).slice(0, 10) : places;
      $set.attendanceLocations = merged;
      $unset.attendanceLocation = '';
    }
    if (doTime) { if (time) $set.attendanceTime = time; else $unset.attendanceTime = ''; }
    return { updateOne: { filter: { _id: e._id }, update: { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) } } };
  });
  await Employee.bulkWrite(ops);
  await audit(req, { action: 'attendance.bulk', entity: 'Employee', after: { employees: emps.length, places: doLocations ? places.length : undefined, mode: b.locationMode || 'replace', time: doTime ? (time || null) : undefined } });
  res.json({ updated: emps.length, places: doLocations ? places.length : null, time: doTime ? (time || null) : null });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The time of the day an employee can mark the attendance in the app (Indian time): from and to as HH:MM; both empty (or clear) removes it. */
export async function setAttendanceTime(req, res) {
  const e = await loadEmployee(req);
  const b = req.body || {};
  if (b.clear === true || (!asString(b.from) && !asString(b.to))) e.attendanceTime = undefined;
  else {
    const from = asString(b.from);
    const to = asString(b.to);
    if (!HHMM.test(from)) throw invalid({ from: 'Enter the time the attendance opens (HH:MM)' });
    if (!HHMM.test(to)) throw invalid({ to: 'Enter the time the attendance closes (HH:MM)' });
    if (to <= from) throw invalid({ to: 'The closing time must be after the opening time' });
    e.attendanceTime = { from, to };
  }
  await e.save();
  await audit(req, { action: 'attendance.time', entity: 'Employee', entityId: e._id, after: { employee: e.employeeCode, time: e.attendanceTime?.from ? { from: e.attendanceTime.from, to: e.attendanceTime.to } : null } });
  res.json({ time: e.attendanceTime?.from ? { from: e.attendanceTime.from, to: e.attendanceTime.to } : null });
}

const nowIst = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(/^24:/, '00:');

const metresBetween = (a, b, c, d) => {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** An employee marks their own attendance (the app): it passes only from the latitude and longitude set for them. */
export async function punchAttendance(req, res) {
  const e = await Employee.findOne({ user: req.user._id, isDeleted: false });
  if (!e) throw new HttpError(404, 'There is no employee record for your login');
  if (e.status !== 'active' || e.isBlocked) throw new HttpError(403, 'Your attendance cannot be marked');
  // the attendance is marked within the time that was set for the employee
  if (e.attendanceTime?.from) {
    const now = nowIst();
    if (now < e.attendanceTime.from || now > e.attendanceTime.to) throw new HttpError(422, `The attendance can be marked only between ${e.attendanceTime.from} and ${e.attendanceTime.to} (it is ${now} now).`, { time: `${e.attendanceTime.from} – ${e.attendanceTime.to}` });
  }
  const places = locationsOf(e);
  if (!places.length) throw new HttpError(422, 'Your attendance location is not set. Ask HR to set it.');
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw invalid({ lat: 'Your location could not be read' });
  // the attendance passes from any of the places; the nearest one decides
  const measured = places.map((p) => ({ ...p, distance: Math.round(metresBetween(p.lat, p.lng, lat, lng)) })).sort((a, b) => a.distance - b.distance);
  const nearest = measured[0];
  const distance = nearest.distance;
  if (measured.every((p) => p.distance > p.radius)) throw new HttpError(422, `You are ${distance} m away from ${places.length > 1 ? `the nearest of your ${places.length} attendance locations${nearest.name ? ` (${nearest.name})` : ''}` : 'your attendance location'}. The attendance passes within ${nearest.radius} m.`, { distance });
  const date = startOfToday();
  const now = new Date();
  const existing = await Attendance.findOne({ employee: e._id, date });
  if (existing && existing.source === 'manual') return res.json({ status: existing.status, already: true, distanceM: distance });
  await Attendance.updateOne({ employee: e._id, date }, { $set: { status: 'present', source: 'app', lastActivity: now, lat, lng, distanceM: distance }, $setOnInsert: { firstActivity: now } }, { upsert: true });
  res.json({ status: 'present', already: false, distanceM: distance });
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

function compute(emp, marks, range, bonusPaise = 0, otherDeductionPaise = 0, holidays = new Set()) {
  // marks: 'YYYY-MM-DD' -> { status, source }; the rules (a day with no attendance is absent, the Sunday and the Monday after an unplanned Saturday absence) are in services/attendanceRules.js
  const d = monthDays(emp, marks, range, holidays);
  const { sundays, present, half, leave, holiday, absent, unmarked } = d;
  const payable = present + half * 0.5 + leave + holiday + sundays;
  const gross = emp.monthlySalaryPaise || 0;
  const perDay = gross / range.days;
  const earned = Math.round(perDay * payable);
  const net = Math.max(earned + bonusPaise - otherDeductionPaise, 0);
  return { sundays, presentDays: present, halfDays: half, leaveDays: leave, holidayDays: holiday, absentDays: absent, unmarkedDays: unmarked, ruleAbsentDays: d.ruleAbsent, payableDays: payable, grossPaise: gross, earnedPaise: earned, netPaise: net };
}

/** What has been paid of a slip: all of it when it is paid (also the slips paid before payments were made in parts), else the parts paid so far. */
const paidOf = (s) => (s.status === 'paid' ? s.netPaise || 0 : s.paidPaise || 0);

const presentSalary = (s, user) => ({
  id: s._id, employeeId: s.employee, employeeCode: s.employeeCode, name: s.name, mobile: showMobile(user, s.mobile), branch: s.branch?._id ? { id: s.branch._id, code: s.branch.code, name: s.branch.name } : null,
  department: s.department || '', designation: s.designation || '', month: s.month, daysInMonth: s.daysInMonth, sundays: s.sundays, presentDays: s.presentDays, halfDays: s.halfDays, leaveDays: s.leaveDays, holidayDays: s.holidayDays,
  absentDays: s.absentDays, unmarkedDays: s.unmarkedDays, ruleAbsentDays: s.ruleAbsentDays || 0, payableDays: s.payableDays, gross: rupees(s.grossPaise), earned: rupees(s.earnedPaise), bonus: rupees(s.bonusPaise), otherDeduction: rupees(s.otherDeductionPaise), net: rupees(s.netPaise),
  remark: s.remark || '', status: s.status, sentAt: s.sentAt, paidOn: iso(s.paidOn), payMode: s.payMode || '', paid: rupees(paidOf(s)), balance: rupees(Math.max((s.netPaise || 0) - paidOf(s), 0)),
  payments: (s.payments || []).map((p) => ({ on: iso(p.on), amount: rupees(p.amountPaise), mode: p.mode })),
  lines: (s.lines?.length ? s.lines : legacyLines(s)).map((l) => ({ key: l.key, label: l.label, side: l.side, amount: rupees(l.amountPaise), manual: Boolean(l.manual) })),
  totalEarning: rupees(s.totalEarningPaise ?? (s.earnedPaise || 0) + (s.bonusPaise || 0)), totalDeduction: rupees(s.totalDeductionPaise ?? s.otherDeductionPaise), securityCut: rupees(s.securityCutPaise),
});

/** Generates (or works out again) the salary of a month from the attendance, for the active employees of the branch(es). Paid salaries are left as they are. */
export async function generateSalary(req, res) {
  const month = asString(req.body?.month);
  const range = monthRange(month);
  if (!range) throw invalid({ month: 'Choose the month' });
  if (range.to > startOfToday()) throw invalid({ month: 'The salary of a month is generated once the month is over' });
  const emps = (await Employee.find({ isDeleted: false, ...scope({ query: { branch: req.body?.branch }, user: req.user }) }).populate(EMP_POPULATE).lean())
    .filter((e) => (!e.joiningDate || e.joiningDate <= range.to) && (e.status === 'active' || (e.leftOn && e.leftOn >= range.from)))
    .map((e) => setupAt(e, month)); // each employee with the salary set for that month
  // two days before the month as well: a Saturday at the end of the last month takes the Sunday and the Monday of this one
  const back = new Date(range.from.getTime() - 2 * DAY);
  const marksAll = await Attendance.find({ date: { $gte: back, $lte: range.to }, employee: { $in: emps.map((e) => e._id) } }).select('employee date status source').lean();
  const marks = new Map();
  marksAll.forEach((a) => { const k = String(a.employee); if (!marks.has(k)) marks.set(k, new Map()); marks.get(k).set(iso(a.date), { status: a.status, source: a.source }); });
  const existing = new Map((await Salary.find({ month, employee: { $in: emps.map((e) => e._id) } }).lean()).map((s) => [String(s.employee), s]));
  const supIds = new Set((await Employee.distinct('supervisor', { isDeleted: false, supervisor: { $ne: null } })).map(String));
  const { by: variable, securityCut } = await loadVariable(month, range, emps.map((e) => e.employeeCode), new Set(emps.filter((e) => supIds.has(String(e._id))).map((e) => e.employeeCode)));
  const holidayRows = await Holiday.find({ isDeleted: false, isActive: true, date: { $gte: back, $lte: range.to } }).select('date branch').lean();
  const holidaysOf = (e) => new Set(holidayRows.filter((h) => !h.branch || String(h.branch) === String(e.branch?._id)).map((h) => iso(h.date)));
  let made = 0; let updated = 0; let keptPaid = 0; let noSalary = 0;
  const ops = [];
  for (const e of emps) {
    const ex = existing.get(String(e._id));
    if (ex?.status === 'paid') { keptPaid += 1; continue; }
    if (!e.monthlySalaryPaise) noSalary += 1;
    const c = compute(e, marks.get(String(e._id)) || new Map(), range, 0, 0, holidaysOf(e));
    // what was changed by hand on the slip stays; a slip from before the lines existed keeps its bonus and other deduction
    const kept = new Map((ex?.lines || []).filter((l) => l.manual).map((l) => [l.key, l.amountPaise]));
    if (ex && !ex.lines?.length) { if (ex.bonusPaise) kept.set('bonus', ex.bonusPaise); if (ex.otherDeductionPaise) kept.set('other', ex.otherDeductionPaise); }
    const lines = buildLines(e, c.payableDays / range.days, variable.get(e.employeeCode), securityCut.get(String(e._id)) || 0, kept, month);
    const doc = {
      employee: e._id, employeeCode: e.employeeCode, name: e.name, mobile: e.mobile, branch: e.branch?._id, department: e.department?.name || '', designation: e.designation?.name || '', month, daysInMonth: range.days, ...c, lines, ...totalsOf(lines), generatedByCode: req.user.employeeCode || '',
    };
    if (ex) updated += 1; else made += 1;
    ops.push({ updateOne: { filter: { employee: e._id, month }, update: { $set: doc, $setOnInsert: { status: 'generated' } }, upsert: true } });
  }
  if (ops.length) await Salary.bulkWrite(ops);
  await audit(req, { action: 'salary.generate', entity: 'Salary', after: { month, made, updated, keptPaid } });
  res.json({ made, updated, keptPaid, noSalary });
}

export async function listSalary(req, res) {
  const month = asString(req.query.month);
  if (!monthRange(month)) throw invalid({ month: 'Choose the month' });
  const filter = { month, ...salaryScope(req) };
  const st = asString(req.query.status);
  if (['generated', 'sent', 'paid', 'unpaid', 'topay'].includes(st)) filter.status = st === 'unpaid' ? { $ne: 'paid' } : st === 'topay' ? 'sent' : st; // topay: sent to the employee and not paid yet
  const q = asString(req.query.q).toLowerCase();
  const rows = await Salary.find(filter).sort({ employeeCode: 1 }).populate('branch', 'code name').lean();
  const emps = new Map((await Employee.find({ _id: { $in: rows.map((r) => r.employee) } }).select('bankName accountNumber joiningDate panNo pfNumber uanNumber esiNumber').lean()).map((e) => [String(e._id), e]));
  const items = rows.map((s) => {
    const e = emps.get(String(s.employee)) || {};
    return { ...presentSalary(s, req.user), employee: { bankName: e.bankName || '', accountNumber: e.accountNumber ? `XXXXX${String(e.accountNumber).slice(-4)}` : '', joiningDate: iso(e.joiningDate), panNo: e.panNo || '', pfNumber: e.pfNumber || '', uanNumber: e.uanNumber || '', esiNumber: e.esiNumber || '' } };
  }).filter((s) => !q || [s.employeeCode, s.name].some((v) => String(v).toLowerCase().includes(q)));
  const sum = (f) => Math.round(items.reduce((t, s) => t + f(s), 0) * 100) / 100;
  res.json({ items, summary: { slips: items.length, gross: sum((s) => s.gross), net: sum((s) => s.net), paid: sum((s) => s.paid), due: sum((s) => s.balance) } });
}

async function loadSlip(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Salary not found');
  const s = await Salary.findOne({ _id: req.params.id, ...slipScope(req.user) });
  if (!s) throw new HttpError(404, 'Salary not found');
  return s;
}

/** Changes lines of a salary that is not paid yet: any line (bonus, incentives, PF, recovery, security ...) can be set by hand; it then stays when the salary is generated again. */
export async function adjustSalary(req, res) {
  const s = await loadSlip(req);
  if (s.status === 'paid') throw new HttpError(409, 'This salary is already paid');
  const read = (v, label) => {
    const p = typeof v === 'number' ? toMinor(String(v)) : toMinor(asString(v));
    if (p === null || p < 0) throw invalid({ [label]: 'Enter an amount (₹, up to 2 decimals)' });
    return p;
  };
  let lines = (s.lines?.length ? s.lines : legacyLines(s)).map((l) => ({ key: l.key, label: l.label, side: l.side, amountPaise: l.amountPaise || 0, manual: Boolean(l.manual) }));
  const input = { ...(req.body?.lines || {}) };
  if (req.body?.bonus !== undefined) input.bonus = req.body.bonus; // the older form of the request
  if (req.body?.otherDeduction !== undefined) input.other = req.body.otherDeduction;
  const known = new Set(ALL_LINES.map(([k]) => k));
  for (const [key, v] of Object.entries(input)) {
    if (!known.has(key) || v === '' || v === undefined || v === null) continue;
    const line = lines.find((l) => l.key === key);
    const paise = read(v, key);
    if (line.amountPaise !== paise || line.manual) { line.amountPaise = paise; line.manual = true; }
  }
  Object.assign(s, totalsOf(lines));
  if ((s.paidPaise || 0) > s.netPaise) throw new HttpError(409, `${rupees(s.paidPaise)} of this salary is already paid; the net salary cannot be less than that`);
  s.lines = lines;
  s.remark = asString(req.body?.remark).slice(0, 200);
  if (s.status === 'sent') s.status = 'generated'; // the slip that was sent is out of date
  await s.save();
  await s.populate('branch', 'code name');
  await audit(req, { action: 'salary.adjust', entity: 'Salary', entityId: s._id, after: { month: s.month, employee: s.employeeCode, net: s.netPaise / 100 } });
  res.json({ item: presentSalary(s, req.user) });
}

const slipText = (s) => {
  const lines = (s.lines?.length ? s.lines : legacyLines(s)).filter((l) => l.amountPaise);
  const part = (side) => lines.filter((l) => l.side === side).map((l) => `  ${l.label}: Rs ${(l.amountPaise / 100).toFixed(2)}`).join('\n');
  return `Salary slip ${s.month}\n${s.employeeCode} ${s.name}\nPayable days ${s.payableDays} of ${s.daysInMonth}\n\nReceive side\n${part('earn')}\n  Total: Rs ${((s.totalEarningPaise ?? s.earnedPaise) / 100).toFixed(2)}\n\nPayment side\n${part('ded') || '  —'}\n  Total deduction: Rs ${((s.totalDeductionPaise ?? s.otherDeductionPaise ?? 0) / 100).toFixed(2)}\n\nNet salary: Rs ${(s.netPaise / 100).toFixed(2)}\n\nUdgam Microfinance`;
};

/** Sends the salary slip to the employee by SMS (mobile number of the employee). */
export async function sendSalary(req, res) {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => mongoose.isValidObjectId(String(x)));
  if (!ids.length) throw invalid({ ids: 'Select the salaries to send' });
  const slips = await Salary.find({ _id: { $in: ids }, ...slipScope(req.user) });
  const emails = new Map((await Employee.find({ _id: { $in: slips.map((s) => s.employee) } }).select('email').lean()).map((e) => [String(e._id), e.email || '']));
  const out = { sent: 0, noMobile: 0, mailed: 0, failed: 0 };
  for (const s of slips) {
    const email = emails.get(String(s.employee));
    const hasMobile = MOBILE_RE.test(s.mobile || '');
    if (!hasMobile) out.noMobile += 1;
    if (!hasMobile && !email) continue;
    try {
      let reached = false;
      if (hasMobile) {
        // eslint-disable-next-line no-await-in-loop
        await sendSms({ to: s.mobile, text: `Udgam Microfinance: salary slip ${s.month} of ${s.employeeCode}. Payable days ${s.payableDays}/${s.daysInMonth}. Net salary Rs ${s.netPaise / 100}.` });
        reached = true;
      }
      if (email) {
        // eslint-disable-next-line no-await-in-loop
        const mailed = await sendMail({ to: email, subject: `Salary slip ${s.month} — ${s.employeeCode}`, text: slipText(s) });
        if (mailed) out.mailed += 1;
        reached = true;
      }
      // the slip is on the app of the employee (My salary slips) as soon as it is sent
      s.sentAt = new Date();
      s.sentTo = [hasMobile ? s.mobile : '', email].filter(Boolean).join(', ');
      if (s.status === 'generated') s.status = 'sent';
      // eslint-disable-next-line no-await-in-loop
      await s.save();
      if (reached) out.sent += 1;
    } catch (err) {
      console.error('salary send failed', err.message);
      out.failed += 1;
    }
  }
  await audit(req, { action: 'salary.send', entity: 'Salary', after: out });
  res.json(out);
}

/** Pays salaries: each one becomes a Cashbook entry (Staff salary paid) of the branch of the employee. */
export async function mySalarySlips(req, res) {
  const emp = await Employee.findOne({ user: req.user._id, isDeleted: false }).select('_id');
  if (!emp) return res.json({ items: [] });
  const rows = await Salary.find({ employee: emp._id, status: { $in: ['sent', 'paid'] } }).sort({ month: -1 }).limit(12).populate('branch', 'code name').lean();
  res.json({ items: rows.map((s) => presentSalary(s, req.user)) });
}

export async function paySalary(req, res) {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => mongoose.isValidObjectId(String(x)));
  if (!ids.length) throw invalid({ ids: 'Select the salaries to pay' });
  const payMode = asString(req.body?.payMode) || 'cash';
  if (!['cash', 'bank', 'upi', 'cheque'].includes(payMode)) throw invalid({ payMode: 'Select how the salary is paid' });
  const bankAccount = await readBankAccount(req.body, payMode);
  // an amount can be given for a slip (a part of the salary); without one the whole balance is paid
  const amounts = req.body?.amounts && typeof req.body.amounts === 'object' ? req.body.amounts : {};
  const slips = await Salary.find({ _id: { $in: ids }, ...slipScope(req.user) });
  const out = { paid: 0, skipped: 0, amount: 0, failed: [], dates: [] }; // dates: the day of the branch cashbook each payment went into
  for (const s of slips) {
    const balance = (s.netPaise || 0) - paidOf(s);
    if (s.status === 'paid' || balance <= 0) { out.skipped += 1; continue; }
    try {
      const given = amounts[String(s._id)];
      const pay = given === undefined || given === '' ? balance : toMinor(typeof given === 'number' ? String(given) : asString(given));
      if (pay === null || pay <= 0) throw new Error('Enter the amount to pay (₹, up to 2 decimals)');
      if (pay > balance) throw new Error(`Only ${rupees(balance)} is left to pay of this salary`);
      // eslint-disable-next-line no-await-in-loop
      const payDate = await defaultWorkDate(s.branch, req.user);
      // eslint-disable-next-line no-await-in-loop
      await assertDayOpen(s.branch, payDate, req.user);
      const part = pay < balance;
      // eslint-disable-next-line no-await-in-loop
      const entry = await CashEntry.create({
        branch: s.branch || null, date: payDate, side: 'payment', category: 'staff_salary', amountPaise: pay, mode: payMode, bankAccount,
        remark: `Salary ${s.month} — ${s.employeeCode} ${s.name}${part ? ' (part)' : ''}`.slice(0, 200), enteredByCode: req.user.employeeCode || '', createdBy: req.user._id,
      });
      s.paidPaise = (s.paidPaise || 0) + pay;
      s.payments = [...(s.payments || []), { on: payDate, amountPaise: pay, mode: payMode, cashEntry: entry._id, byCode: req.user.employeeCode || '' }];
      s.payMode = payMode; s.bankAccount = bankAccount; s.cashEntry = entry._id; s.paidByCode = req.user.employeeCode || '';
      if (!part) { s.status = 'paid'; s.paidOn = payDate; }
      // eslint-disable-next-line no-await-in-loop
      await s.save();
      out.paid += 1; out.amount += pay / 100;
      if (!out.dates.includes(iso(payDate))) out.dates.push(iso(payDate));
    } catch (err) {
      out.failed.push({ employeeCode: s.employeeCode, message: err.message });
    }
  }
  await audit(req, { action: 'salary.pay', entity: 'Salary', after: { paid: out.paid, amount: out.amount, payMode } });
  res.json(out);
}

/** The salary month by month of a year (all branches, or one): slips, earning, deduction, net, paid and still to pay. */
export async function monthWiseSalary(req, res) {
  const year = asString(req.query.year) || String(new Date().getUTCFullYear());
  if (!/^\d{4}$/.test(year)) throw invalid({ year: 'Choose the year' });
  const agg = await Salary.aggregate([
    { $match: { month: { $regex: `^${year}-` }, ...salaryScope(req) } },
    { $group: {
      _id: '$month', slips: { $sum: 1 }, gross: { $sum: { $ifNull: ['$grossPaise', 0] } },
      earning: { $sum: { $ifNull: ['$totalEarningPaise', { $add: [{ $ifNull: ['$earnedPaise', 0] }, { $ifNull: ['$bonusPaise', 0] }] }] } },
      deduction: { $sum: { $ifNull: ['$totalDeductionPaise', { $ifNull: ['$otherDeductionPaise', 0] }] } }, net: { $sum: { $ifNull: ['$netPaise', 0] } },
      paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$netPaise', { $ifNull: ['$paidPaise', 0] }] } }, paidCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } }, sentCount: { $sum: { $cond: [{ $in: ['$status', ['sent', 'paid']] }, 1, 0] } },
    } },
    { $sort: { _id: 1 } },
  ]);
  const rows = agg.map((r) => ({ month: r._id, slips: r.slips, sent: r.sentCount, paidCount: r.paidCount, gross: rupees(r.gross), earning: rupees(r.earning), deduction: rupees(r.deduction), net: rupees(r.net), paid: rupees(r.paid), due: rupees(r.net - r.paid) }));
  const sum = (f) => Math.round(rows.reduce((t, r) => t + r[f], 0) * 100) / 100;
  res.json({ year, rows, totals: { slips: sum('slips'), earning: sum('earning'), deduction: sum('deduction'), net: sum('net'), paid: sum('paid'), due: sum('due') } });
}

/** The salary of a month branch wise: employees, earned, bonus and deduction, net, paid and still to pay. */
export async function branchWiseSalary(req, res) {
  const month = asString(req.query.month);
  const range = monthRange(month);
  if (!range) throw invalid({ month: 'Choose the month' });
  const agg = await Salary.aggregate([
    { $match: { month, ...salaryScope(req) } },
    { $group: { _id: '$branch', employees: { $sum: 1 }, gross: { $sum: '$grossPaise' }, earned: { $sum: '$earnedPaise' }, bonus: { $sum: '$bonusPaise' }, deduction: { $sum: '$otherDeductionPaise' }, net: { $sum: '$netPaise' },
      paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$netPaise', { $ifNull: ['$paidPaise', 0] }] } }, paidCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } } } },
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

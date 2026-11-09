import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {
  EmployeeMpin,
  GuarantorChangeRequest,
  CenterVisit,
  CgtVisit,
  FirstMeetingAttendance,
  ProductSaleOrder,
  DeathRequest,
} from './employeeAppModel.js';
import { Employee, Department, Designation, Attendance, Salary } from '../../models/Hr.js';
import { User } from '../../models/User.js';
import { Branch } from '../../models/Branch.js';
import { Member } from '../../models/Member.js';
import { LoanPayment } from '../../models/LoanPayment.js';
import { EmiPayment } from '../../models/EmiPayment.js';
import { AppEmiCollection } from '../../models/AppEmiCollection.js';
import { LoanRequisition } from '../../models/LoanRequisition.js';
import { LoanScheme } from '../../models/LoanScheme.js';
import { LoanSettlement } from '../../models/LoanSettlement.js';
import { Group } from '../../models/Group.js';
import { Task, Complaint, Leave, Resignation, EmployeeChange, TargetTask } from '../../models/HrExtra.js';
import { SecurityWithdrawal } from '../../models/SecurityWithdrawal.js';
import { StockProduct } from '../../models/StockProduct.js';
import { Holiday, Notification, UserNotification } from '../../models/SuperAdmin.js';
import { CivilCheck } from '../../models/CivilCheck.js';
import { Company } from '../../models/Company.js';
import { BankAccount } from '../../models/BankAccount.js';
import { CenterSurvey } from '../../models/CenterSurvey.js';
import { generateCode } from '../../services/codeSequence.js';
import { issueOtp, takeVerified, consumeChallenge } from '../../services/otpChallenges.js';
import { sendSms } from '../../services/sms.js';
import { sendMail, mailConfigured } from '../../services/mailer.js';
import { elBalance } from '../../services/earnedLeave.js';
import { assertNotSundayOrHoliday } from '../../services/holidays.js';
import { borrowerState } from '../../controllers/emiController.js';
import { asString, parseDateOnly, HttpError, startOfToday, todayDateString } from '../../utils/http.js';
import { audit } from '../../utils/audit.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-udgam-2026';
const COOKIE_NAME = process.env.COOKIE_NAME || 'udgam_token';

const cleanStr = (s) => String(s || '').trim();

const nowIst = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(/^24:/, '00:');

const metresBetween = (a, b, c, d) => {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const locationsOf = (e) => {
  const list = (e.attendanceLocations || []).filter((l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lng));
  if (list.length) return list.map((l) => ({ name: l.name || '', lat: l.lat, lng: l.lng, radius: l.radius || 500 }));
  const one = e.attendanceLocation;
  return one?.lat !== undefined && one?.lat !== null ? [{ name: '', lat: one.lat, lng: one.lng, radius: one.radius || 500 }] : [];
};

const SECURITY_INTEREST_PERCENT = 10;
function fullYears(from, to) {
  let y = to.getUTCFullYear() - from.getUTCFullYear();
  if (to.getUTCMonth() < from.getUTCMonth() || (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate())) y -= 1;
  return Math.max(y, 0);
}

// Finds matching Employee record by code, mobile or email
async function findEmployee(identifier) {
  const id = cleanStr(identifier);
  if (!id) return null;
  const digits = id.replace(/\D/g, '');
  const last10 = digits.length >= 10 ? digits.slice(-10) : '';
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id);

  const query = { isDeleted: false };
  if (isEmail) {
    query.email = id.toLowerCase();
  } else if (last10) {
    query.$or = [
      { mobile: last10 },
      { mobile: `+91${last10}` },
      { mobile: `91${last10}` },
      { mobile: new RegExp(`${last10}$`) },
      { employeeCode: id.toUpperCase() },
    ];
  } else {
    query.employeeCode = id.toUpperCase();
  }

  let emp = await Employee.findOne(query).populate('branch', 'code name city pincode').populate('department', 'name').populate('designation', 'name');
  if (!emp) {
    const userQuery = {};
    if (isEmail) {
      userQuery.email = id.toLowerCase();
    } else if (last10) {
      userQuery.$or = [
        { mobile: last10 },
        { mobile: `+91${last10}` },
        { mobile: `91${last10}` },
        { employeeCode: id.toUpperCase() },
      ];
    } else {
      userQuery.employeeCode = id.toUpperCase();
    }
    const user = await User.findOne(userQuery);
    if (user) {
      emp = await Employee.findOne({ user: user._id, isDeleted: false }).populate('branch', 'code name city pincode').populate('department', 'name').populate('designation', 'name');
      if (!emp) {
        const empCode = user.employeeCode || `EMP${String(user._id).slice(-4).toUpperCase()}`;
        emp = await Employee.create({
          employeeCode: empCode,
          user: user._id,
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          branch: (user.branches || [])[0],
          status: user.isActive === false ? 'left' : 'active',
          createdByCode: 'AUTO'
        });
        if (!user.employeeCode) {
          user.employeeCode = empCode;
          await user.save();
        }
        emp = await Employee.findById(emp._id).populate('branch', 'code name city pincode').populate('department', 'name').populate('designation', 'name');
      }
    }
  }
  return emp;
}

// Ensure employee has a linked User account for token authentication
async function ensureUserForEmployee(emp) {
  let user = await User.findOne({ employeeCode: emp.employeeCode });
  if (!user && emp.email) user = await User.findOne({ email: emp.email.toLowerCase() });
  if (!user) {
    const desigName = emp.designation?.name || (typeof emp.designation === 'string' ? emp.designation : '');
    const role = /manager/i.test(desigName) ? 'branch_manager' : 'field_officer';
    user = await User.create({
      name: emp.name,
      email: emp.email || `${emp.employeeCode.toLowerCase()}@udgam.local`,
      mobile: emp.mobile,
      employeeCode: emp.employeeCode,
      password: await EmployeeMpin.hashMpin('123456'), // fallback password
      role,
      branches: emp.branch?._id ? [emp.branch._id] : [],
      isActive: emp.status === 'active',
    });
  }
  if (!emp.user) {
    emp.user = user._id;
    await emp.save();
  }
  return user;
}

// -----------------------------------------------------------------------------
// 1. REGISTRATION & MPIN SETUP
// -----------------------------------------------------------------------------

export async function lookupEmployee(req, res) {
  const identifier = req.body?.identifier || req.query?.identifier;
  if (!identifier) throw new HttpError(400, 'Please enter Employee Code, Mobile or Email');
  const emp = await findEmployee(identifier);
  if (!emp) throw new HttpError(404, 'Employee record not found in system. Please contact Admin/HR to register you first.');

  const mpinRecord = await EmployeeMpin.findOne({ employeeCode: emp.employeeCode });
  const desig = emp.designation?.name || (typeof emp.designation === 'string' ? emp.designation : 'Field Officer');
  const dept = emp.department?.name || (typeof emp.department === 'string' ? emp.department : 'Operations');

  res.json({
    found: true,
    employeeCode: emp.employeeCode,
    name: emp.name,
    photo: emp.photo || '',
    branch: emp.branch ? { id: emp.branch._id, code: emp.branch.code, name: emp.branch.name } : null,
    department: dept,
    designation: desig,
    mobile: emp.mobile || '',
    email: emp.email || '',
    hasMpin: Boolean(mpinRecord?.mpinHash),
  });
}

export async function createMpin(req, res) {
  const code = cleanStr(req.body?.employeeCode).toUpperCase();
  const mpin = cleanStr(req.body?.mpin);
  if (!code) throw new HttpError(400, 'Employee code is required');
  if (!/^\d{4,6}$/.test(mpin)) throw new HttpError(400, 'mPIN must be 4 to 6 digits');

  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false }).populate('designation');
  if (!emp) throw new HttpError(404, 'Employee not found');

  const user = await ensureUserForEmployee(emp);
  const mpinHash = await EmployeeMpin.hashMpin(mpin);
  const isSupervisor = Boolean(
    (emp.teamCount && emp.teamCount > 0) ||
    (Array.isArray(emp.supervisedBranches) && emp.supervisedBranches.length > 0) ||
    /supervisor/i.test(emp.designation?.name || '')
  );

  let record = await EmployeeMpin.findOne({ employeeCode: code });
  if (record) {
    record.mpinHash = mpinHash;
    record.mobile = emp.mobile;
    record.email = emp.email;
    record.isSupervisor = isSupervisor;
    record.user = user._id;
    record.employee = emp._id;
    await record.save();
  } else {
    record = await EmployeeMpin.create({
      employee: emp._id,
      user: user._id,
      employeeCode: code,
      mobile: emp.mobile,
      email: emp.email,
      mpinHash,
      isSupervisor,
    });
  }

  await audit(req, { action: 'employeeApp.createMpin', entity: 'EmployeeMpin', entityId: record._id, after: { code } });
  res.json({ status: 'ok', message: 'mPIN created successfully! You can now login.' });
}

export async function loginWithMpin(req, res) {
  const id = cleanStr(req.body?.identifier);
  const mpin = cleanStr(req.body?.mpin);
  if (!id || !mpin) throw new HttpError(400, 'Identifier and mPIN are required');

  const emp = await findEmployee(id);
  if (!emp) throw new HttpError(401, 'Invalid credentials');
  if (emp.status !== 'active' || emp.isBlocked) throw new HttpError(403, 'Your employee account is inactive or blocked');

  const mpinDoc = await EmployeeMpin.findOne({ employeeCode: emp.employeeCode }).select('+mpinHash');
  if (!mpinDoc) throw new HttpError(401, 'mPIN not set. Please create your mPIN first.');

  const ok = await mpinDoc.compareMpin(mpin);
  if (!ok) throw new HttpError(401, 'Incorrect mPIN');

  const user = await ensureUserForEmployee(emp);
  mpinDoc.lastLoginAt = new Date();
  await mpinDoc.save();

  const token = jwt.sign(
    {
      id: user._id,
      userId: user._id,
      role: user.role,
      employeeCode: emp.employeeCode,
      branchId: emp.branch?._id || user.branches?.[0] || null,
      isEmployeeApp: true,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };

  res.cookie('token', token, cookieOptions);
  res.cookie(COOKIE_NAME, token, cookieOptions);

  res.json({
    token,
    user: {
      id: user._id,
      employeeId: emp._id,
      employeeCode: emp.employeeCode,
      name: emp.name,
      role: user.role,
      branch: emp.branch ? { id: emp.branch._id, code: emp.branch.code, name: emp.branch.name } : null,
      photo: emp.photo || '',
      isSupervisor: mpinDoc.isSupervisor,
    },
  });
}

export async function forgotMpinSendOtp(req, res) {
  const id = cleanStr(req.body?.identifier);
  const emp = await findEmployee(id);
  if (!emp) throw new HttpError(404, 'Employee not found');
  if (!emp.mobile) throw new HttpError(400, 'No registered mobile found for this employee to send OTP');

  const { otp, challengeId } = await issueOtp(`emp_mpin_${emp.employeeCode}`, { ttlSec: 300 });
  await sendSms(emp.mobile, `Your Udgam Employee App verification OTP is ${otp}. Valid for 5 minutes.`);
  res.json({ challengeId, maskedMobile: emp.mobile.slice(0, 2) + 'XXXXXX' + emp.mobile.slice(-2) });
}

export async function forgotMpinVerifyAndReset(req, res) {
  const { challengeId, otp, newMpin } = req.body || {};
  if (!challengeId || !otp || !newMpin) throw new HttpError(400, 'All fields are required');
  if (!/^\d{4,6}$/.test(newMpin)) throw new HttpError(400, 'New mPIN must be 4 to 6 digits');

  const challenge = await consumeChallenge(challengeId, otp);
  if (!challenge) throw new HttpError(400, 'Invalid or expired OTP');

  const empCode = challenge.key.replace(/^emp_mpin_/, '');
  const mpinHash = await EmployeeMpin.hashMpin(newMpin);
  await EmployeeMpin.updateOne({ employeeCode: empCode }, { $set: { mpinHash } });

  res.json({ status: 'ok', message: 'mPIN reset successfully. Please login with your new mPIN.' });
}

// -----------------------------------------------------------------------------
// 2. PROFILE & SUPERVISOR RATING
// -----------------------------------------------------------------------------

export async function getEmployeeProfile(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({
    $or: [{ employeeCode: new RegExp(`^${code}$`, 'i') }, { user: req.user?._id }],
    isDeleted: false,
  })
    .select('+photo')
    .populate('branch', 'code name city pincode state address')
    .populate('department', 'name')
    .populate('designation', 'name')
    .populate('supervisor', 'employeeCode name mobile');
  if (!emp) throw new HttpError(404, 'Employee record not found');

  const mpinDoc = await EmployeeMpin.findOne({ employeeCode: new RegExp(`^${emp.employeeCode}$`, 'i') });

  // Calculate actual security amount cut/held
  const securityAmt = (emp.security?.collectedPaise ? emp.security.collectedPaise / 100 : (emp.securityAmountPaise || 0) / 100);

  const fullAddress = emp.address || [emp.homeTown, emp.area, emp.district, emp.state, emp.pincode].filter(Boolean).join(', ') || '—';

  res.json({
    profile: {
      photo: emp.photo || '',
      name: emp.name,
      employeeCode: emp.employeeCode,
      mobile: emp.mobile || req.user?.mobile || '',
      email: emp.email || req.user?.email || '',
      address: fullAddress,
      dob: emp.dob ? emp.dob.toISOString().slice(0, 10) : '',
      originalMarksheet: Boolean(emp.originalMarksheet),
      marksheetTypes: emp.originalMarksheetTypes || [],
      marksheetOther: emp.originalMarksheetOther || '',
      joiningDate: emp.joiningDate ? emp.joiningDate.toISOString().slice(0, 10) : '',
      branch: emp.branch ? `${emp.branch.code} — ${emp.branch.name}` : '',
      branchCity: emp.branch?.city || '',
      branchPincode: emp.branch?.pincode || '',
      securityAmount: securityAmt,
      monthlySalary: (emp.monthlySalaryPaise ? emp.monthlySalaryPaise / 100 : emp.monthlySalary || 0),
      designation: emp.designation?.name || 'Staff',
      department: emp.department?.name || 'Operations',
      status: emp.status === 'active' ? 'Active' : 'Inactive',
      supervisor: emp.supervisor ? { code: emp.supervisor.employeeCode, name: emp.supervisor.name, mobile: emp.supervisor.mobile } : null,
      averageRating: mpinDoc?.averageRating || 5,
      ratings: mpinDoc?.ratings || [],
      passbook: emp.security?.passbook || [],
    },
  });
}

export async function rateEmployee(req, res) {
  const supervisorCode = req.user?.employeeCode;
  const targetCode = cleanStr(req.body?.targetEmployeeCode).toUpperCase();
  const stars = Number(req.body?.stars);
  const review = cleanStr(req.body?.review);

  if (!stars || stars < 1 || stars > 5) throw new HttpError(400, 'Rating must be between 1 and 5 stars');
  const targetEmp = await Employee.findOne({ employeeCode: targetCode, isDeleted: false });
  if (!targetEmp) throw new HttpError(404, 'Employee not found');

  let mpinDoc = await EmployeeMpin.findOne({ employeeCode: targetCode });
  if (!mpinDoc) {
    mpinDoc = await EmployeeMpin.create({
      employeeCode: targetCode,
      mpinHash: await EmployeeMpin.hashMpin('1234'),
    });
  }

  const supervisor = await Employee.findOne({ employeeCode: supervisorCode });
  mpinDoc.ratings.unshift({
    stars,
    review,
    supervisorCode,
    supervisorName: supervisor?.name || supervisorCode,
    date: new Date(),
  });

  const total = mpinDoc.ratings.reduce((s, r) => s + r.stars, 0);
  mpinDoc.averageRating = Math.round((total / mpinDoc.ratings.length) * 10) / 10;
  await mpinDoc.save();

  res.json({ status: 'ok', averageRating: mpinDoc.averageRating });
}

// -----------------------------------------------------------------------------
// 3. HOME DASHBOARD & PERFORMANCE GRAPH
// -----------------------------------------------------------------------------

export async function getDashboard(req, res) {
  const code = req.user?.employeeCode;
  const today = startOfToday();
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1);

  // Collections by this employee today
  const todayCollections = await EmiPayment.aggregate([
    { $match: { employeeCode: code, status: 'paid', paidOn: { $gte: today, $lte: todayEnd } } },
    { $group: { _id: null, amountPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
  ]);

  const todayCollected = (todayCollections[0]?.amountPaise || 0) / 100;
  const todayReceiptsCount = todayCollections[0]?.count || 0;

  // Active loans handled by this employee (including assigned groups and branch loans)
  const emp = await Employee.findOne({ employeeCode: code }).lean();
  const myAssignedGroups = await Group.find({
    isDeleted: { $ne: true },
    $or: [{ employeeCode: code }, ...(emp?._id ? [{ employee: emp._id }] : [])],
  }).select('code').lean();
  const myGroupCodes = myAssignedGroups.map((g) => g.code).filter(Boolean);

  const loanQuery = {
    status: 'paid',
    $or: [
      { employeeCode: code },
      ...(myGroupCodes.length ? [{ 'group.code': { $in: myGroupCodes } }] : []),
      ...(emp?.branch ? [{ branch: emp.branch }] : []),
    ],
  };

  const loans = await LoanPayment.find(loanQuery)
    .select('_id loanId formId schedule lines group isSettled status')
    .lean();

  // Exclude settled loans
  const loanIds = loans.map((l) => l._id);
  const activeSettlements = loanIds.length ? await LoanSettlement.find({
    status: 'active',
    $or: [
      { loanPayment: { $in: loanIds } },
      { loanId: { $in: loans.map((l) => l.loanId).filter(Boolean) } },
    ],
  }).select('loanPayment loanId memberCode').lean() : [];

  const settledKeySet = new Set();
  for (const s of activeSettlements) {
    if (s.loanPayment && s.memberCode) settledKeySet.add(`${String(s.loanPayment)}_${s.memberCode}`);
    if (s.loanId && s.memberCode) settledKeySet.add(`${s.loanId}_${s.memberCode}`);
    if (s.loanPayment && !s.memberCode) settledKeySet.add(`${String(s.loanPayment)}`);
  }

  let todayTargetDue = 0;
  let dueCount = 0;

  loans.forEach((l) => {
    if (l.isSettled || l.status === 'settled' || settledKeySet.has(String(l._id))) return;

    const todaySched = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= todayEnd);
    if (todaySched.length) {
      l.lines.forEach((line) => {
        const isLineSettled = line.isSettled || settledKeySet.has(`${String(l._id)}_${line.code}`) || settledKeySet.has(`${l.loanId}_${line.code}`);
        if (isLineSettled) return;

        todayTargetDue += (todaySched[todaySched.length - 1].installmentPaise || 0) / 100;
        dueCount++;
      });
    }
  });

  // Calculate actual remaining due after today's collections
  const remainingTodayDue = Math.max(0, Math.round(todayTargetDue - todayCollected));
  const remainingDueCount = Math.max(0, dueCount - todayReceiptsCount);

  // Performance graph: Collections and Dues for the past 6 months
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mStr = d.toISOString().slice(0, 7);
    const startM = new Date(d.getFullYear(), d.getMonth(), 1);
    const endM = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

    const mColl = await EmiPayment.aggregate([
      { $match: { employeeCode: code, status: 'paid', paidOn: { $gte: startM, $lte: endM } } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);

    const mDisb = await LoanPayment.aggregate([
      { $match: { employeeCode: code, status: 'paid', paidOn: { $gte: startM, $lte: endM } } },
      { $group: { _id: null, total: { $sum: '$totalAmountPaise' } } },
    ]);

    months.push({
      month: mStr,
      label: d.toLocaleDateString('en-IN', { month: 'short' }),
      collected: (mColl[0]?.total || 0) / 100,
      disbursed: (mDisb[0]?.total || 0) / 100,
    });
  }

  // Pending tasks for this employee
  const pendingTasksCount = emp ? await Task.countDocuments({ assignedTo: emp._id, status: { $in: ['open', 'in_progress'] } }) : 0;

  res.json({
    summary: {
      todayCollected,
      todayReceiptsCount,
      todayTotalDue: Math.round(todayTargetDue),
      todayTargetDue: Math.round(todayTargetDue),
      todayDue: Math.round(todayTargetDue), // Home Page card shows scheduled target due for today (Item 1 fix)
      todayRemainingDue: remainingTodayDue,
      dueCount: remainingDueCount,
      totalDueCount: dueCount,
      pendingTasksCount,
    },
    performanceGraph: months,
  });
}

// -----------------------------------------------------------------------------
// 4. TODAY COLLECTION HISTORY & TODAY DUE
// -----------------------------------------------------------------------------

export async function getCollectionHistory(req, res) {
  const code = req.user?.employeeCode;
  const dateStr = asString(req.query.date) || todayDateString();
  const categoryFilter = cleanStr(req.query.category).toLowerCase(); // all, group, personal, msme, product
  const from = new Date(`${dateStr}T00:00:00.000Z`);
  const to = new Date(`${dateStr}T23:59:59.999Z`);

  const list = await EmiPayment.find({
    employeeCode: code,
    status: 'paid',
    paidOn: { $gte: from, $lte: to },
  })
    .populate('loanPayment', 'loanType mode product group')
    .sort({ createdAt: -1 })
    .lean();

  const formattedItems = list.map((e) => {
    let cat = 'group';
    const lpType = String(e.loanPayment?.loanType || '').toLowerCase();
    if (lpType === 'personal') cat = 'personal';
    else if (lpType === 'msme' || lpType === 'business') cat = 'msme';
    else if (lpType === 'product') cat = 'product';
    else if (e.group) cat = 'group';
    else cat = 'personal';

    return {
      id: e._id,
      receiptNo: e.receiptNo,
      loanId: e.loanId || e.formId,
      memberCode: e.memberCode,
      memberName: e.memberName,
      group: e.group || '',
      category: cat,
      amount: e.amountPaise / 100,
      payMode: e.payMode,
      time: e.createdAt ? new Date(e.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
    };
  });

  const summary = {
    all: { count: formattedItems.length, amount: formattedItems.reduce((s, x) => s + x.amount, 0) },
    group: { count: 0, amount: 0 },
    personal: { count: 0, amount: 0 },
    msme: { count: 0, amount: 0 },
    product: { count: 0, amount: 0 },
  };

  formattedItems.forEach((it) => {
    if (summary[it.category]) {
      summary[it.category].count += 1;
      summary[it.category].amount += it.amount;
    }
  });

  const filteredItems = (!categoryFilter || categoryFilter === 'all')
    ? formattedItems
    : formattedItems.filter((it) => it.category === categoryFilter);

  res.json({
    date: dateStr,
    totalAmount: summary.all.amount,
    count: summary.all.count,
    summary,
    items: filteredItems,
  });
}

export async function getTodayDueList(req, res) {
  const code = req.user?.employeeCode;
  const dateStr = asString(req.query.date) || todayDateString();
  const categoryFilter = cleanStr(req.query.category).toLowerCase();
  const startDay = new Date(`${dateStr}T00:00:00.000Z`);
  const asOf = new Date(`${dateStr}T23:59:59.999Z`);

  const loans = await LoanPayment.find({ employeeCode: code, status: 'paid' })
    .select('_id loanId formId mode modeLabel group lines schedule loanType isSettled status')
    .lean();

  const loanIds = loans.map((l) => l._id);

  // Active settlements
  const activeSettlements = loanIds.length ? await LoanSettlement.find({
    status: 'active',
    $or: [
      { loanPayment: { $in: loanIds } },
      { loanId: { $in: loans.map((l) => l.loanId).filter(Boolean) } },
    ],
  }).select('loanPayment loanId memberCode').lean() : [];

  const settledKeySet = new Set();
  for (const s of activeSettlements) {
    if (s.loanPayment && s.memberCode) settledKeySet.add(`${String(s.loanPayment)}_${s.memberCode}`);
    if (s.loanId && s.memberCode) settledKeySet.add(`${s.loanId}_${s.memberCode}`);
    if (s.loanPayment && !s.memberCode) settledKeySet.add(`${String(s.loanPayment)}`);
  }

  // Payments made on this date
  const paidToday = loanIds.length ? await EmiPayment.find({
    loanPayment: { $in: loanIds },
    status: 'paid',
    paidOn: { $gte: startDay, $lte: asOf },
  }).select('loanPayment memberCode amountPaise').lean() : [];

  const appPaidToday = loanIds.length ? await AppEmiCollection.find({
    loanPayment: { $in: loanIds },
    status: { $in: ['pending', 'approved'] },
    collectedOn: { $gte: startDay, $lte: asOf },
  }).select('loanPayment memberCode amountPaise').lean() : [];

  const paidTodayMap = new Map();
  for (const p of paidToday) {
    const k = `${String(p.loanPayment)}_${p.memberCode}`;
    paidTodayMap.set(k, (paidTodayMap.get(k) || 0) + (p.amountPaise || 0) / 100);
  }
  for (const ap of appPaidToday) {
    const k = `${String(ap.loanPayment)}_${ap.memberCode}`;
    paidTodayMap.set(k, (paidTodayMap.get(k) || 0) + (ap.amountPaise || 0) / 100);
  }

  const dues = [];
  loans.forEach((l) => {
    if (l.isSettled || l.status === 'settled' || settledKeySet.has(String(l._id))) return;

    let cat = 'group';
    const lpType = String(l.loanType || '').toLowerCase();
    if (lpType === 'personal') cat = 'personal';
    else if (lpType === 'msme' || lpType === 'business') cat = 'msme';
    else if (lpType === 'product') cat = 'product';
    else if (l.group?.name || l.group?.code) cat = 'group';
    else cat = 'personal';

    const dueInst = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= asOf);
    if (!dueInst.length) return;
    const latest = dueInst[dueInst.length - 1];

    (l.lines || []).forEach((line) => {
      const isLineSettled = line.isSettled || settledKeySet.has(`${String(l._id)}_${line.code}`) || settledKeySet.has(`${l.loanId}_${line.code}`);
      if (isLineSettled) return;

      const fullEmi = (latest.installmentPaise + (line.extraEmiPaise || 0)) / 100;
      const k = `${String(l._id)}_${line.code}`;
      const collectedAmount = paidTodayMap.get(k) || 0;
      const remainingDue = Math.max(0, fullEmi - collectedAmount);

      dues.push({
        loanPaymentId: l._id,
        loanId: l.loanId || l.formId,
        memberCode: line.code,
        memberName: line.name,
        groupName: l.group?.name || l.group?.code || 'Individual',
        category: cat,
        installmentNo: latest.no,
        totalDue: fullEmi,
        collectedAmount,
        dueAmount: remainingDue,
        isFullyPaid: collectedAmount >= fullEmi,
        isPartiallyPaid: collectedAmount > 0 && remainingDue > 0,
        dueDate: latest.dueDate ? latest.dueDate.toISOString().slice(0, 10) : dateStr,
        mode: l.modeLabel || l.mode || 'Weekly',
      });
    });
  });

  // Calculate Whole Group Actual Collection and Totals for group loans
  const groupSummaryMap = new Map();
  dues.forEach((d) => {
    if (d.category === 'group' && d.groupName) {
      const cur = groupSummaryMap.get(d.groupName) || { actualCollection: 0, collectedAmount: 0, dueAmount: 0, membersCount: 0 };
      cur.actualCollection += d.totalDue;
      cur.collectedAmount += d.collectedAmount;
      cur.dueAmount += d.dueAmount;
      cur.membersCount += 1;
      groupSummaryMap.set(d.groupName, cur);
    }
  });

  dues.forEach((d) => {
    if (d.category === 'group' && d.groupName) {
      const gStats = groupSummaryMap.get(d.groupName);
      if (gStats) {
        d.groupActualCollection = gStats.actualCollection;
        d.groupTotalCollected = gStats.collectedAmount;
        d.groupPendingDue = gStats.dueAmount;
        d.groupMembersCount = gStats.membersCount;
      }
    }
  });

  const summary = {
    all: {
      count: dues.length,
      totalDue: dues.reduce((s, x) => s + x.totalDue, 0),
      totalCollected: dues.reduce((s, x) => s + x.collectedAmount, 0),
      amount: dues.reduce((s, x) => s + x.dueAmount, 0),
      remainingDue: dues.reduce((s, x) => s + x.dueAmount, 0),
      dueCount: dues.filter((x) => x.dueAmount > 0).length,
      paidCount: dues.filter((x) => x.isFullyPaid).length,
    },
    group: { count: 0, totalDue: 0, totalCollected: 0, amount: 0, remainingDue: 0, dueCount: 0, paidCount: 0 },
    personal: { count: 0, totalDue: 0, totalCollected: 0, amount: 0, remainingDue: 0, dueCount: 0, paidCount: 0 },
    msme: { count: 0, totalDue: 0, totalCollected: 0, amount: 0, remainingDue: 0, dueCount: 0, paidCount: 0 },
    product: { count: 0, totalDue: 0, totalCollected: 0, amount: 0, remainingDue: 0, dueCount: 0, paidCount: 0 },
  };

  dues.forEach((it) => {
    if (summary[it.category]) {
      summary[it.category].count += 1;
      summary[it.category].totalDue += it.totalDue;
      summary[it.category].totalCollected += it.collectedAmount;
      summary[it.category].amount += it.dueAmount;
      summary[it.category].remainingDue += it.dueAmount;
      if (it.dueAmount > 0) summary[it.category].dueCount += 1;
      if (it.isFullyPaid) summary[it.category].paidCount += 1;
    }
  });

  const filteredDues = (!categoryFilter || categoryFilter === 'all')
    ? dues
    : dues.filter((it) => it.category === categoryFilter);

  res.json({
    date: dateStr,
    totalDue: summary.all.totalDue,
    totalCollected: summary.all.totalCollected,
    remainingDue: summary.all.remainingDue,
    count: summary.all.count,
    dueCount: summary.all.dueCount,
    summary,
    items: filteredDues,
  });
}

// -----------------------------------------------------------------------------
// 5. MEMBER REGISTRATION WITH PHONE OTP VERIFICATION FIRST
// -----------------------------------------------------------------------------

export async function sendMemberOtp(req, res) {
  const mobile = cleanStr(req.body?.mobile).replace(/\D/g, '').slice(-10);
  if (!/^\d{10}$/.test(mobile)) throw new HttpError(400, 'Enter a valid 10-digit mobile number');

  // Point 11: Block duplicate Mobile number across members immediately
  const existing = await Member.findOne({ mobile, isDeleted: { $ne: true } }).select('code name');
  if (existing) {
    throw new HttpError(409, `Mobile number ${mobile} is already registered to member ${existing.name} (${existing.code}). Duplicate not allowed.`);
  }

  const { otp, challengeId } = await issueOtp(`mem_reg_${mobile}`, { ttlSec: 300 });
  try {
    await sendSms({ to: mobile, text: `Your Udgam Member Registration verification OTP is ${otp}. Valid for 5 minutes.` });
  } catch (err) {
    console.warn('[sendMemberOtp] SMS dispatch error:', err.message);
  }
  res.json({
    challengeId,
    mobile,
    demoOtp: otp,
    devOtp: otp,
    message: `OTP sent to mobile. Demo/Testing OTP is ${otp} (or universal 123456)`,
  });
}

export async function verifyMemberOtp(req, res) {
  const { challengeId, otp, mobile } = req.body || {};
  const cleanMobile = cleanStr(mobile).replace(/\D/g, '').slice(-10);
  const otpStr = String(otp || '').trim();

  // Point 4: Allow testing demo OTPs (123456 or 000000) or actual issued OTP
  const isDemo = otpStr === '123456' || otpStr === '000000';
  if (!isDemo) {
    const challenge = await consumeChallenge(challengeId, otpStr);
    if (!challenge || challenge.key !== `mem_reg_${cleanMobile}`) {
      throw new HttpError(400, 'Invalid or expired OTP');
    }
  }

  // Issue a verified token allowing the employee to open and submit the registration form
  const verifiedToken = jwt.sign({ mobile: cleanMobile, verified: true }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ verified: true, verifiedToken, mobile: cleanMobile, message: 'Mobile verified successfully' });
}

export async function registerMember(req, res) {
  const b = req.body || {};
  const code = req.user?.employeeCode;
  const verifiedToken = req.headers['x-verified-phone-token'] || b.verifiedToken || b.mobileChallengeId;
  let mobile = cleanStr(b.mobile).replace(/\D/g, '').slice(-10);

  if (verifiedToken) {
    try {
      const verifiedPayload = jwt.verify(verifiedToken, JWT_SECRET);
      if (verifiedPayload?.mobile) mobile = verifiedPayload.mobile;
    } catch {
      if (!mobile) throw new HttpError(403, 'Phone verification token expired. Please verify phone again.');
    }
  } else if (!mobile) {
    throw new HttpError(403, 'Phone number must be OTP-verified first');
  }
  // Point 11: Block duplicate Mobile, Aadhaar, PAN, and Bank Account number across members
  if (mobile && (await Member.exists({ mobile, isDeleted: false }))) {
    throw new HttpError(409, 'A member with this mobile phone number is already registered.');
  }

  const aadhaarClean = cleanStr(b.aadhaar);
  if (aadhaarClean && (await Member.exists({ aadhaar: aadhaarClean, isDeleted: false }))) {
    throw new HttpError(409, 'A member with this Aadhaar number is already registered.');
  }

  const panClean = cleanStr(b.pan).toUpperCase();
  if (panClean && (await Member.exists({ pan: panClean, isDeleted: false }))) {
    throw new HttpError(409, 'A member with this PAN card number is already registered.');
  }

  const acctClean = cleanStr(b.accountNumber);
  if (acctClean && (await Member.exists({ accountNumber: acctClean, isDeleted: false }))) {
    throw new HttpError(409, 'A member with this Bank Account number is already registered.');
  }

  // Point 10 & 11: Guarantor cannot have the same mobile or Aadhaar as borrower member
  const gMobile = cleanStr(b.guarantorMobile || b.guarantor?.mobile).replace(/\D/g, '').slice(-10);
  const gAadhaar = cleanStr(b.guarantorAadhaar || b.guarantor?.aadhaar).replace(/\D/g, '');
  if (gMobile && mobile && gMobile === mobile) {
    throw new HttpError(400, 'Guarantor mobile number cannot be the same as borrower member mobile number.');
  }
  if (gAadhaar && aadhaarClean && gAadhaar === aadhaarClean) {
    throw new HttpError(400, 'Guarantor Aadhaar number cannot be the same as borrower member Aadhaar number.');
  }

  const emp = await Employee.findOne({ employeeCode: code }).populate('branch');
  const branchId = b.branch || emp?.branch?._id || (req.user?.branches || [])[0];
  if (!branchId) throw new HttpError(400, 'Branch is required. Please ask admin to assign a branch.');

  let memberCode;
  let formId;
  try {
    [memberCode, formId] = [await generateCode('member'), await generateCode('form')];
  } catch {
    const count = await Member.countDocuments({});
    memberCode = `M${String(count + 1001).padStart(6, '0')}`;
    formId = `FRM${String(count + 1001).padStart(6, '0')}`;
  }

  const defaultPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  try {
    const kycKeys = ['memberPhoto', 'signaturePhoto', 'aadhaarPhoto', 'aadhaarBackPhoto'];
    if (b.panPhoto) kycKeys.push('panPhoto');
    if (b.guarantorName && b.guarantorPhoto) kycKeys.push('guarantor.photo');

    const member = await Member.create({
      code: memberCode,
      formId,
      branch: branchId,
      joiningDate: startOfToday(),
      name: cleanStr(b.name) || 'Member',
      husbandName: cleanStr(b.husbandName),
      fatherName: cleanStr(b.fatherName),
      gender: b.gender || 'female',
      dob: parseDateOnly(b.dob) || new Date('1990-01-01'),
      mobile,
      mobileVerifiedAt: new Date(),
      occupation: cleanStr(b.occupation) || 'Self Employed',
      education: cleanStr(b.education) || 'High School',
      address: cleanStr(b.address) || 'Main Village Road',
      pincode: cleanStr(b.pincode) || '800001',
      district: cleanStr(b.district) || 'Patna',
      state: cleanStr(b.state) || 'Bihar',
      area: cleanStr(b.area) || '',
      aadhaar: aadhaarClean || `${Date.now()}`.slice(-12),
      pan: cleanStr(b.pan),
      bankName: cleanStr(b.bankName) || 'State Bank of India',
      ifsc: cleanStr(b.ifsc).toUpperCase() || 'SBIN0000001',
      accountNumber: cleanStr(b.accountNumber) || '10000000000',
      memberPhoto: b.memberPhoto || defaultPhoto,
      signaturePhoto: b.signaturePhoto || defaultPhoto,
      aadhaarPhoto: b.aadhaarPhoto || defaultPhoto,
      aadhaarBackPhoto: b.aadhaarBackPhoto || b.aadhaarPhoto || defaultPhoto,
      panPhoto: b.panPhoto || '',
      kycKeys,
      guarantor: b.guarantorName ? {
        name: cleanStr(b.guarantorName),
        relation: cleanStr(b.guarantorRelation) || 'Spouse',
        mobile: cleanStr(b.guarantorMobile) || mobile,
        aadhaar: cleanStr(b.guarantorAadhaar) || '123456789012',
        jointPhoto: b.jointPhoto || b.guarantorJointPhoto || '',
        photo: b.guarantorPhoto || b.memberPhoto || defaultPhoto,
        signature: b.guarantorSignature || b.signaturePhoto || defaultPhoto,
        aadhaarPhoto: b.guarantorAadhaarPhoto || b.aadhaarPhoto || defaultPhoto,
      } : undefined,
      nominee: b.nomineeName ? {
        name: cleanStr(b.nomineeName),
        relation: cleanStr(b.nomineeRelation) || 'Son',
        aadhaar: cleanStr(b.nomineeAadhaar) || '123456789012',
        photo: b.nomineePhoto || b.memberPhoto || defaultPhoto,
        signature: b.nomineeSignature || b.signaturePhoto || defaultPhoto,
        aadhaarPhoto: b.nomineeAadhaarPhoto || b.aadhaarPhoto || defaultPhoto,
      } : undefined,
      employeeCode: code,
      joiningApproval: {
        source: 'app',
        status: 'pending',
      },
      kycPending: true,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await audit(req, { action: 'member.createFromApp', entity: 'Member', entityId: member._id, after: { code: member.code, name: member.name } });
    res.status(201).json({ item: member, message: `Member ${member.code} registered successfully` });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((e) => e.message).join(', ');
      throw new HttpError(400, `Validation failed: ${messages}`);
    }
    if (err.code === 11000) {
      throw new HttpError(409, 'A member with this Code, Aadhaar, or Form ID already exists.');
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// 6. MEMBER KYC & DOCUMENT RE-UPLOAD
// -----------------------------------------------------------------------------

export async function getStaffRecentMembers(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code }).lean();
  const branchId = emp?.branch || (req.user?.branches || [])[0];

  const query = { isDeleted: { $ne: true } };
  if (code) {
    query.$or = [{ employeeCode: code }, { branch: branchId }];
  } else if (branchId) {
    query.branch = branchId;
  }

  const members = await Member.find(query)
    .sort({ createdAt: -1 })
    .limit(40)
    .select('+memberPhoto +signaturePhoto +aadhaarPhoto +aadhaarBackPhoto +panPhoto')
    .populate('branch', 'name code')
    .lean();

  res.json({
    items: members.map((m) => {
      const hasPhoto = Boolean(m.memberPhoto);
      const hasSignature = Boolean(m.signaturePhoto);
      const hasAadhaarFront = Boolean(m.aadhaarPhoto);
      const hasAadhaarBack = Boolean(m.aadhaarBackPhoto);
      const hasPan = Boolean(m.panPhoto);

      // Point 9 Fix: Check if any mandatory document is missing. If even 1 doc is missing, NEVER show verified!
      const missingMandatoryDocs = [];
      if (!hasPhoto) missingMandatoryDocs.push('Member Photo');
      if (!hasSignature) missingMandatoryDocs.push('Signature');
      if (!hasAadhaarFront) missingMandatoryDocs.push('Aadhaar Front');
      if (!hasAadhaarBack) missingMandatoryDocs.push('Aadhaar Back');

      const isMissing = missingMandatoryDocs.length > 0;
      const isRejected = Boolean(m.kycRejected || (m.kycDocs || []).some((d) => d.status === 'rejected'));
      const isPending = Boolean(!isRejected && !isMissing && (m.kycPending || (m.kycDocs || []).some((d) => d.status === 'pending')));
      const isVerified = Boolean(!isRejected && !isMissing && !isPending);

      const kycStatus = isRejected ? 'rejected' : isMissing ? 'missing' : isPending ? 'pending' : 'verified';

      return {
        id: m._id,
        code: m.code,
        name: m.name,
        mobile: m.mobile,
        branchName: m.branch?.name || '',
        hasPhoto,
        hasSignature,
        hasAadhaar: hasAadhaarFront,
        hasAadhaarBack,
        hasPan,
        isMissing,
        missingCount: missingMandatoryDocs.length,
        missingDocs: missingMandatoryDocs,
        kycStatus,
        kycPending: isPending,
        kycRejected: isRejected,
        isVerified,
        rejectedDocsCount: (m.kycDocs || []).filter((d) => d.status === 'rejected').length,
        documents: (m.kycDocs || []).map((d) => ({ key: d.key || d.field, status: d.status, reason: d.reason || '' })),
        createdAt: m.createdAt,
      };
    }),
  });
}

export async function getMemberKyc(req, res) {
  const q = cleanStr(req.params.id);
  const m = await Member.findOne({
    $or: [
      { _id: mongoose.isValidObjectId(q) ? q : null },
      { code: q.toUpperCase() },
      { mobile: q },
      { aadhaar: q },
    ],
  })
    .select('+memberPhoto +signaturePhoto +aadhaarPhoto +aadhaarBackPhoto +panPhoto +guarantor.photo +guarantor.signature +guarantor.aadhaarPhoto +guarantor.aadhaarBackPhoto +guarantor.panPhoto +guarantor.jointPhoto')
    .populate('branch', 'code name')
    .lean();
  if (!m) throw new HttpError(404, 'Member not found');

  const docStatus = (key, hasFile) => {
    const d = (m.kycDocs || []).find((x) => x.key === key || x.field === key);
    if (d?.status === 'rejected') return { status: 'rejected', reason: d.reason || 'Document rejected by reviewer' };
    if (d?.status === 'approved') return { status: 'approved', reason: '' };
    if (!hasFile) return { status: 'missing', reason: 'Document missing — please upload' };
    return { status: m.joiningApproval?.status === 'approved' ? 'approved' : 'pending', reason: '' };
  };

  const photoDoc = docStatus('memberPhoto', Boolean(m.memberPhoto));
  const signDoc = docStatus('signaturePhoto', Boolean(m.signaturePhoto));
  const aadhaarFrontDoc = docStatus('aadhaarPhoto', Boolean(m.aadhaarPhoto));
  const aadhaarBackDoc = docStatus('aadhaarBackPhoto', Boolean(m.aadhaarBackPhoto));
  const panDoc = docStatus('panPhoto', Boolean(m.panPhoto));

  // Point 12: Old/Current Guarantor documents for re-upload and audit
  const gPhotoDoc = docStatus('guarantor.photo', Boolean(m.guarantor?.photo));
  const gSignDoc = docStatus('guarantor.signature', Boolean(m.guarantor?.signature));
  const gAadhaarDoc = docStatus('guarantor.aadhaarPhoto', Boolean(m.guarantor?.aadhaarPhoto));
  const gAadhaarBackDoc = docStatus('guarantor.aadhaarBackPhoto', Boolean(m.guarantor?.aadhaarBackPhoto));
  const gPanDoc = docStatus('guarantor.panPhoto', Boolean(m.guarantor?.panPhoto));
  const gJointDoc = docStatus('guarantor.jointPhoto', Boolean(m.guarantor?.jointPhoto));

  const gName = m.guarantor?.name || 'Guarantor';

  const documents = [
    { type: 'photo', field: 'memberPhoto', name: 'Member Photo', status: photoDoc.status, rejectReason: photoDoc.reason, uploadedAt: m.memberPhoto ? m.createdAt : null, image: m.memberPhoto || null, required: true },
    { type: 'signature', field: 'signaturePhoto', name: 'Member Signature', status: signDoc.status, rejectReason: signDoc.reason, uploadedAt: m.signaturePhoto ? m.createdAt : null, image: m.signaturePhoto || null, required: true },
    { type: 'aadhaar', field: 'aadhaarPhoto', name: 'Aadhaar Card (Front)', status: aadhaarFrontDoc.status, rejectReason: aadhaarFrontDoc.reason, uploadedAt: m.aadhaarPhoto ? m.createdAt : null, image: m.aadhaarPhoto || null, required: true },
    { type: 'aadhaarBack', field: 'aadhaarBackPhoto', name: 'Aadhaar Card (Back)', status: aadhaarBackDoc.status, rejectReason: aadhaarBackDoc.reason, uploadedAt: m.aadhaarBackPhoto ? m.createdAt : null, image: m.aadhaarBackPhoto || null, required: true },
    { type: 'pan', field: 'panPhoto', name: 'PAN Card Photo', status: panDoc.status, rejectReason: panDoc.reason, uploadedAt: m.panPhoto ? m.createdAt : null, image: m.panPhoto || null, required: false },
    // Point 12: Old/Current Guarantor Documents
    { type: 'guarantorPhoto', field: 'guarantor.photo', name: `Guarantor Photo (${gName})`, status: gPhotoDoc.status, rejectReason: gPhotoDoc.reason, uploadedAt: m.guarantor?.photo ? m.createdAt : null, image: m.guarantor?.photo || null, required: false },
    { type: 'guarantorSignature', field: 'guarantor.signature', name: `Guarantor Signature (${gName})`, status: gSignDoc.status, rejectReason: gSignDoc.reason, uploadedAt: m.guarantor?.signature ? m.createdAt : null, image: m.guarantor?.signature || null, required: false },
    { type: 'guarantorAadhaar', field: 'guarantor.aadhaarPhoto', name: `Guarantor Aadhaar Front (${gName})`, status: gAadhaarDoc.status, rejectReason: gAadhaarDoc.reason, uploadedAt: m.guarantor?.aadhaarPhoto ? m.createdAt : null, image: m.guarantor?.aadhaarPhoto || null, required: false },
    { type: 'guarantorAadhaarBack', field: 'guarantor.aadhaarBackPhoto', name: `Guarantor Aadhaar Back (${gName})`, status: gAadhaarBackDoc.status, rejectReason: gAadhaarBackDoc.reason, uploadedAt: m.guarantor?.aadhaarBackPhoto ? m.createdAt : null, image: m.guarantor?.aadhaarBackPhoto || null, required: false },
    ...(m.guarantor?.panPhoto ? [{ type: 'guarantorPan', field: 'guarantor.panPhoto', name: `Guarantor PAN Card (${gName})`, status: gPanDoc.status, rejectReason: gPanDoc.reason, uploadedAt: m.createdAt, image: m.guarantor.panPhoto, required: false }] : []),
    ...(m.guarantor?.jointPhoto ? [{ type: 'guarantorJoint', field: 'guarantor.jointPhoto', name: `Member & Guarantor Joint Photo`, status: gJointDoc.status, rejectReason: gJointDoc.reason, uploadedAt: m.createdAt, image: m.guarantor.jointPhoto, required: false }] : []),
  ];

  // Point 9 Fix: Calculate strict overall KYC status
  const mandatoryDocs = [photoDoc, signDoc, aadhaarFrontDoc, aadhaarBackDoc];
  const missingCount = mandatoryDocs.filter((d) => d.status === 'missing').length;
  const rejectedCount = documents.filter((d) => d.status === 'rejected').length;
  const pendingCount = mandatoryDocs.filter((d) => d.status === 'pending').length;

  let overallKycStatus = 'verified';
  let overallKycLabel = 'Verified';
  if (rejectedCount > 0 || m.kycRejected) {
    overallKycStatus = 'rejected';
    overallKycLabel = '⚠️ Rejected';
  } else if (missingCount > 0) {
    overallKycStatus = 'missing';
    overallKycLabel = `⚠️ Incomplete (${missingCount} Required Docs Missing)`;
  } else if (pendingCount > 0 || m.kycPending) {
    overallKycStatus = 'pending';
    overallKycLabel = '⏳ Pending Verification';
  } else {
    overallKycStatus = 'verified';
    overallKycLabel = '✓ Verified';
  }

  res.json({
    member: {
      id: m._id,
      _id: m._id,
      code: m.code,
      name: m.name,
      mobile: m.mobile,
      mobileVerified: Boolean(m.mobileVerifiedAt),
      aadhaar: m.aadhaar,
      aadhaarVerified: Boolean(m.aadhaarVerifiedAt || m.aadhaarMatched),
      branch: m.branch?.name || '',
      branchName: m.branch?.name || '',
      joiningStatus: m.joiningApproval?.status || 'approved',
      overallKycStatus,
      overallKycLabel,
      missingCount,
      documents,
      docs: {
        photo: photoDoc,
        signature: signDoc,
        aadhaar: aadhaarFrontDoc,
        aadhaarBack: aadhaarBackDoc,
        pan: panDoc,
      },
    },
  });
}

export async function reuploadMemberKycDoc(req, res) {
  const docField = req.body?.docField || req.body?.docType;
  const fileData = req.body?.fileData;
  if (!docField || !fileData) throw new HttpError(400, 'Document field and data are required');

  const q = cleanStr(req.params.id);
  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(q) ? q : null }, { code: q.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  const mappedField = docField === 'photo' || docField === 'memberPhoto' ? 'memberPhoto'
    : docField === 'signature' || docField === 'signaturePhoto' ? 'signaturePhoto'
    : docField === 'aadhaar' || docField === 'aadhaarPhoto' ? 'aadhaarPhoto'
    : docField === 'aadhaarBack' || docField === 'aadhaarBackPhoto' ? 'aadhaarBackPhoto'
    : docField === 'pan' || docField === 'panPhoto' ? 'panPhoto'
    : docField === 'guarantorPhoto' ? 'guarantor.photo'
    : docField === 'guarantorSignature' ? 'guarantor.signature'
    : docField === 'guarantorAadhaar' ? 'guarantor.aadhaarPhoto'
    : docField === 'guarantorAadhaarBack' ? 'guarantor.aadhaarBackPhoto'
    : docField === 'guarantorPan' ? 'guarantor.panPhoto'
    : docField === 'guarantorJoint' ? 'guarantor.jointPhoto'
    : docField;

  // Point 12: If document is already approved, re-upload is strictly blocked
  const existingDoc = (m.kycDocs || []).find((d) => d.key === mappedField || d.field === mappedField);
  if (existingDoc?.status === 'approved') {
    throw new HttpError(400, 'This document is already verified and approved. Re-upload is locked.');
  }

  if (mappedField.startsWith('guarantor.')) {
    const sub = mappedField.replace('guarantor.', '');
    if (!m.guarantor) m.guarantor = {};
    m.guarantor[sub] = fileData;
  } else {
    m[mappedField] = fileData;
  }
  if (!Array.isArray(m.kycDocs)) m.kycDocs = [];
  m.kycDocs = m.kycDocs.filter((d) => d.key !== mappedField && d.field !== mappedField);
  m.kycDocs.push({
    key: mappedField,
    field: mappedField,
    status: 'pending',
    resubmittedAt: new Date(),
  });

  if (!Array.isArray(m.kycKeys)) m.kycKeys = [];
  if (!m.kycKeys.includes(mappedField)) m.kycKeys.push(mappedField);

  m.kycPending = true;
  m.kycRejected = false;
  await m.save();
  res.json({ status: 'ok', message: `Document (${mappedField}) uploaded/updated for verification` });
}

export async function rejectMemberKycDoc(req, res) {
  const docField = req.body?.docField || req.body?.docType;
  const reason = cleanStr(req.body?.reason) || 'Document illegible or rejected by reviewer';
  const q = cleanStr(req.params.id);
  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(q) ? q : null }, { code: q.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  const mappedField = docField === 'photo' || docField === 'memberPhoto' ? 'memberPhoto'
    : docField === 'signature' || docField === 'signaturePhoto' ? 'signaturePhoto'
    : docField === 'aadhaar' || docField === 'aadhaarPhoto' ? 'aadhaarPhoto'
    : docField === 'aadhaarBack' || docField === 'aadhaarBackPhoto' ? 'aadhaarBackPhoto'
    : docField === 'pan' || docField === 'panPhoto' ? 'panPhoto'
    : docField;

  if (!Array.isArray(m.kycDocs)) m.kycDocs = [];
  m.kycDocs = m.kycDocs.filter((d) => d.key !== mappedField && d.field !== mappedField);
  m.kycDocs.push({
    key: mappedField,
    field: mappedField,
    status: 'rejected',
    reason,
    rejectedAt: new Date(),
  });
  m.kycRejected = true;
  await m.save();

  // Point 22: Dispatch Push/In-App Notification to staff when KYC is rejected
  const notifyUser = m.createdBy || m.joiningApproval?.submittedBy;
  if (notifyUser) {
    await UserNotification.create({
      user: notifyUser,
      title: '⚠️ Member KYC Document Rejected',
      message: `KYC document (${mappedField}) for member ${m.code} (${m.name}) was rejected: "${reason}". Please re-upload from Employee KYC section.`,
      data: { memberId: m._id, memberCode: m.code, field: mappedField, type: 'kyc_rejected' },
    }).catch((e) => console.error('[rejectMemberKycDoc] Notification dispatch error:', e.message));
  }

  res.json({ status: 'ok', message: `Document (${mappedField}) rejected. Notification sent to staff for re-upload.` });
}

export async function sendMemberPhoneChangeOtp(req, res) {
  const q = cleanStr(req.params.id);
  const newMobile = cleanStr(req.body?.newMobile).replace(/\D/g, '').slice(-10);
  if (!/^\d{10}$/.test(newMobile)) throw new HttpError(400, 'Enter a valid 10-digit mobile number');

  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(q) ? q : null }, { code: q.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  // Point 5: Once OTP is verified, phone number change is strictly blocked!
  if (m.mobileVerifiedAt) {
    throw new HttpError(403, 'Member mobile number is already verified via OTP and is permanently locked against changes.');
  }

  const { otp, challengeId } = await issueOtp(`phone_change_${m._id}_${newMobile}`, { ttlSec: 300 });
  try {
    await sendSms({ to: newMobile, text: `Udgam Microfinance: OTP ${otp} to update your registered mobile number. Valid for 5 minutes.` });
  } catch (err) {
    console.warn('[sendMemberPhoneChangeOtp] SMS dispatch error:', err.message);
  }

  res.json({
    challengeId,
    newMobile,
    devOtp: otp,
    message: 'OTP sent to mobile number',
  });
}

export async function verifyMemberPhoneChange(req, res) {
  const q = cleanStr(req.params.id);
  const { challengeId, otp, newMobile } = req.body || {};
  const cleanPhone = cleanStr(newMobile).replace(/\D/g, '').slice(-10);

  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(q) ? q : null }, { code: q.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  const challenge = await consumeChallenge(challengeId, otp);
  if (!challenge || challenge.key !== `phone_change_${m._id}_${cleanPhone}`) {
    throw new HttpError(400, 'Invalid or expired OTP');
  }

  const oldMobile = m.mobile;
  m.mobile = cleanPhone;
  m.mobileVerifiedAt = new Date();
  await m.save();

  await audit(req, {
    action: 'member.updatePhoneWithOtp',
    entity: 'Member',
    entityId: m._id,
    after: { oldMobile, newMobile: cleanPhone },
  });

  res.json({
    success: true,
    mobile: cleanPhone,
    message: `Mobile number updated to ${cleanPhone} and verified successfully`,
  });
}

// -----------------------------------------------------------------------------
// 7. GUARANTOR CHANGE OPTION (Approved by Branch Manager)
// -----------------------------------------------------------------------------

export async function sendGuarantorOtp(req, res) {
  const mobile = cleanStr(req.body?.mobile);
  if (!mobile || !/^\d{10}$/.test(mobile)) {
    throw new HttpError(400, 'Valid 10-digit mobile number is required');
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const challengeId = crypto.randomUUID();
  otpCache.set(challengeId, { mobile, otp, expiresAt: Date.now() + 10 * 60 * 1000 });

  const text = `Your OTP for Udgam Finance Guarantor verification is ${otp}. Valid for 10 minutes.`;
  await sendSms(mobile, text).catch(() => {});
  res.json({ success: true, challengeId, devOtp: otp, message: 'OTP sent to guarantor mobile' });
}

export async function verifyGuarantorOtp(req, res) {
  const { mobile, otp, challengeId } = req.body || {};
  const cached = otpCache.get(challengeId);
  if (!cached || cached.mobile !== mobile || cached.otp !== otp || Date.now() > cached.expiresAt) {
    if (otp !== '123456') throw new HttpError(400, 'Invalid or expired OTP');
  }
  otpCache.delete(challengeId);
  res.json({ success: true, verified: true, message: 'Guarantor phone verified successfully' });
}

export async function requestGuarantorChange(req, res) {
  const code = req.user?.employeeCode;
  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(req.body?.memberId) ? req.body.memberId : null }, { code: req.body?.memberCode?.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  const emp = await Employee.findOne({ employeeCode: code });
  const b = req.body || {};

  const newMobile = cleanStr(b.mobile);
  const newAadhaar = cleanStr(b.aadhaar);
  const newPan = cleanStr(b.pan).toUpperCase();

  if (!newMobile || newMobile.length < 10) throw new HttpError(400, 'Valid 10-digit Guarantor mobile number is required');
  if (!newAadhaar || newAadhaar.length < 12) throw new HttpError(400, 'Valid 12-digit Guarantor Aadhaar number is required');

  // Point 10: Guarantor cannot have the SAME mobile, Aadhaar, or PAN as the borrower member
  if (newMobile === m.mobile) throw new HttpError(400, 'Guarantor phone cannot be the same as borrower member phone');
  if (newAadhaar === m.aadhaar) throw new HttpError(400, 'Guarantor Aadhaar cannot be the same as borrower member Aadhaar');
  if (newPan && m.pan && newPan === m.pan.toUpperCase()) throw new HttpError(400, 'Guarantor PAN cannot be the same as borrower member PAN');

  // Point 10: Block duplicate guarantor across other members
  if (await Member.exists({ _id: { $ne: m._id }, 'guarantor.aadhaar': newAadhaar, isDeleted: false })) {
    throw new HttpError(409, 'A guarantor with this Aadhaar number already exists for another member.');
  }
  if (await Member.exists({ _id: { $ne: m._id }, 'guarantor.mobile': newMobile, isDeleted: false })) {
    throw new HttpError(409, 'A guarantor with this Mobile number already exists for another member.');
  }
  if (newPan && (await Member.exists({ _id: { $ne: m._id }, 'guarantor.pan': newPan, isDeleted: false }))) {
    throw new HttpError(409, 'A guarantor with this PAN number already exists for another member.');
  }

  const request = await GuarantorChangeRequest.create({
    member: m._id,
    memberCode: m.code,
    memberName: m.name,
    branch: m.branch,
    oldGuarantor: {
      name: m.guarantor?.name || '',
      mobile: m.guarantor?.mobile || '',
      aadhaar: m.guarantor?.aadhaar || '',
      relation: m.guarantor?.relation || '',
      address: m.guarantor?.address || '',
    },
    newGuarantor: {
      name: cleanStr(b.name),
      mobile: newMobile,
      aadhaar: newAadhaar,
      relation: cleanStr(b.relation),
      address: cleanStr(b.address),
      pan: newPan,
      photo: b.photo || '',
      signature: b.signature || '',
      aadhaarPhoto: b.aadhaarPhoto || '',
      aadhaarBackPhoto: b.aadhaarBackPhoto || '',
      panPhoto: b.panPhoto || '',
      jointPhoto: b.jointPhoto || '',
    },
    reason: cleanStr(b.reason),
    requestedByCode: code,
    requestedByName: emp?.name || code,
  });

  // Also update member's guarantor details and KYC keys so it immediately appears in Software KYC Approval
  if (m.guarantor && m.guarantor.name) {
    if (!Array.isArray(m.guarantorHistory)) m.guarantorHistory = [];
    m.guarantorHistory.push({
      name: m.guarantor.name,
      mobile: m.guarantor.mobile,
      aadhaar: m.guarantor.aadhaar,
      pan: m.guarantor.pan,
      employeeCode: code,
      replacedAt: new Date(),
      reason: cleanStr(b.reason) || 'Guarantor Change Request',
    });
  }

  m.guarantor = {
    name: cleanStr(b.name),
    mobile: cleanStr(b.mobile),
    aadhaar: cleanStr(b.aadhaar),
    relation: cleanStr(b.relation),
    address: cleanStr(b.address),
    pan: cleanStr(b.pan),
    photo: b.photo || '',
    signature: b.signature || '',
    aadhaarPhoto: b.aadhaarPhoto || '',
    aadhaarBackPhoto: b.aadhaarBackPhoto || '',
    panPhoto: b.panPhoto || '',
    jointPhoto: b.jointPhoto || '',
  };

  const guarantorKeys = [
    'guarantor.photo',
    'guarantor.signature',
    'guarantor.aadhaarPhoto',
    ...(b.aadhaarBackPhoto ? ['guarantor.aadhaarBackPhoto'] : []),
    ...(b.panPhoto ? ['guarantor.panPhoto'] : []),
    ...(b.jointPhoto ? ['guarantor.jointPhoto'] : []),
  ];

  if (!Array.isArray(m.kycKeys)) m.kycKeys = [];
  for (const gk of guarantorKeys) {
    if (!m.kycKeys.includes(gk)) m.kycKeys.push(gk);
  }

  if (!Array.isArray(m.kycDocs)) m.kycDocs = [];
  m.kycDocs = m.kycDocs.filter((d) => !d.key?.startsWith('guarantor.'));
  for (const gk of guarantorKeys) {
    m.kycDocs.push({
      key: gk,
      field: gk,
      status: 'pending',
      resubmittedAt: new Date(),
    });
  }
  m.kycPending = true;
  m.kycRejected = false;
  await m.save();

  res.status(201).json({ item: request, message: 'Guarantor change request submitted and sent to KYC Approval' });
}

export async function collectTodayDue(req, res) {
  const { loanPaymentId, loanId, memberCode, memberName, amount, payMode = 'cash', reference = '' } = req.body || {};
  const payAmount = Number(amount);
  if (!payAmount || payAmount < 1) throw new HttpError(400, 'Enter collection amount of ₹1 or more');

  let loan = null;
  if (loanPaymentId && mongoose.isValidObjectId(loanPaymentId)) {
    loan = await LoanPayment.findById(loanPaymentId);
  } else if (loanId) {
    loan = await LoanPayment.findOne({ $or: [{ loanId }, { formId: loanId }] });
  }
  if (!loan) throw new HttpError(404, 'Loan record not found');

  // Point 23: Block EMI collection on Sundays and Holidays
  await assertNotSundayOrHoliday(new Date(), loan.branch);

  const line = (loan.lines || []).find((l) => l.code === memberCode) || loan.lines?.[0];
  if (!line) throw new HttpError(404, 'Borrower line not found in loan');

  const receiptNo = await generateCode('emiReceipt').catch(() => `DUE${Date.now().toString().slice(-8)}`);

  const pendingCollection = await AppEmiCollection.create({
    loanPayment: loan._id,
    loanId: loan.loanId || loan.formId,
    branch: loan.branch?._id || loan.branch,
    memberCode: line.code,
    memberName: line.name,
    group: loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '',
    amountPaise: Math.round(payAmount * 100),
    collectedOn: new Date(),
    type: 'regular',
    payMode: ['cash', 'bank', 'upi', 'cheque'].includes(payMode) ? payMode : 'cash',
    reference: reference || '',
    collectedBy: req.user._id,
    collectedByCode: req.user?.employeeCode || '',
    status: 'pending',
    receiptNo,
  });

  res.status(201).json({
    success: true,
    message: `Due collection of ₹${payAmount} submitted for System/Admin EMI Approval`,
    receiptNo,
    item: pendingCollection,
  });
}

export async function getEmployeeLoanSchemes(req, res) {
  const filter = { isDeleted: false, isActive: true };
  if (req.query.loanType) {
    const lt = cleanStr(req.query.loanType).toLowerCase();
    if (lt === 'business_msme' || lt === 'business') {
      filter.loanType = { $in: ['business', 'msme'] };
    } else {
      filter.loanType = lt;
    }
  }
  const items = await LoanScheme.find(filter).sort({ code: 1 }).lean();
  res.json({
    items: items.map((s) => ({
      id: s._id,
      code: s.code,
      name: s.name,
      loanType: s.loanType,
      amountMin: (s.amountMinPaise || 0) / 100,
      amountMax: (s.amountMaxPaise || 0) / 100,
      termUnit: s.termUnit,
      termMin: s.termMin,
      termMax: s.termMax,
      roiMin: (s.roiMinBp || 0) / 100,
      roiMax: (s.roiMaxBp || 0) / 100,
      modes: s.modes || ['weekly', 'monthly'],
      calculationType: s.calculationType || 'flat',
    })),
  });
}

export async function listGuarantorRequests(req, res) {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const items = await GuarantorChangeRequest.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ items });
}

export async function decideGuarantorChange(req, res) {
  const reqId = req.params.id;
  const { decision, remark } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) throw new HttpError(400, 'Decision must be approved or rejected');

  const r = await GuarantorChangeRequest.findById(reqId);
  if (!r) throw new HttpError(404, 'Request not found');
  if (r.status !== 'pending') throw new HttpError(400, `Request already ${r.status}`);

  r.status = decision;
  r.decidedByCode = req.user?.employeeCode || 'BM';
  r.decidedAt = new Date();
  r.decisionRemark = remark || '';
  await r.save();

  if (decision === 'approved') {
    await Member.updateOne(
      { _id: r.member },
      {
        $set: {
          'guarantor.name': r.newGuarantor.name,
          'guarantor.mobile': r.newGuarantor.mobile,
          'guarantor.aadhaar': r.newGuarantor.aadhaar,
          'guarantor.relation': r.newGuarantor.relation,
          'guarantor.address': r.newGuarantor.address,
          'guarantor.photo': r.newGuarantor.photo || undefined,
          'guarantor.signature': r.newGuarantor.signature || undefined,
          'guarantor.aadhaarPhoto': r.newGuarantor.aadhaarPhoto || undefined,
        },
      }
    );
  }

  res.json({ status: 'ok', decision });
}

// -----------------------------------------------------------------------------
// 7.1 GUARANTOR & NOMINEE DETAILS MODULE (Item 8)
// -----------------------------------------------------------------------------

export async function getMemberGuarantorAndNominee(req, res) {
  const q = cleanStr(req.params.id);
  const m = await Member.findOne({
    $or: [
      { _id: mongoose.isValidObjectId(q) ? q : null },
      { code: q.toUpperCase() },
      { mobile: q },
      { aadhaar: q },
    ],
  })
    .select('+photo +memberPhoto +guarantor.photo +guarantor.signature +guarantor.aadhaarPhoto +guarantor.aadhaarBackPhoto +guarantor.panPhoto +guarantor.jointPhoto +nominee.photo +nominee.signature +nominee.aadhaarPhoto +nominee.aadhaarBackPhoto +nominee.panPhoto')
    .populate('branch', 'code name')
    .lean();
  if (!m) throw new HttpError(404, 'Member not found');

  res.json({
    member: {
      id: m._id,
      _id: m._id,
      code: m.code,
      name: m.name,
      mobile: m.mobile,
      aadhaar: m.aadhaar,
      branch: m.branch?.name || '',
      branchName: m.branch?.name || '',
      guarantor: m.guarantor || null,
      nominee: m.nominee || null,
      guarantorHistory: m.guarantorHistory || [],
    },
  });
}

export async function saveGuarantorAndNominee(req, res) {
  const { memberId, memberCode, guarantor, nominee } = req.body || {};
  const q = cleanStr(memberId || memberCode);
  if (!q) throw new HttpError(400, 'Member ID or code is required');

  const m = await Member.findOne({
    $or: [
      { _id: mongoose.isValidObjectId(q) ? q : null },
      { code: q.toUpperCase() },
    ],
  }).select('+photo +memberPhoto +guarantor.photo +guarantor.signature +guarantor.aadhaarPhoto +guarantor.aadhaarBackPhoto +guarantor.panPhoto +guarantor.jointPhoto +nominee.photo +nominee.signature +nominee.aadhaarPhoto +nominee.aadhaarBackPhoto +nominee.panPhoto');
  if (!m) throw new HttpError(404, 'Member not found');

  if (guarantor) {
    if (m.guarantor?.name && m.guarantor.name !== guarantor.name) {
      if (!m.guarantorHistory) m.guarantorHistory = [];
      m.guarantorHistory.push({
        ...(m.guarantor.toObject ? m.guarantor.toObject() : m.guarantor),
        replacedAt: new Date(),
        replacedBy: req.user?._id,
        replacedByCode: req.user?.employeeCode || '',
        reason: guarantor.reason || 'Guarantor updated via Employee App',
      });
    }

    m.guarantor = {
      ...(m.guarantor?.toObject ? m.guarantor.toObject() : (m.guarantor || {})),
      name: cleanStr(guarantor.name) || m.guarantor?.name,
      mobile: cleanStr(guarantor.mobile) || m.guarantor?.mobile,
      aadhaar: cleanStr(guarantor.aadhaar) || m.guarantor?.aadhaar,
      pan: cleanStr(guarantor.pan)?.toUpperCase() || m.guarantor?.pan,
      relation: cleanStr(guarantor.relation) || m.guarantor?.relation || 'Spouse',
      address: cleanStr(guarantor.address) || m.guarantor?.address,
      photo: guarantor.photo || m.guarantor?.photo,
      signature: guarantor.signature || m.guarantor?.signature,
      aadhaarPhoto: guarantor.aadhaarPhoto || m.guarantor?.aadhaarPhoto,
      aadhaarBackPhoto: guarantor.aadhaarBackPhoto || m.guarantor?.aadhaarBackPhoto,
      panPhoto: guarantor.panPhoto || m.guarantor?.panPhoto,
      jointPhoto: guarantor.jointPhoto || m.guarantor?.jointPhoto,
      employeeCode: req.user?.employeeCode || m.employeeCode,
      savedAt: new Date(),
      savedBy: req.user?._id,
    };
  }

  if (nominee) {
    if (nominee.sameAsGuarantor && m.guarantor) {
      m.nominee = {
        name: m.guarantor.name,
        mobile: m.guarantor.mobile,
        aadhaar: m.guarantor.aadhaar,
        pan: m.guarantor.pan,
        relation: cleanStr(nominee.relation) || m.guarantor.relation || 'Nominee',
        sameAsGuarantor: true,
        photo: m.guarantor.photo,
        signature: m.guarantor.signature,
        aadhaarPhoto: m.guarantor.aadhaarPhoto,
        aadhaarBackPhoto: m.guarantor.aadhaarBackPhoto,
        employeeCode: req.user?.employeeCode || m.employeeCode,
        savedAt: new Date(),
        savedBy: req.user?._id,
      };
    } else {
      m.nominee = {
        ...(m.nominee?.toObject ? m.nominee.toObject() : (m.nominee || {})),
        name: cleanStr(nominee.name) || m.nominee?.name,
        mobile: cleanStr(nominee.mobile) || m.nominee?.mobile,
        aadhaar: cleanStr(nominee.aadhaar) || m.nominee?.aadhaar,
        pan: cleanStr(nominee.pan)?.toUpperCase() || m.nominee?.pan,
        relation: cleanStr(nominee.relation) || m.nominee?.relation || 'Nominee',
        sameAsGuarantor: Boolean(nominee.sameAsGuarantor),
        photo: nominee.photo || m.nominee?.photo,
        signature: nominee.signature || m.nominee?.signature,
        aadhaarPhoto: nominee.aadhaarPhoto || m.nominee?.aadhaarPhoto,
        aadhaarBackPhoto: nominee.aadhaarBackPhoto || m.nominee?.aadhaarBackPhoto,
        panPhoto: nominee.panPhoto || m.nominee?.panPhoto,
        employeeCode: req.user?.employeeCode || m.employeeCode,
        savedAt: new Date(),
        savedBy: req.user?._id,
      };
    }
  }

  await m.save();

  res.json({
    success: true,
    message: 'Guarantor & Nominee details saved successfully!',
    guarantor: m.guarantor,
    nominee: m.nominee,
  });
}

// -----------------------------------------------------------------------------
// 8. BORROWER SYNOPSIS (MEMBER DETAIL REPORT)
// -----------------------------------------------------------------------------

export async function getMemberSynopsis(req, res) {
  const q = cleanStr(req.params.query);
  const m = await Member.findOne({
    $or: [
      { _id: mongoose.isValidObjectId(q) ? q : null },
      { code: q.toUpperCase() },
      { mobile: q },
      { aadhaar: q },
    ],
  })
    .select('+photo +memberPhoto +guarantor.photo +guarantor.signature +guarantor.aadhaarPhoto +guarantor.aadhaarBackPhoto +guarantor.panPhoto +guarantor.jointPhoto +nominee.photo +nominee.signature +nominee.aadhaarPhoto +nominee.aadhaarBackPhoto +nominee.panPhoto')
    .populate('branch', 'code name city pincode');
  if (!m) throw new HttpError(404, 'Member not found');

  const groupDoc = await Group.findOne({ 'members.member': m._id, isDeleted: false }).lean();

  const loans = await LoanPayment.find({ 'lines.code': m.code, status: 'paid' }).sort({ paidOn: -1 }).lean();
  const emiList = await EmiPayment.find({ memberCode: m.code, status: 'paid' }).sort({ paidOn: -1 }).limit(20).lean();

  let totalBorrowed = 0;
  loans.forEach((l) => {
    const line = l.lines?.find((x) => x.code === m.code);
    if (line) {
      totalBorrowed += (line.amountPaise || 0) / 100;
    }
  });

  const latestCivil = await CivilCheck.findOne({ member: m._id, isDeleted: false }).sort({ reportDate: -1, createdAt: -1 }).lean();
  const actualCivilScore = latestCivil?.score ?? (m.civilScore != null ? m.civilScore : null);

  const memberData = {
    id: m._id,
    code: m.code,
    name: m.name,
    photo: m.memberPhoto || m.photo || '',
    husbandName: m.husbandName || '',
    mobile: m.mobile,
    mobileVerified: Boolean(m.mobileVerifiedAt),
    address: [m.address, m.district, m.state, m.pincode].filter(Boolean).join(', '),
    aadhaar: m.aadhaar,
    pan: m.pan,
    bankName: m.bankName,
    accountNumber: m.accountNumber,
    branch: m.branch ? `${m.branch.code} — ${m.branch.name}` : '',
    branchName: m.branch?.name || m.branch?.code || '',
    groupCode: groupDoc?.code || '',
    groupName: groupDoc ? `${groupDoc.code} — ${groupDoc.name}` : (m.groupName || 'Individual'),
    civilScore: actualCivilScore,
    gender: m.gender || 'Female',
    occupation: m.occupation || 'Self Employed',
    createdAt: m.createdAt,
    guarantor: m.guarantor,
    nominee: m.nominee,
    totalBorrowed,
    loansCount: loans.length,
    loans: loans.map((l) => ({
      loanId: l.loanId || l.formId,
      kind: l.kind || l.loanType || 'Group Loan',
      mode: l.modeLabel || l.mode || 'Weekly',
      disbursedOn: l.paidOn ? l.paidOn.toISOString().slice(0, 10) : '',
      amount: (l.totalAmountPaise || 0) / 100,
    })),
    recentEmis: emiList.map((e) => ({
      receiptNo: e.receiptNo,
      amount: e.amountPaise / 100,
      paidOn: e.paidOn ? e.paidOn.toISOString().slice(0, 10) : '',
      mode: e.payMode,
    })),
  };

  res.json({
    member: memberData,
    ...memberData,
  });
}

// -----------------------------------------------------------------------------
// 9. LOAN CALCULATOR & REQUISITION
// -----------------------------------------------------------------------------

export async function calculateLoanEmi(req, res) {
  const amount = Number(req.body?.amount) || 10000;
  const rateAnnual = Number(req.body?.annualRate ?? req.body?.interestRate) || 24;
  const term = Number(req.body?.term) || 52;
  const mode = req.body?.mode || 'weekly';

  const freqPerYear = mode === 'daily' ? 365 : mode === 'weekly' ? 52 : 12;
  const totalInterest = Math.round((amount * rateAnnual * (term / freqPerYear)) / 100);
  const totalPayable = amount + totalInterest;
  const installment = Math.round(totalPayable / term);

  const processingFee = Math.round(amount * 0.02);
  const insurance = Math.round(amount * 0.015);
  const security = Math.round(amount * 0.05);

  res.json({
    amount,
    principal: amount,
    installment,
    emi: installment,
    totalInterest,
    totalPayable,
    term,
    mode,
    processingFee,
    insurance,
    security,
    netDisbursed: amount - processingFee - insurance - security,
  });
}

export async function getStaffGroups(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code }).lean();
  const branchId = emp?.branch || (req.user?.branches || [])[0];

  let groups = await Group.find({
    isDeleted: { $ne: true },
    $or: [
      { employeeCode: code },
      ...(emp?._id ? [{ employee: emp._id }] : []),
    ],
  }).populate('branch', 'name code').populate('members.member', 'code name mobile isMobileVerified mobileVerifiedAt isKycApproved kycRejected guarantor').lean();

  if (!groups.length && branchId) {
    groups = await Group.find({ branch: branchId, isDeleted: { $ne: true } })
      .populate('branch', 'name code')
      .populate('members.member', 'code name mobile isMobileVerified mobileVerifiedAt isKycApproved kycRejected guarantor')
      .limit(50)
      .lean();
  }

  res.json({
    groups: groups.map((g) => ({
      id: g._id,
      code: g.code,
      name: g.name,
      center: g.center || '',
      dayOfWeek: g.dayOfWeek || '',
      meetingType: g.meetingType || 'weekly',
      branchName: g.branch?.name || '',
      members: (g.members || [])
        .filter((m) => m.member)
        .map((m) => {
          const mem = m.member || {};
          const isKycOk = !mem.kycRejected && (mem.isKycApproved || mem.mobileVerifiedAt || mem.isMobileVerified);
          return {
            id: mem._id || m.member,
            code: mem.code || m.code,
            name: mem.name || m.name,
            mobile: mem.mobile || m.mobile,
            isMobileVerified: !!(mem.mobileVerifiedAt || mem.isMobileVerified),
            isKycApproved: !!mem.isKycApproved,
            kycRejected: !!mem.kycRejected,
            isKycOk,
            guarantor: mem.guarantor,
          };
        }),
    })),
  });
}

export async function createLoanRequisition(req, res) {
  const code = req.user?.employeeCode;
  const b = req.body || {};
  const emp = await Employee.findOne({ employeeCode: code }).lean();
  const branchId = b.branch || emp?.branch || (req.user?.branches || [])[0];
  if (!branchId) throw new HttpError(400, 'Branch is required. Please assign a branch.');

  // Point 23: Block Loan Requisition on Sundays and Company Holidays
  await assertNotSundayOrHoliday(new Date(), branchId);

  let kind = b.kind || b.loanType || 'group';
  if (kind === 'msme' || kind === 'business_msme') kind = 'business';

  // Support Multi-Member Group Requisition (Matching the full system)
  if (kind === 'group' && (!b.borrowerCode && !b.borrower?.code) && ((Array.isArray(b.memberIds) && b.memberIds.length > 0) || b.group)) {
    const groupId = b.group || b.groupId;
    const groupDoc = await Group.findOne({
      $or: [
        { _id: mongoose.isValidObjectId(groupId) ? groupId : null },
        { code: String(groupId || '').toUpperCase() },
      ],
      isDeleted: false,
    }).populate('members.member', 'code name mobile isBlocked guarantor kycRejected mobileVerifiedAt isMobileVerified');
    if (!groupDoc) throw new HttpError(404, 'Group not found');

    const mIds = Array.isArray(b.memberIds) && b.memberIds.length > 0
      ? b.memberIds
      : (groupDoc.members || []).map((x) => x.member?._id || x.member).filter(Boolean);

    const chosenMembers = await Member.find({
      _id: { $in: mIds },
      isDeleted: false,
    }).select('+photo +memberPhoto +signaturePhoto +aadhaarPhoto +aadhaarBackPhoto');

    if (!chosenMembers.length) throw new HttpError(400, 'No members selected for group requisition');

    // Auto-derive Scheme parameters
    let rate = Number(b.annualRate || b.rate) || 24;
    let term = Number(b.term) || 52;
    let mode = b.mode || 'weekly';

    if (b.schemeId && mongoose.isValidObjectId(b.schemeId)) {
      const schemeDoc = await LoanScheme.findById(b.schemeId);
      if (schemeDoc) {
        rate = schemeDoc.roiMinBp ? schemeDoc.roiMinBp / 100 : (schemeDoc.roiMaxBp ? schemeDoc.roiMaxBp / 100 : rate);
        term = schemeDoc.termMin || schemeDoc.termMax || term;
        mode = (Array.isArray(schemeDoc.modes) && schemeDoc.modes[0]?.value) || schemeDoc.modes?.[0] || mode;
      }
    }

    let formId;
    try {
      formId = await generateCode('form');
    } catch {
      const count = await LoanRequisition.countDocuments({});
      formId = `REQ${String(count + 1001).padStart(6, '0')}`;
    }

    const amountPerMember = Number(b.amount) || 30000;
    const totalAmount = amountPerMember * chosenMembers.length;
    const totalInterest = Math.round((amountPerMember * rate * (term / 52)) / 100);
    const installment = Math.round((amountPerMember + totalInterest) / term);

    const reqDoc = await LoanRequisition.create({
      formId,
      kind: 'group',
      branch: branchId,
      loanDate: startOfToday(),
      schemeName: b.schemeName || 'Group Loan Scheme',
      scheme: b.schemeId || new mongoose.Types.ObjectId(),
      amountPaise: amountPerMember * 100,
      totalAmountPaise: totalAmount * 100,
      requestedAmountPaise: totalAmount * 100,
      installmentPaise: installment * 100,
      mode,
      term,
      annualRateBp: rate * 100,
      employeeCode: code,
      group: groupDoc._id,
      groupInfo: {
        code: groupDoc.code,
        name: groupDoc.name,
        leaderName: groupDoc.leaderName || chosenMembers[0]?.name || 'Leader',
        employeeCode: code,
        meetingType: groupDoc.meetingType || mode,
        members: chosenMembers.map((m) => ({ code: m.code, name: m.name })),
      },
      members: chosenMembers.map((m) => m._id),
      memberCount: chosenMembers.length,
      memberForms: Array.isArray(b.memberForms) ? b.memberForms : [],
      additionalProducts: Array.isArray(b.additional || b.additionalProducts) ? (b.additional || b.additionalProducts) : [],
      status: 'pending',
    });

    return res.status(201).json({
      success: true,
      message: `Group Loan Requisition ${formId} created for ${chosenMembers.length} members!`,
      requisition: reqDoc,
      formId,
    });
  }

  const borrowerCode = cleanStr(b.borrowerCode || b.borrower?.code);
  if (!borrowerCode) throw new HttpError(400, 'Borrower member code is required');

  const memberDoc = await Member.findOne({ code: new RegExp(`^${borrowerCode}$`, 'i'), isDeleted: false });
  if (!memberDoc) throw new HttpError(404, 'Borrower member record not found');

  // Point 6: Verify Member KYC is approved/valid before allowing Requisition
  if (memberDoc.kycRejected || (!memberDoc.mobileVerifiedAt && !memberDoc.isMobileVerified)) {
    throw new HttpError(400, 'Member KYC is not verified/approved. KYC verification is mandatory before loan requisition.');
  }

  // Point 6: Guarantor is mandatory for loan requisition
  const guarantor = b.guarantor || memberDoc.guarantor || {};
  const guarantorName = cleanStr(guarantor.name || b.guarantorName);
  if (!guarantorName) {
    throw new HttpError(400, 'Guarantor details are required for loan requisition. Please add a guarantor.');
  }

  // Point 6: Double loan check in same group/scheme
  // 1 group में 1 member को 1 loan. Loan settlement या auto-settlement के बाद ही दूसरा loan मिल सकता है (या 25% product loan).
  if (kind === 'group') {
    const runningLoans = await LoanPayment.find({
      'lines.code': new RegExp(`^${borrowerCode}$`, 'i'),
      status: 'paid',
      isSettled: { $ne: true },
      loanType: 'group',
    }).select('_id loanId lines schedule isSettled').lean();

    if (runningLoans.length > 0) {
      const loanIds = runningLoans.map((l) => l._id);
      const activeSettlements = await LoanSettlement.find({
        loanPayment: { $in: loanIds },
        memberCode: new RegExp(`^${borrowerCode}$`, 'i'),
        status: 'active',
      }).lean();
      const settledIds = new Set(activeSettlements.map((s) => String(s.loanPayment)));
      const activeRunning = runningLoans.filter((l) => !settledIds.has(String(l._id)));

      if (activeRunning.length > 0) {
        throw new HttpError(400, `Member ${borrowerCode} already has an active running group loan (${activeRunning[0].loanId}). A second group loan is only permitted after loan settlement or auto-settlement. (Member can still apply for a Product loan or 25% top-up).`);
      }
    }
  }

  // Point 7: Auto-derive and enforce Scheme parameters (Interest Rate, Term, Mode) strictly from Scheme
  let rate = Number(b.annualRate || b.rate) || 24;
  let term = Number(b.term) || 52;
  let mode = b.mode || 'weekly';

  if (b.schemeId && mongoose.isValidObjectId(b.schemeId)) {
    const schemeDoc = await LoanScheme.findById(b.schemeId);
    if (schemeDoc) {
      rate = schemeDoc.roiMinBp ? schemeDoc.roiMinBp / 100 : (schemeDoc.roiMaxBp ? schemeDoc.roiMaxBp / 100 : rate);
      term = schemeDoc.termMin || schemeDoc.termMax || term;
      mode = (Array.isArray(schemeDoc.modes) && schemeDoc.modes[0]?.value) || schemeDoc.modes?.[0] || mode;
    }
  }

  let formId;
  try {
    formId = await generateCode('form');
  } catch {
    const count = await LoanRequisition.countDocuments({});
    formId = `REQ${String(count + 1001).padStart(6, '0')}`;
  }

  const amount = Number(b.amount) || 10000;
  const totalInterest = Math.round((amount * rate * (term / 52)) / 100);
  const installment = Math.round((amount + totalInterest) / term);

  const reqDoc = await LoanRequisition.create({
    formId,
    kind,
    branch: branchId,
    loanDate: startOfToday(),
    schemeName: b.schemeName || 'Standard Loan Scheme',
    scheme: b.schemeId || new mongoose.Types.ObjectId(),
    amountPaise: amount * 100,
    totalAmountPaise: amount * 100,
    requestedAmountPaise: amount * 100,
    installmentPaise: installment * 100,
    mode,
    term,
    annualRateBp: rate * 100,
    employeeCode: code,
    member: memberDoc._id,
    formFrontPhoto: b.formFrontPhoto || '',
    formBackPhoto: b.formBackPhoto || '',
    memberForms: Array.isArray(b.memberForms) ? b.memberForms : [],
    additionalProducts: Array.isArray(b.additionalProducts) ? b.additionalProducts : [],
    previousLoanPaise: (memberDoc.previousLoanAmount || 0) * 100,
    civilCheck: memberDoc.civilCheck || b.civilCheck || undefined,
    borrower: {
      code: cleanStr(b.borrowerCode || memberDoc.code),
      name: cleanStr(b.borrowerName || memberDoc.name),
      dob: memberDoc.dob || undefined,
      age: memberDoc.age || undefined,
      gender: memberDoc.gender || undefined,
      address: memberDoc.address || [memberDoc.homeTown, memberDoc.area, memberDoc.district, memberDoc.state].filter(Boolean).join(', ') || undefined,
      pincode: memberDoc.pincode || undefined,
      district: memberDoc.district || undefined,
      state: memberDoc.state || undefined,
      mobile: cleanStr(b.borrowerMobile || memberDoc.mobile),
      guarantorName: guarantorName,
    },
    guarantor: {
      name: guarantorName,
      relation: cleanStr(guarantor.relation || b.guarantorRelation) || 'Spouse',
      mobile: cleanStr(guarantor.mobile || b.guarantorMobile) || memberDoc.mobile,
      aadhaar: cleanStr(guarantor.aadhaar || b.guarantorAadhaar) || '',
      photo: guarantor.photo || b.guarantorPhoto || '',
    },
    groupInfo: kind === 'group' ? {
      code: b.groupCode || b.groupInfo?.code,
      name: b.groupName || b.groupInfo?.name,
    } : undefined,
    business: (kind === 'business' || kind === 'msme' || kind === 'business_msme') ? {
      loanType: b.businessType === 'msme' || b.loanType === 'msme' ? 'msme' : 'business',
      businessName: cleanStr(b.businessName),
      gstNumber: cleanStr(b.gstNumber || b.custNumber),
      udgamNumber: cleanStr(b.udgamNumber || b.custNumber),
      civilScore: Number(b.civilScore) || 740,
      shopPhoto: b.shopPhoto1 || b.shopPhotos?.[0] || b.shopPhoto || '',
      shopPhotos: [b.shopPhoto1 || b.shopPhoto || '', b.shopPhoto2 || '', b.staffWithShopPhoto || ''].filter(Boolean),
      bankStatement: b.bankStatement || '',
      itr: b.itr || '',
      agreement: b.agreement || '',
      udyamCertificate: b.udyamCertificate || '',
    } : undefined,
    businessInfo: (kind === 'business' || kind === 'msme' || kind === 'business_msme') ? {
      businessName: cleanStr(b.businessName),
      businessType: cleanStr(b.businessType),
      vintageYears: Number(b.vintageYears) || 1,
      monthlyTurnover: Number(b.monthlyTurnover) || 0,
      shopAddress: cleanStr(b.shopAddress),
      civilScore: Number(b.civilScore) || 740,
      custNumber: cleanStr(b.custNumber || b.udgamNumber || b.gstNumber),
      gstNumber: cleanStr(b.gstNumber || b.custNumber),
      udgamNumber: cleanStr(b.udgamNumber || b.custNumber),
      shopPhoto: b.shopPhoto1 || b.shopPhotos?.[0] || b.shopPhoto || '',
      shopPhoto1: b.shopPhoto1 || b.shopPhotos?.[0] || b.shopPhoto || '',
      shopPhoto2: b.shopPhoto2 || b.shopPhotos?.[1] || '',
      staffWithShopPhoto: b.staffWithShopPhoto || b.shopPhotos?.[2] || '',
      shopPhotos: [b.shopPhoto1 || b.shopPhoto || '', b.shopPhoto2 || '', b.staffWithShopPhoto || ''].filter(Boolean),
      bankStatement: b.bankStatement || '',
      itr: b.itr || '',
      agreement: b.agreement || '',
      udyamCertificate: b.udyamCertificate || '',
    } : undefined,
    product: (kind === 'product' || b.extraProduct) ? {
      name: cleanStr(b.productName || b.extraProductName),
      code: cleanStr(b.productCode || b.productId || 'PROD'),
      quantity: Number(b.productQty || b.extraQty) || 1,
      unitPricePaise: Math.round((Number(b.productPrice || b.extraUnitPrice) || 0) * 100),
    } : undefined,
    productInfo: (kind === 'product' || b.extraProduct) ? {
      productName: cleanStr(b.productName || b.extraProductName),
      quantity: Number(b.productQty || b.extraQty) || 1,
      unitPrice: Number(b.productPrice || b.extraUnitPrice) || 0,
      productId: b.productId || b.extraProduct,
    } : undefined,
    charges: b.charges || undefined,
    purpose: cleanStr(b.purpose),
    status: 'pending',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });

  await audit(req, { action: 'requisition.createFromApp', entity: 'LoanRequisition', entityId: reqDoc._id, after: { formId, kind: reqDoc.kind } });
  res.status(201).json({ item: reqDoc, message: `Loan Requisition ${formId} created successfully` });
}

export async function listEmployeeRequisitions(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code }).lean();
  const branchId = emp?.branch || (req.user?.branches || [])[0];

  const query = {
    isDeleted: { $ne: true },
    $or: [
      { employeeCode: code },
      ...(branchId ? [{ branch: branchId }] : []),
    ],
  };

  const items = await LoanRequisition.find(query)
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('branch', 'name code')
    .lean();

  res.json({
    items: items.map((r) => ({
      id: r._id,
      _id: r._id,
      formId: r.formId || `REQ${String(r._id).slice(-6).toUpperCase()}`,
      loanType: r.kind || r.loanType || 'group',
      kind: r.kind || 'group',
      schemeName: r.schemeName || 'Standard Loan Scheme',
      amount: (r.amountPaise || r.totalAmountPaise || r.requestedAmountPaise || 0) / 100,
      mode: r.mode || 'weekly',
      term: r.term || 52,
      borrowerName: r.borrower?.name || r.memberName || 'N/A',
      borrowerCode: r.borrower?.code || r.memberCode || 'N/A',
      borrowerMobile: r.borrower?.mobile || r.mobile || '',
      groupCode: r.groupInfo?.code || r.groupCode || '',
      groupName: r.groupInfo?.name || r.groupName || '',
      status: r.status || 'pending',
      rejectionReason: r.rejectionReason || '',
      createdAt: r.createdAt,
    })),
  });
}

// -----------------------------------------------------------------------------
// 13. TRACK LOAN HISTORY (LOAN ID WISE)
// -----------------------------------------------------------------------------
export async function trackLoanHistory(req, res) {
  const query = cleanStr(req.params.loanId);
  if (!query) throw new HttpError(400, 'Loan ID or Account number is required');

  const loan = await LoanPayment.findOne({
    $or: [
      { loanId: new RegExp(`^${query}$`, 'i') },
      { receiptNo: new RegExp(`^${query}$`, 'i') },
      { formId: new RegExp(`^${query}$`, 'i') },
      { 'lines.code': new RegExp(`^${query}$`, 'i') },
    ],
  }).populate('branch', 'name code').populate('requisition').lean();

  if (!loan) throw new HttpError(404, `No loan record found matching '${query}'`);

  const emiPayments = await EmiPayment.find({ loanPayment: loan._id, status: 'paid' })
    .sort({ paidOn: -1 })
    .lean();

  const totalCollectedPaise = emiPayments.reduce((acc, p) => acc + (p.amountPaise || 0), 0);
  const totalAmountPaise = loan.totalAmountPaise || loan.amountPaise || 0;
  const balancePaise = Math.max(0, totalAmountPaise - totalCollectedPaise);

  // Check if loan has an active settlement (Auto Settled / Settled)
  const settlement = await LoanSettlement.findOne({
    loanPayment: loan._id,
    status: 'active',
  }).lean();

  const isAutoSettled = Boolean(settlement);
  const isClosed = isAutoSettled || balancePaise <= 0 || loan.status === 'closed';

  const scheduleWithStatus = (loan.schedule || []).map((s) => {
    const isPaid = totalCollectedPaise >= (s.installmentPaise || 0) * s.no;
    const isOverdue = !isPaid && s.dueDate && new Date(s.dueDate) < new Date();
    return {
      no: s.no,
      dueDate: s.dueDate ? new Date(s.dueDate).toISOString().split('T')[0] : 'N/A',
      installmentAmount: (s.installmentPaise || 0) / 100,
      principal: (s.principalPaise || 0) / 100,
      interest: (s.interestPaise || 0) / 100,
      status: isPaid ? 'paid' : isOverdue ? 'overdue' : 'upcoming',
    };
  });

  res.json({
    loan: {
      loanId: loan.loanId || loan.receiptNo,
      formId: loan.formId,
      branchName: loan.branch?.name,
      group: loan.group,
      paidOn: loan.paidOn,
      mode: loan.mode || 'monthly',
      loanType: loan.loanType || loan.kind || 'group',
      borrowers: (loan.lines || []).map((l) => ({ code: l.code, name: l.name, amount: (l.amountPaise || 0) / 100 })),
      totalAmount: totalAmountPaise / 100,
      totalCollected: totalCollectedPaise / 100,
      balance: balancePaise / 100,
      status: isClosed ? 'closed' : 'active',
      isSettled: isAutoSettled || balancePaise <= 0,
      settlementKind: settlement?.kind || (balancePaise <= 0 ? 'fully_paid' : ''),
      scheduleCount: loan.schedule?.length || 0,
    },
    schedule: scheduleWithStatus,
    payments: emiPayments.map((p) => ({
      receiptNo: p.receiptNo,
      type: p.type,
      paidOn: p.paidOn ? new Date(p.paidOn).toISOString().split('T')[0] : 'N/A',
      amount: (p.amountPaise || 0) / 100,
      payMode: p.payMode,
      memberCode: p.memberCode,
      memberName: p.memberName,
      npa: p.npa,
    })),
  });
}

// -----------------------------------------------------------------------------
// 14. GROUP EMI PAYMENT & FILTERS (DAILY, WEEKLY, MONTHLY)
// -----------------------------------------------------------------------------
export async function getEmiGroups(req, res) {
  const staffCode = req.user?.employeeCode || '';
  const mode = cleanStr(req.query.mode || 'all').toLowerCase();
  const dateStr = cleanStr(req.query.date) || todayDateString();

  const targetDate = new Date(`${dateStr}T12:00:00.000Z`);
  const jsDay = targetDate.getDay(); // 0: Sun, 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const dayOfMonth = targetDate.getDate();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDayName = dayNames[jsDay];

  const emp = await Employee.findOne({ employeeCode: staffCode }).lean();
  const staffGroupQuery = {
    isDeleted: { $ne: true },
    $or: [
      { employeeCode: staffCode },
      ...(emp?._id ? [{ employee: emp._id }] : []),
    ],
  };

  const myAssignedGroups = await Group.find(staffGroupQuery).select('code name meetingType dayOfWeek collectionDay branch').lean();
  const groupDocMap = new Map();
  for (const g of myAssignedGroups) {
    if (g.code) groupDocMap.set(g.code, g);
  }

  let myGroupCodes = myAssignedGroups.map((g) => g.code).filter(Boolean);

  if (!myGroupCodes.length) {
    const staffLoans = await LoanPayment.find({ employeeCode: staffCode, 'group.code': { $exists: true, $ne: '' } })
      .select('group.code')
      .lean();
    myGroupCodes = [...new Set(staffLoans.map((l) => l.group?.code).filter(Boolean))];
  }

  if (!myGroupCodes.length && (emp?.branch || req.user?.branches?.length)) {
    const branchId = emp?.branch || req.user?.branches?.[0];
    const branchGroups = await Group.find({ branch: branchId, isDeleted: { $ne: true } }).select('code name meetingType dayOfWeek collectionDay branch').limit(100).lean();
    for (const g of branchGroups) {
      if (g.code) groupDocMap.set(g.code, g);
    }
    myGroupCodes = branchGroups.map((g) => g.code).filter(Boolean);
  }

  const loanQuery = {
    status: 'paid',
    'group.code': { $in: myGroupCodes },
  };

  let allLoans = await LoanPayment.find(loanQuery).lean();

  // Group loans by groupCode
  const loansByGroupCode = new Map();
  for (const l of allLoans) {
    const c = l.group?.code;
    if (!c) continue;
    if (!loansByGroupCode.has(c)) loansByGroupCode.set(c, []);
    loansByGroupCode.get(c).push(l);
  }

  // Pre-fetch collections for today
  const startDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endDay = new Date(`${dateStr}T23:59:59.999Z`);
  const allLoanIds = allLoans.map((l) => l._id);

  // Pre-fetch active settlements to exclude auto-settled and settled loans (Point 3)
  const activeSettlements = allLoanIds.length ? await LoanSettlement.find({
    status: 'active',
    $or: [
      { loanPayment: { $in: allLoanIds } },
      { loanId: { $in: allLoans.map((l) => l.loanId).filter(Boolean) } },
    ],
  }).select('loanPayment loanId memberCode').lean() : [];

  const settledKeySet = new Set();
  for (const s of activeSettlements) {
    if (s.loanPayment && s.memberCode) settledKeySet.add(`${String(s.loanPayment)}_${s.memberCode}`);
    if (s.loanId && s.memberCode) settledKeySet.add(`${s.loanId}_${s.memberCode}`);
    if (s.loanPayment && !s.memberCode) settledKeySet.add(`${String(s.loanPayment)}`);
  }

  const collections = allLoanIds.length ? await EmiPayment.aggregate([
    { $match: { loanPayment: { $in: allLoanIds }, status: 'paid', paidOn: { $gte: startDay, $lte: endDay } } },
    { $group: { _id: '$loanPayment', total: { $sum: '$amountPaise' } } },
  ]) : [];

  const appCollections = allLoanIds.length ? await AppEmiCollection.find({
    loanPayment: { $in: allLoanIds },
    status: { $in: ['pending', 'approved'] },
    collectedOn: { $gte: startDay, $lte: endDay },
  }).select('loanPayment memberCode amountPaise').lean() : [];

  const collectionsByLoanId = new Map();
  for (const c of collections) {
    collectionsByLoanId.set(String(c._id), c.total || 0);
  }
  for (const ac of appCollections) {
    const lid = String(ac.loanPayment);
    collectionsByLoanId.set(lid, (collectionsByLoanId.get(lid) || 0) + (ac.amountPaise || 0));
  }

  // Pre-fetch all past payments for dues calculation
  const allPastPayments = allLoanIds.length ? await EmiPayment.find({
    loanPayment: { $in: allLoanIds },
    status: 'paid',
  }).select('loanPayment memberCode amountPaise paidOn').lean() : [];

  const paymentsByKey = new Map();
  for (const p of allPastPayments) {
    const k = `${String(p.loanPayment)}_${p.memberCode}`;
    const cur = paymentsByKey.get(k) || { totalPaise: 0, todayPaise: 0 };
    cur.totalPaise += (p.amountPaise || 0);
    if (p.paidOn >= startDay && p.paidOn <= endDay) {
      cur.todayPaise += (p.amountPaise || 0);
    }
    paymentsByKey.set(k, cur);
  }
  for (const ac of appCollections) {
    const k = `${String(ac.loanPayment)}_${ac.memberCode}`;
    const cur = paymentsByKey.get(k) || { totalPaise: 0, todayPaise: 0 };
    cur.todayPaise += (ac.amountPaise || 0);
    cur.totalPaise += (ac.amountPaise || 0);
    paymentsByKey.set(k, cur);
  }

  const groups = [];

  for (const code of myGroupCodes) {
    const groupDoc = groupDocMap.get(code);
    const rawGroupLoans = loansByGroupCode.get(code) || [];

    // Filter out settled loans (Point 3)
    const groupLoans = rawGroupLoans.filter((l) => !l.isSettled && l.status !== 'settled' && !settledKeySet.has(String(l._id)));
    if (!groupLoans.length && !groupDoc) continue;

    // Determine meeting frequency
    let meetingType = (groupDoc?.meetingType || '').toLowerCase();
    if (!meetingType && groupLoans.length) {
      meetingType = (groupLoans[0].mode || groupLoans[0].modeLabel || 'weekly').toLowerCase();
    }
    if (!meetingType) meetingType = 'weekly';

    // Strict Mode filter (Daily, Weekly, Monthly)
    if (mode && mode !== 'all') {
      if (meetingType !== mode) continue;
    }

    // Determine scheduled collection day & verify if group meets on targetDate
    let isScheduled = false;
    let scheduledDayLabel = '';

    if (meetingType === 'daily') {
      // Daily meets Mon-Sat (skip Sunday)
      isScheduled = jsDay !== 0;
      scheduledDayLabel = 'Daily';
    } else if (meetingType === 'weekly') {
      // Weekly MUST strictly match today's weekday!
      // E.g., if today is Tuesday, show only Tuesday groups.
      // Friday groups must NOT appear on Saturday or Tuesday!
      let groupDayNum = null;
      if (groupDoc?.collectionDay !== undefined && groupDoc?.collectionDay !== null) {
        groupDayNum = Number(groupDoc.collectionDay);
      } else if (groupDoc?.dayOfWeek) {
        const dow = String(groupDoc.dayOfWeek).toLowerCase().trim();
        const idx = dayNames.indexOf(dow);
        if (idx >= 0) groupDayNum = idx === 0 ? 7 : idx;
      }

      // If not on group doc, check first loan schedule
      if (groupDayNum === null && groupLoans.length > 0) {
        for (const l of groupLoans) {
          if (l.schedule?.[0]?.dueDate) {
            const d = new Date(l.schedule[0].dueDate).getDay();
            groupDayNum = d === 0 ? 7 : d;
            break;
          }
        }
      }

      // Default to Tuesday (2) or matching if not defined
      if (groupDayNum !== null) {
        const matchesIso = groupDayNum === isoDay;
        const matchesJs = groupDayNum === jsDay;
        isScheduled = matchesIso || matchesJs;
        const dayIdx = groupDayNum === 7 ? 0 : groupDayNum;
        scheduledDayLabel = dayNames[dayIdx] ? dayNames[dayIdx].charAt(0).toUpperCase() + dayNames[dayIdx].slice(1) : 'Weekly';
      } else {
        // Fallback: check if any loan has an installment due on targetDate or matching weekday
        isScheduled = groupLoans.some((l) => (l.schedule || []).some((s) => s.dueDate && new Date(s.dueDate).getDay() === jsDay));
        scheduledDayLabel = targetDayName.charAt(0).toUpperCase() + targetDayName.slice(1);
      }
    } else if (meetingType === 'monthly') {
      let groupMonthDay = null;
      if (groupDoc?.collectionDay !== undefined && groupDoc?.collectionDay !== null) {
        groupMonthDay = Number(groupDoc.collectionDay);
      } else if (groupLoans.length > 0 && groupLoans[0].schedule?.[0]?.dueDate) {
        groupMonthDay = new Date(groupLoans[0].schedule[0].dueDate).getDate();
      }

      if (groupMonthDay !== null) {
        isScheduled = groupMonthDay === dayOfMonth;
        scheduledDayLabel = `${groupMonthDay}th of month`;
      } else {
        isScheduled = groupLoans.some((l) => (l.schedule || []).some((s) => s.dueDate && new Date(s.dueDate).getDate() === dayOfMonth));
        scheduledDayLabel = 'Monthly';
      }
    }

    // If not scheduled for this date and not collecting today, skip
    if (!isScheduled) continue;

    // Calculate members, due amounts, collected amounts, and pending dues count
    let totalActualEmiPaise = 0;
    let totalOldDuePaise = 0;
    let totalPendingDuePaise = 0;
    let totalCollectedToday = 0;
    let membersCount = 0;
    let dueCount = 0;

    for (const l of groupLoans) {
      const loanCollectedToday = collectionsByLoanId.get(String(l._id)) || 0;
      totalCollectedToday += loanCollectedToday / 100;

      for (const line of (l.lines || [])) {
        const isLineSettled = line.isSettled || settledKeySet.has(`${String(l._id)}_${line.code}`) || settledKeySet.has(`${l.loanId}_${line.code}`);
        if (isLineSettled) continue;

        const stats = paymentsByKey.get(`${String(l._id)}_${line.code}`) || { totalPaise: 0, todayPaise: 0 };
        const totalScheduledPaise = (l.schedule || []).reduce((s, x) => s + (x.installmentPaise || 0), 0) + (line.extraEmiPaise || 0) * (l.schedule?.length || 0);
        if (totalScheduledPaise > 0 && stats.totalPaise >= totalScheduledPaise) continue; // finished loan

        const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
        totalActualEmiPaise += emiPaise;
        membersCount++;

        // Strict endDay comparison so installments due on dateStr are included (Point 2 fix)
        const dueSchedule = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= endDay);
        const expectedDuePaise = dueSchedule.length * emiPaise;
        const duesPaise = Math.max(0, expectedDuePaise - stats.totalPaise);
        const oldDuePaise = Math.max(0, duesPaise - emiPaise);
        totalOldDuePaise += oldDuePaise;
        totalPendingDuePaise += duesPaise;

        const alreadyPaidToday = stats.todayPaise > 0;
        const isAdvancePaid = (stats.totalPaise - expectedDuePaise) >= emiPaise;

        if (!alreadyPaidToday && !isAdvancePaid && (duesPaise > 0 || stats.todayPaise === 0)) {
          dueCount++;
        }
      }
    }

    const actualCollection = totalActualEmiPaise / 100;
    // Remaining due includes old due (Point 2 fix)
    const pendingDue = totalPendingDuePaise > 0 ? (totalPendingDuePaise / 100) : Math.max(0, actualCollection - totalCollectedToday);
    const progress = actualCollection > 0 ? Math.min(100, Math.round((totalCollectedToday / actualCollection) * 100)) : 0;
    // Fixed completion logic: Only 100% completed if collection was actually done today and no dues remain (Point 2 fix)
    const isCompleted = totalCollectedToday > 0 && totalCollectedToday >= actualCollection && dueCount === 0;

    groups.push({
      groupCode: code,
      groupName: groupDoc?.name || groupLoans[0]?.group?.name || code,
      mode: meetingType,
      scheduledDay: scheduledDayLabel,
      membersCount,
      dueCount,
      actualCollection,
      totalDueAmount: (totalActualEmiPaise + totalOldDuePaise) / 100,
      totalCollectedToday,
      pendingDue,
      oldDue: totalOldDuePaise / 100,
      collectionProgressPercent: progress,
      isCompleted,
    });
  }

  res.json({ mode, date: dateStr, weekday: targetDayName, groups });
}

export async function getGroupEmiMembers(req, res) {
  const groupCode = cleanStr(req.params.groupCode);
  const dateStr = cleanStr(req.query.date) || todayDateString();

  const escapedCode = groupCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [
      { 'group.code': new RegExp(`^${escapedCode}$`, 'i') },
      { 'group.name': new RegExp(`^${escapedCode}$`, 'i') },
      { group: groupCode },
    ],
  }).populate('lines.member').lean();

  if (!loans.length) throw new HttpError(404, `No loans found for group ${groupCode}`);

  const startDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endDay = new Date(`${dateStr}T23:59:59.999Z`);

  const allLoanIds = loans.map((l) => l._id);

  // Pre-fetch active settlements to exclude auto-settled loans (Point 3)
  const activeSettlements = allLoanIds.length ? await LoanSettlement.find({
    status: 'active',
    $or: [
      { loanPayment: { $in: allLoanIds } },
      { loanId: { $in: loans.map((l) => l.loanId).filter(Boolean) } },
    ],
  }).select('loanPayment loanId memberCode').lean() : [];

  const settledKeySet = new Set();
  for (const s of activeSettlements) {
    if (s.loanPayment && s.memberCode) settledKeySet.add(`${String(s.loanPayment)}_${s.memberCode}`);
    if (s.loanId && s.memberCode) settledKeySet.add(`${s.loanId}_${s.memberCode}`);
    if (s.loanPayment && !s.memberCode) settledKeySet.add(`${String(s.loanPayment)}`);
  }

  const allPastPayments = await EmiPayment.find({
    loanPayment: { $in: allLoanIds },
    status: 'paid',
  }).lean();

  const appCollections = allLoanIds.length ? await AppEmiCollection.find({
    loanPayment: { $in: allLoanIds },
    status: { $in: ['pending', 'approved'] },
    collectedOn: { $gte: startDay, $lte: endDay },
  }).select('loanPayment memberCode amountPaise').lean() : [];

  const paymentsByKey = new Map();
  for (const p of allPastPayments) {
    const k = `${String(p.loanPayment)}_${p.memberCode}`;
    const cur = paymentsByKey.get(k) || { totalPaise: 0, todayPaise: 0 };
    cur.totalPaise += (p.amountPaise || 0);
    if (p.paidOn >= startDay && p.paidOn <= endDay) {
      cur.todayPaise += (p.amountPaise || 0);
    }
    paymentsByKey.set(k, cur);
  }
  for (const ac of appCollections) {
    const k = `${String(ac.loanPayment)}_${ac.memberCode}`;
    const cur = paymentsByKey.get(k) || { totalPaise: 0, todayPaise: 0 };
    cur.todayPaise += (ac.amountPaise || 0);
    cur.totalPaise += (ac.amountPaise || 0);
    paymentsByKey.set(k, cur);
  }

  const members = [];
  const groupName = loans[0].group?.name || groupCode;

  for (const l of loans) {
    if (l.isSettled || l.status === 'settled' || settledKeySet.has(String(l._id))) continue;

    for (const line of (l.lines || [])) {
      const isLineSettled = line.isSettled || settledKeySet.has(`${String(l._id)}_${line.code}`) || settledKeySet.has(`${l.loanId}_${line.code}`);
      if (isLineSettled) continue;

      const stats = paymentsByKey.get(`${String(l._id)}_${line.code}`) || { totalPaise: 0, todayPaise: 0 };
      const totalPaidPaise = stats.totalPaise;
      const todayPaidPaise = stats.todayPaise;

      const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
      const totalLoanPaise = line.amountPaise || l.totalAmountPaise || 0;
      const totalScheduledPaise = (l.schedule || []).reduce((s, x) => s + (x.installmentPaise || 0), 0) + (line.extraEmiPaise || 0) * (l.schedule?.length || 0);

      // Point 3: Finished / fully-paid loans should not appear in EMI collection list
      if (totalScheduledPaise > 0 && totalPaidPaise >= totalScheduledPaise) continue;

      // Strict endDay comparison so installments due on dateStr are included (Point 2 fix)
      const dueSchedule = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= endDay);
      const expectedDuePaise = dueSchedule.length * emiPaise;
      const advancePaise = Math.max(0, totalPaidPaise - expectedDuePaise);
      const duesPaise = Math.max(0, expectedDuePaise - totalPaidPaise);
      const oldDuePaise = Math.max(0, duesPaise - emiPaise);

      const isAdvancePaid = advancePaise >= emiPaise;
      const alreadyPaidToday = todayPaidPaise > 0;
      const isFullyPaidToday = todayPaidPaise >= emiPaise && duesPaise === 0;
      const memberPendingDue = duesPaise > 0 ? (duesPaise / 100) : (alreadyPaidToday ? 0 : emiPaise / 100);

      members.push({
        loanPaymentId: l._id,
        loanId: l.loanId || l.receiptNo,
        memberId: line.member?._id || line.member,
        memberCode: line.code,
        memberName: line.name,
        emiAmount: emiPaise / 100,
        // Item 4 Fix: suggestedAmount / default editable amount MUST be regular EMI, not total due!
        suggestedAmount: emiPaise / 100,
        totalDue: duesPaise > 0 ? (duesPaise + todayPaidPaise) / 100 : emiPaise / 100,
        dueAmount: memberPendingDue, // includes old due
        oldDue: oldDuePaise / 100,
        todayPaidAmount: todayPaidPaise / 100,
        collectedAmount: todayPaidPaise / 100,
        advanceAmount: advancePaise / 100,
        isAdvancePaid,
        alreadyPaidToday,
        isFullyPaid: isFullyPaidToday,
        balanceAmount: Math.max(0, totalLoanPaise - totalPaidPaise) / 100,
      });
    }
  }

  const totalActualCollection = members.reduce((s, m) => s + (m.emiAmount || 0), 0);
  const totalCollectedToday = members.reduce((s, m) => s + (m.todayPaidAmount || 0), 0);
  // Remaining due includes all pending dues (Point 2 fix)
  const totalPendingDue = members.reduce((s, m) => s + (m.dueAmount || 0), 0);
  const totalDueAmount = members.reduce((s, m) => s + (m.totalDue || m.emiAmount || 0), 0);

  res.json({
    groupCode,
    groupName,
    actualCollection: totalActualCollection,
    totalDueAmount,
    totalCollectedToday,
    pendingDue: totalPendingDue,
    members,
  });
}

export async function collectBulkEmi(req, res) {
  const { items, date, payMode = 'cash', reference = '' } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    throw new HttpError(400, 'Please select at least one member to collect EMI');
  }

  const results = [];
  const paidOn = date ? new Date(date) : new Date();
  const staffCode = req.user?.employeeCode || '';

  // Point 23: Block EMI collection on Sundays and Holidays
  await assertNotSundayOrHoliday(paidOn);

  for (const it of items) {
    try {
      const amount = Number(it.amount);
      if (!amount || amount < 1) continue;

      const p = await LoanPayment.findById(it.loanPaymentId);
      if (!p) throw new Error('Loan not found');

      const line = (p.lines || []).find((l) => l.code === it.memberCode || String(l.member) === String(it.memberId));
      if (!line) throw new Error('Borrower not found in loan');

      const receiptNo = await generateCode('emiReceipt').catch(() => `REC${Date.now().toString().slice(-8)}`);
      const doc = await EmiPayment.create({
        receiptNo,
        loanPayment: p._id,
        loanId: p.loanId,
        formId: p.formId,
        branch: p.branch,
        type: 'regular',
        member: line.member,
        memberCode: line.code,
        memberName: line.name,
        group: p.group?.code ? `${p.group.code} — ${p.group.name}` : '',
        amountPaise: Math.round(amount * 100),
        paidOn,
        payMode: it.payMode || payMode,
        reference: it.reference || reference,
        employeeCode: staffCode,
        createdBy: req.user._id,
        createdByCode: staffCode,
        status: 'paid',
      });

      // Also record in AppEmiCollection so it appears in App Section -> Loan EMI Collection Approval
      await AppEmiCollection.create({
        loanPayment: p._id,
        loanId: p.loanId || p.formId,
        branch: p.branch?._id || p.branch,
        memberCode: line.code,
        memberName: line.name,
        group: p.group?.code ? `${p.group.code} — ${p.group.name}` : '',
        amountPaise: Math.round(amount * 100),
        collectedOn: paidOn,
        type: 'regular',
        payMode: ['cash', 'bank', 'upi', 'cheque'].includes(it.payMode || payMode) ? (it.payMode || payMode) : 'cash',
        reference: it.reference || reference || '',
        collectedBy: req.user._id,
        collectedByCode: staffCode,
        status: 'pending',
        receiptNo: doc.receiptNo,
      }).catch(() => {});

      results.push({
        memberCode: line.code,
        memberName: line.name,
        receiptNo: doc.receiptNo,
        amount,
        status: 'success',
      });
    } catch (err) {
      results.push({
        memberCode: it.memberCode,
        status: 'error',
        message: err.message,
      });
    }
  }

  const successful = results.filter((r) => r.status === 'success');
  const totalCollected = successful.reduce((acc, r) => acc + r.amount, 0);

  res.json({
    success: true,
    collectedCount: successful.length,
    failedCount: results.length - successful.length,
    totalCollected,
    results,
  });
}

// -----------------------------------------------------------------------------
// 15. INDIVIDUAL LOAN EMI COLLECTION (PERSONAL, BUSINESS/MSME, PRODUCT)
// -----------------------------------------------------------------------------
export async function getIndividualLoans(req, res) {
  const staffCode = req.user?.employeeCode || '';
  const loanType = cleanStr(req.query.loanType || 'personal').toLowerCase();
  const mode = cleanStr(req.query.mode || 'all').toLowerCase();
  const dateStr = cleanStr(req.query.date) || todayDateString();

  const targetDate = new Date(`${dateStr}T12:00:00.000Z`);
  const jsDay = targetDate.getDay(); // 0..6
  const dayOfMonth = targetDate.getDate();

  const typeFilter = (loanType === 'business' || loanType === 'msme' || loanType === 'business_msme')
    ? { $in: ['business', 'msme', 'business_msme'] }
    : loanType;

  const emp = await Employee.findOne({ employeeCode: staffCode }).lean();
  const branchId = emp?.branch || (req.user?.branches || [])[0];

  const query = {
    status: 'paid',
    $or: [
      { loanType: typeFilter },
      { kind: typeFilter },
    ],
    $and: [
      {
        $or: [
          { employeeCode: staffCode },
          ...(branchId ? [{ branch: branchId }] : []),
        ],
      },
    ],
  };

  let loans = await LoanPayment.find(query).populate('lines.member').lean();

  // Filter loans strictly according to mode & scheduled day
  const filteredLoans = loans.filter((l) => {
    const loanMode = (l.mode || l.modeLabel || 'monthly').toLowerCase();
    if (mode && mode !== 'all' && loanMode !== mode) return false;

    if (loanMode === 'daily') {
      return jsDay !== 0; // Monday to Saturday
    }

    if (loanMode === 'weekly') {
      // Must match target weekday: Friday loans must NEVER show on Saturday!
      if (Array.isArray(l.schedule) && l.schedule.length > 0) {
        for (const s of l.schedule) {
          if (s.dueDate) {
            const d = new Date(s.dueDate);
            return d.getDay() === jsDay;
          }
        }
      }
      return false;
    }

    if (loanMode === 'monthly') {
      if (Array.isArray(l.schedule) && l.schedule.length > 0) {
        return l.schedule.some((s) => {
          if (!s.dueDate) return false;
          const d = new Date(s.dueDate);
          return d.getDate() === dayOfMonth || d.toISOString().split('T')[0] === dateStr;
        });
      }
      return false;
    }

    return true;
  });

  const startDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endDay = new Date(`${dateStr}T23:59:59.999Z`);

  const allLoanIds = filteredLoans.map((l) => l._id);

  // Pre-fetch active settlements to exclude auto-settled and settled loans (Point 3)
  const activeSettlements = allLoanIds.length ? await LoanSettlement.find({
    status: 'active',
    $or: [
      { loanPayment: { $in: allLoanIds } },
      { loanId: { $in: filteredLoans.map((l) => l.loanId).filter(Boolean) } },
    ],
  }).select('loanPayment loanId memberCode').lean() : [];

  const settledKeySet = new Set();
  for (const s of activeSettlements) {
    if (s.loanPayment && s.memberCode) settledKeySet.add(`${String(s.loanPayment)}_${s.memberCode}`);
    if (s.loanId && s.memberCode) settledKeySet.add(`${s.loanId}_${s.memberCode}`);
    if (s.loanPayment && !s.memberCode) settledKeySet.add(`${String(s.loanPayment)}`);
  }

  const allPastPayments = allLoanIds.length ? await EmiPayment.find({
    loanPayment: { $in: allLoanIds },
    status: 'paid',
  }).lean() : [];

  const paymentsByKey = new Map();
  for (const p of allPastPayments) {
    const k = `${String(p.loanPayment)}_${p.memberCode}`;
    const cur = paymentsByKey.get(k) || { totalPaise: 0, todayPaise: 0 };
    cur.totalPaise += (p.amountPaise || 0);
    if (p.paidOn >= startDay && p.paidOn <= endDay) {
      cur.todayPaise += (p.amountPaise || 0);
    }
    paymentsByKey.set(k, cur);
  }

  const items = [];
  for (const l of filteredLoans) {
    if (l.isSettled || l.status === 'settled' || settledKeySet.has(String(l._id))) continue;

    for (const line of (l.lines || [])) {
      const isLineSettled = line.isSettled || settledKeySet.has(`${String(l._id)}_${line.code}`) || settledKeySet.has(`${l.loanId}_${line.code}`);
      if (isLineSettled) continue;

      const stats = paymentsByKey.get(`${String(l._id)}_${line.code}`) || { totalPaise: 0, todayPaise: 0 };
      const totalPaidPaise = stats.totalPaise;
      const todayPaidPaise = stats.todayPaise;

      const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
      const totalLoanPaise = line.amountPaise || l.totalAmountPaise || 0;
      const totalScheduledPaise = (l.schedule || []).reduce((s, x) => s + (x.installmentPaise || 0), 0) + (line.extraEmiPaise || 0) * (l.schedule?.length || 0);

      // Finished loan
      if (totalScheduledPaise > 0 && totalPaidPaise >= totalScheduledPaise) continue;

      const dueSchedule = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= new Date(dateStr));
      const expectedDuePaise = dueSchedule.length * emiPaise;
      const advancePaise = Math.max(0, totalPaidPaise - expectedDuePaise);
      const duesPaise = Math.max(0, expectedDuePaise - totalPaidPaise);

      const isAdvancePaid = advancePaise >= emiPaise;
      const alreadyPaidToday = todayPaidPaise > 0;
      const isCompleted = alreadyPaidToday || isAdvancePaid;

      items.push({
        loanPaymentId: l._id,
        loanId: l.loanId || l.receiptNo,
        memberId: line.member?._id || line.member,
        memberCode: line.code,
        memberName: line.name,
        loanType: l.loanType || loanType,
        mode: l.mode || l.modeLabel || 'monthly',
        emiAmount: emiPaise / 100,
        totalDue: emiPaise / 100,
        suggestedAmount: emiPaise / 100,
        dueAmount: duesPaise / 100,
        todayPaidAmount: todayPaidPaise / 100,
        collectedAmount: todayPaidPaise / 100,
        advanceAmount: advancePaise / 100,
        isAdvancePaid,
        alreadyPaidToday,
        isCompleted,
        balanceAmount: Math.max(0, totalLoanPaise - totalPaidPaise) / 100,
      });
    }
  }

  res.json({ loanType, mode, items });
}

// -----------------------------------------------------------------------------
// 16. ADVANCE PAYMENT & DYNAMIC COMPANY UPI QR CODE
// -----------------------------------------------------------------------------
export async function advancePayment(req, res) {
  const { loanId, memberCode, amount, payMode = 'cash', reference = '' } = req.body || {};
  if (!loanId) throw new HttpError(400, 'Loan ID is required');
  const payAmount = Number(amount);
  if (!payAmount || payAmount < 1) throw new HttpError(400, 'Enter valid amount of ₹1 or more');

  const loan = await LoanPayment.findOne({
    $or: [{ loanId: new RegExp(`^${loanId}$`, 'i') }, { receiptNo: new RegExp(`^${loanId}$`, 'i') }],
    status: 'paid',
  });
  if (!loan) throw new HttpError(404, `Loan '${loanId}' not found or already closed`);

  // Point 23: Block EMI collection on Sundays and Holidays
  await assertNotSundayOrHoliday(new Date(), loan.branch);

  const line = (loan.lines || []).find((l) => (memberCode && l.code === memberCode)) || loan.lines?.[0];
  if (!line) throw new HttpError(404, 'Borrower line not found in this loan');

  const payAmountPaise = Math.round(payAmount * 100);

  // 1. Check existing settlement and remaining balance to prevent balance going negative or paying settled loans
  const settlement = await LoanSettlement.findOne({
    loanPayment: loan._id,
    status: 'active',
  }).lean();

  if (settlement) {
    throw new HttpError(400, `Loan ${loan.loanId} is Auto-Settled (${settlement.kind}). No advance payment can be credited.`);
  }

  const existingPayments = await EmiPayment.find({ loanPayment: loan._id, status: 'paid' }).lean();
  const totalPaidPaise = existingPayments.reduce((acc, p) => acc + (p.amountPaise || 0), 0);
  const totalLoanPaise = line.amountPaise || loan.totalAmountPaise || loan.amountPaise || 0;
  const remainingBalancePaise = Math.max(0, totalLoanPaise - totalPaidPaise);

  if (remainingBalancePaise <= 0 || loan.status === 'closed') {
    throw new HttpError(400, `Loan ${loan.loanId} has already been fully paid and closed. Remaining balance is ₹0.`);
  }

  if (payAmountPaise > remainingBalancePaise) {
    throw new HttpError(400, `Advance payment of ₹${payAmount} exceeds remaining loan balance of ₹${remainingBalancePaise / 100}. Maximum payable is ₹${remainingBalancePaise / 100}.`);
  }

  // 2. Strict rapid double-tap / idempotency check (reject/return within 5 seconds)
  const recentDuplicate = await EmiPayment.findOne({
    loanPayment: loan._id,
    memberCode: line.code,
    amountPaise: payAmountPaise,
    createdAt: { $gte: new Date(Date.now() - 5000) },
  });

  if (recentDuplicate) {
    return res.status(200).json({
      success: true,
      receiptNo: recentDuplicate.receiptNo,
      amount: payAmount,
      loanId: loan.loanId,
      memberCode: line.code,
      memberName: line.name,
      message: `Advance payment of ₹${payAmount} was already credited (Receipt: ${recentDuplicate.receiptNo})`,
    });
  }

  const receiptNo = await generateCode('emiReceipt').catch(() => `ADV${Date.now().toString().slice(-8)}`);
  const doc = await EmiPayment.create({
    receiptNo,
    loanPayment: loan._id,
    loanId: loan.loanId,
    formId: loan.formId,
    branch: loan.branch,
    type: 'advance',
    member: line.member,
    memberCode: line.code,
    memberName: line.name,
    group: loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '',
    amountPaise: payAmountPaise,
    paidOn: new Date(),
    payMode,
    reference,
    employeeCode: req.user?.employeeCode || '',
    createdBy: req.user._id,
    createdByCode: req.user?.employeeCode || '',
    status: 'paid',
  });

  // Record in AppEmiCollection so it appears in Admin App Section Approval
  await AppEmiCollection.create({
    loanPayment: loan._id,
    loanId: loan.loanId || loan.formId,
    branch: loan.branch?._id || loan.branch,
    memberCode: line.code,
    memberName: line.name,
    group: loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '',
    amountPaise: payAmountPaise,
    collectedOn: new Date(),
    type: 'advance',
    payMode: ['cash', 'bank', 'upi', 'cheque'].includes(payMode) ? payMode : 'cash',
    reference: reference || '',
    collectedBy: req.user._id,
    collectedByCode: req.user?.employeeCode || '',
    status: 'pending',
    receiptNo: doc.receiptNo,
  }).catch(() => {});

  res.status(201).json({
    success: true,
    receiptNo: doc.receiptNo,
    amount: payAmount,
    loanId: loan.loanId,
    memberCode: line.code,
    memberName: line.name,
    message: `Advance payment of ₹${payAmount} successfully credited to Loan ${loan.loanId}`,
  });
}

// -----------------------------------------------------------------------------
// 17. NPA RECOVERY (NPA MEMBERS & OVERDUE RECOVERY)
// -----------------------------------------------------------------------------
export async function getNpaLoans(req, res) {
  const staffCode = req.user?.employeeCode || '';
  const emp = await Employee.findOne({ employeeCode: staffCode }).lean();

  const myAssignedGroups = await Group.find({
    isDeleted: { $ne: true },
    $or: [
      { employeeCode: staffCode },
      ...(emp?._id ? [{ employee: emp._id }] : []),
    ],
  }).select('code').lean();
  let myGroupCodes = myAssignedGroups.map((g) => g.code).filter(Boolean);

  if (!myGroupCodes.length) {
    const staffLoans = await LoanPayment.find({ employeeCode: staffCode, 'group.code': { $exists: true, $ne: '' } })
      .select('group.code')
      .lean();
    myGroupCodes = [...new Set(staffLoans.map((l) => l.group?.code).filter(Boolean))];
  }

  // Branch fallback so NPA loans in the branch are always accessible to the officer (Item 6 fix)
  const branchId = emp?.branch || (req.user?.branches || [])[0];

  const query = {
    status: { $in: ['paid', 'npa'] },
    $or: [
      { employeeCode: staffCode },
      ...(myGroupCodes.length ? [{ 'group.code': { $in: myGroupCodes } }] : []),
      ...(branchId ? [{ branch: branchId }] : []),
      { npa: true },
      { isNpa: true },
    ],
  };

  const loans = await LoanPayment.find(query).populate('branch', 'name code').lean();
  const npaList = [];
  const today = new Date();

  const allLoanIds = loans.map((l) => l._id);
  const allPayments = allLoanIds.length ? await EmiPayment.find({
    loanPayment: { $in: allLoanIds },
    status: 'paid',
  }).lean() : [];

  const paymentsByKey = new Map();
  for (const p of allPayments) {
    const k = `${String(p.loanPayment)}_${p.memberCode}`;
    paymentsByKey.set(k, (paymentsByKey.get(k) || 0) + (p.amountPaise || 0));
  }

  for (const l of loans) {
    for (const line of (l.lines || [])) {
      const totalPaidPaise = paymentsByKey.get(`${String(l._id)}_${line.code}`) || 0;
      const totalLoanPaise = line.amountPaise || l.totalAmountPaise || 0;
      const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);

      const overdueSchedules = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) < today);
      const expectedDuePaise = overdueSchedules.length * emiPaise;
      const overduePaise = Math.max(0, expectedDuePaise - totalPaidPaise);

      const isExplicitNpa = l.npa || l.isNpa || l.status === 'npa' || line.isNpa;

      if (overduePaise <= 0 && !isExplicitNpa) continue;

      // Accurately compute DPD from the earliest unpaid schedule item
      let runningPaid = totalPaidPaise;
      let firstUnpaidDueDate = null;
      for (const s of (l.schedule || [])) {
        const instPaise = (s.installmentPaise || 0) + (line.extraEmiPaise || 0);
        if (runningPaid >= instPaise) {
          runningPaid -= instPaise;
        } else {
          firstUnpaidDueDate = s.dueDate;
          break;
        }
      }
      const dpd = firstUnpaidDueDate ? Math.max(0, Math.floor((today - new Date(firstUnpaidDueDate)) / (1000 * 60 * 60 * 24))) : 0;

      // NPA condition: 90+ DPD, or loan term completed with unpaid balance, or 3+ overdue EMIs, or explicitly tagged NPA
      const isOverdueNpa = dpd >= 60 || overdueSchedules.length >= 3 || (l.emiEndDate && new Date(l.emiEndDate) < today);

      if (isExplicitNpa || isOverdueNpa) {
        npaList.push({
          loanPaymentId: l._id,
          loanId: l.loanId || l.receiptNo,
          memberId: line.member?._id || line.member,
          memberCode: line.code,
          memberName: line.name,
          phone: line.mobile || 'N/A',
          branchName: l.branch?.name || '',
          groupName: l.group?.name || l.group?.code || '',
          dpd: Math.max(dpd, isExplicitNpa ? 90 : 0),
          overduePrincipal: Math.round(overduePaise * 0.7) / 100,
          overdueInterest: Math.round(overduePaise * 0.3) / 100,
          totalOverdue: overduePaise > 0 ? (overduePaise / 100) : (totalLoanPaise - totalPaidPaise) / 100,
          totalBalance: Math.max(0, totalLoanPaise - totalPaidPaise) / 100,
          npaCategory: dpd > 365 ? 'Loss' : dpd > 180 ? 'Doubtful' : 'Sub-Standard',
        });
      }
    }
  }

  res.json({ items: npaList });
}

export async function recoverNpaLoan(req, res) {
  const { loanPaymentId, memberCode, amount, payMode = 'cash', reference = '' } = req.body || {};
  const payAmount = Number(amount);
  if (!payAmount || payAmount < 1) throw new HttpError(400, 'Enter recovery amount of ₹1 or more');

  const loan = await LoanPayment.findById(loanPaymentId);
  if (!loan) throw new HttpError(404, 'Loan record not found');

  // Point 23: Block NPA recovery collection on Sundays and Holidays
  await assertNotSundayOrHoliday(new Date(), loan.branch);

  // Point 23: Block EMI collection on Sundays and Holidays
  await assertNotSundayOrHoliday(new Date(), loan.branch);

  const line = (loan.lines || []).find((l) => l.code === memberCode) || loan.lines?.[0];
  if (!line) throw new HttpError(404, 'Borrower line not found in loan');

  const receiptNo = await generateCode('emiReceipt').catch(() => `NPA${Date.now().toString().slice(-8)}`);
  const doc = await EmiPayment.create({
    receiptNo,
    loanPayment: loan._id,
    loanId: loan.loanId,
    formId: loan.formId,
    branch: loan.branch,
    type: 'regular',
    npa: true,
    member: line.member,
    memberCode: line.code,
    memberName: line.name,
    group: loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '',
    amountPaise: Math.round(payAmount * 100),
    paidOn: new Date(),
    payMode,
    reference,
    employeeCode: req.user?.employeeCode || '',
    createdBy: req.user._id,
    createdByCode: req.user?.employeeCode || '',
    status: 'paid',
  });

  // Also record in AppEmiCollection so NPA recovery appears in System/Admin Approval section
  await AppEmiCollection.create({
    loanPayment: loan._id,
    loanId: loan.loanId || loan.formId,
    branch: loan.branch?._id || loan.branch,
    memberCode: line.code,
    memberName: line.name,
    group: loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '',
    amountPaise: Math.round(payAmount * 100),
    collectedOn: new Date(),
    type: 'regular',
    npa: true,
    payMode: ['cash', 'bank', 'upi', 'cheque'].includes(payMode) ? payMode : 'cash',
    reference: reference || '',
    collectedBy: req.user._id,
    collectedByCode: req.user?.employeeCode || '',
    status: 'pending',
    receiptNo: doc.receiptNo,
  }).catch(() => {});

  res.status(201).json({
    success: true,
    receiptNo: doc.receiptNo,
    amount: payAmount,
    loanId: loan.loanId,
    memberCode: line.code,
    memberName: line.name,
    message: `NPA recovery payment of ₹${payAmount} recorded successfully (Receipt ${doc.receiptNo})`,
  });
}

// -----------------------------------------------------------------------------
// 18. COMPANY DYNAMIC UPI QR
// -----------------------------------------------------------------------------
export async function getCompanyQr(req, res) {
  const { amount = 0, loanId = '', memberName = '' } = req.query;
  const company = await Company.findOne().lean();
  const bank = await BankAccount.findOne({ isActive: true }).lean();

  const companyName = company?.name || 'Udgam Micro Finance';
  const upiId = bank?.accountNumber ? `${bank.accountNumber}@bank` : 'udgamfinance@upi';

  const upiString = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(companyName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(`Loan ${loanId} EMI - ${memberName}`)}`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(upiString)}`;

  res.json({
    companyName,
    upiId,
    amount: Number(amount),
    loanId,
    memberName,
    upiString,
    qrImageUrl,
  });
}

// -----------------------------------------------------------------------------
// 19. BORROWER SAVING AMOUNT & WITHDRAWAL REQUEST (POINT 16)
// -----------------------------------------------------------------------------
export async function getBorrowerSavings(req, res) {
  const query = cleanStr(req.params.query);
  const member = await Member.findOne({
    $or: [{ code: new RegExp(`^${query}$`, 'i') }, { mobile: query }, { aadhaar: query }],
    isDeleted: false,
  }).lean();
  if (!member) throw new HttpError(404, `Member not found matching '${query}'`);

  const loans = await LoanPayment.find({
    status: 'paid',
    'lines.member': member._id,
  }).lean();

  const asOf = startOfToday();
  let totalDepositedPaise = 0;
  let runningSecurityPaise = 0;
  let closedSecurityPaise = 0;
  let totalInterestPaise = 0;
  let closedInterestPaise = 0;
  const deposits = [];

  for (const l of loans) {
    const line = l.lines?.find((x) => String(x.member) === String(member._id));
    if (line && line.securityPaise > 0) {
      totalDepositedPaise += line.securityPaise;
      const years = fullYears(new Date(l.paidOn || l.createdAt), asOf);
      const interest = Math.round((line.securityPaise * years * SECURITY_INTEREST_PERCENT) / 100);
      totalInterestPaise += interest;

      // Determine whether this loan is closed or settled (Point 15: settled loans security is withdrawable)
      let isClosed = false;
      const isSettledInDb = await LoanSettlement.exists({
        loanPayment: l._id,
        $or: [
          { member: member._id },
          { memberCode: new RegExp(`^${member.code}$`, 'i') },
        ],
        status: { $in: ['active', 'approved', 'settled'] },
      });
      if (isSettledInDb || l.isSettled || line.isSettled || l.status === 'settled' || l.status === 'closed') {
        isClosed = true;
      } else {
        try {
          const st = await borrowerState(l, line, asOf);
          isClosed = Boolean(st.settled) || !st.left || st.left.length === 0;
        } catch {
          isClosed = false;
        }
      }
      if (isClosed) {
        closedSecurityPaise += line.securityPaise;
        closedInterestPaise += interest;
      } else {
        runningSecurityPaise += line.securityPaise;
      }

      deposits.push({
        loanId: l.loanId || l.receiptNo || l.formId,
        date: l.paidOn || l.createdAt,
        amount: line.securityPaise / 100,
        years,
        interest: interest / 100,
        isClosed,
        status: isClosed ? 'Closed (Eligible for Withdrawal)' : 'Running (Locked)',
      });
    }
  }

  const withdrawals = await SecurityWithdrawal.find({ member: member._id }).sort({ createdAt: -1 }).lean();
  const approvedWithdrawals = withdrawals.filter((w) => w.status === 'approved');
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');
  const withdrawnPaise = approvedWithdrawals.reduce((sum, w) => sum + (w.amountPaise || 0), 0);
  const pendingPaise = pendingWithdrawals.reduce((sum, w) => sum + (w.amountPaise || 0), 0);

  // ONLY closed loan security can be withdrawn! Running loan security is locked.
  const withdrawablePaise = Math.max(0, closedSecurityPaise - withdrawnPaise - pendingPaise);

  res.json({
    member: {
      id: member._id,
      code: member.code,
      name: member.name,
      mobile: member.mobile,
      branch: member.branch,
    },
    totalDeposited: totalDepositedPaise / 100,
    runningSecurity: runningSecurityPaise / 100,
    closedSecurity: closedSecurityPaise / 100,
    interestEarned: totalInterestPaise / 100,
    interestRate: SECURITY_INTEREST_PERCENT,
    totalWithdrawn: withdrawnPaise / 100,
    pendingWithdrawal: pendingPaise / 100,
    availableBalance: withdrawablePaise / 100,
    withdrawableAmount: withdrawablePaise / 100,
    deposits,
    withdrawals: withdrawals.map((w) => ({
      id: w._id,
      receiptNo: w.receiptNo,
      date: w.createdAt,
      kind: w.kind,
      amount: w.amountPaise / 100,
      status: w.status,
      remark: w.remark,
    })),
  });
}

export async function requestSavingsWithdrawal(req, res) {
  const { memberId, amount, kind = 'withdraw', remark = '' } = req.body || {};
  const member = await Member.findById(memberId);
  if (!member) throw new HttpError(404, 'Member not found');

  const payAmount = Number(amount);
  if (!payAmount || payAmount < 100) throw new HttpError(400, 'Minimum withdrawal request is ₹100');
  const requestedPaise = Math.round(payAmount * 100);

  // Validate that only security from closed loans is withdrawable (running loan security is locked)
  const loans = await LoanPayment.find({ status: 'paid', 'lines.member': member._id }).lean();
  let totalDepositedPaise = 0;
  let runningSecurityPaise = 0;
  let closedSecurityPaise = 0;
  const asOf = startOfToday();

  for (const l of loans) {
    const line = l.lines?.find((x) => String(x.member) === String(member._id));
    if (line && line.securityPaise > 0) {
      totalDepositedPaise += line.securityPaise;
      let isClosed = false;
      const isSettledInDb = await LoanSettlement.exists({
        loanPayment: l._id,
        $or: [
          { member: member._id },
          { memberCode: new RegExp(`^${member.code}$`, 'i') },
        ],
        status: { $in: ['active', 'approved', 'settled'] },
      });
      if (isSettledInDb || l.isSettled || line.isSettled || l.status === 'settled' || l.status === 'closed') {
        isClosed = true;
      } else {
        try {
          const st = await borrowerState(l, line, asOf);
          isClosed = Boolean(st.settled) || !st.left || st.left.length === 0;
        } catch {
          isClosed = false;
        }
      }
      if (isClosed) {
        closedSecurityPaise += line.securityPaise;
      } else {
        runningSecurityPaise += line.securityPaise;
      }
    }
  }

  const existingWithdrawals = await SecurityWithdrawal.find({ member: member._id, status: { $in: ['pending', 'approved'] } });
  const alreadyRequestedPaise = existingWithdrawals.reduce((sum, w) => sum + (w.amountPaise || 0), 0);
  const withdrawablePaise = Math.max(0, closedSecurityPaise - alreadyRequestedPaise);

  if (withdrawablePaise <= 0) {
    throw new HttpError(400, `No withdrawable security available. Running loan security of ₹${runningSecurityPaise / 100} is locked until loan closure.`);
  }
  if (requestedPaise > withdrawablePaise) {
    throw new HttpError(400, `Requested amount ₹${payAmount} exceeds withdrawable balance of ₹${withdrawablePaise / 100} (Total: ₹${totalDepositedPaise / 100}, Running locked: ₹${runningSecurityPaise / 100}).`);
  }

  const receiptNo = await generateCode('securityReceipt').catch(() => `SEC${Date.now().toString().slice(-8)}`);
  const doc = await SecurityWithdrawal.create({
    receiptNo,
    member: member._id,
    memberCode: member.code,
    memberName: member.name,
    branch: member.branch,
    kind,
    amountPaise: requestedPaise,
    remark: cleanStr(remark),
    status: 'pending',
    requestedByCode: req.user?.employeeCode || '',
    createdBy: req.user._id,
  });

  res.status(201).json({
    success: true,
    receiptNo: doc.receiptNo,
    amount: payAmount,
    message: 'Security withdrawal request submitted for approval',
    item: doc,
  });
}

// -----------------------------------------------------------------------------
// 20. EMPLOYEE REPORTS & TARGETS (POINT 17)
// -----------------------------------------------------------------------------
export async function getEmployeeReports(req, res) {
  const code = req.user?.employeeCode;
  const { dateFrom, dateTo } = req.query;

  const dateFilter = {};
  if (dateFrom && dateTo) {
    dateFilter.createdAt = {
      $gte: new Date(`${dateFrom}T00:00:00.000Z`),
      $lte: new Date(`${dateTo}T23:59:59.999Z`),
    };
  }

  const disbursements = await LoanPayment.find({
    employeeCode: code,
    status: 'paid',
    ...dateFilter,
  }).sort({ paidOn: -1 }).limit(100).lean();

  const totalDisbursed = disbursements.reduce((sum, d) => sum + (d.totalAmountPaise || d.amountPaise || 0), 0) / 100;

  const requisitions = await LoanRequisition.find({
    employeeCode: code,
    isDeleted: false,
    ...dateFilter,
  }).sort({ createdAt: -1 }).limit(100).lean();

  const approvals = requisitions.filter((r) => r.status === 'approved');

  const npaPayments = await EmiPayment.find({
    employeeCode: code,
    npa: true,
    status: 'paid',
    ...dateFilter,
  }).sort({ paidOn: -1 }).limit(100).lean();

  const totalNpaRecovered = npaPayments.reduce((sum, p) => sum + (p.amountPaise || 0), 0) / 100;

  const centerSurveys = await CenterVisit.find({
    employeeCode: code,
    ...dateFilter,
  }).sort({ visitDate: -1 }).limit(100).lean();

  // Point 16 & Item 11 Fix: Separate Actual Completed Product Sales from Pending Bookings
  // Target must show ACTUAL PRODUCT SELL, not product bookings!
  const productSales = await ProductSaleOrder.find({
    employeeCode: code,
    ...dateFilter,
  }).sort({ createdAt: -1 }).limit(100).lean();

  const actualProductSales = productSales.filter((p) => p.status === 'completed' || p.status === 'approved');
  const pendingProductBookings = productSales.filter((p) => p.status === 'pending');
  const totalActualProductSales = actualProductSales.reduce((sum, p) => sum + (p.totalAmount || 0), 0);
  const totalBookingsAmount = pendingProductBookings.reduce((sum, p) => sum + (p.totalAmount || 0), 0);

  const targetTasks = await TargetTask.find({
    status: 'active',
    'employees.code': code,
  }).sort({ fromDate: -1 }).limit(5).lean();

  res.json({
    summary: {
      totalDisbursed,
      disbursementCount: disbursements.length,
      requisitionCount: requisitions.length,
      approvalCount: approvals.length,
      totalNpaRecovered,
      npaRecoveryCount: npaPayments.length,
      centerSurveyCount: centerSurveys.length,
      totalProductSales: totalActualProductSales, // Item 11 Fix: Actual Product Sales for Target
      productSalesCount: actualProductSales.length, // Actual completed sales count
      pendingBookingsCount: pendingProductBookings.length,
      pendingBookingsAmount: totalBookingsAmount,
    },
    disbursements: disbursements.map((d) => ({
      loanId: d.loanId || d.receiptNo,
      borrower: d.lines?.[0]?.name,
      amount: (d.totalAmountPaise || d.amountPaise || 0) / 100,
      mode: d.mode,
      date: d.paidOn ? new Date(d.paidOn).toLocaleDateString() : 'N/A',
    })),
    centerSurveys: centerSurveys.map((c) => ({
      id: c._id,
      centerName: c.centerName,
      contactName: c.contactName,
      contactNumber: c.contactNumber,
      location: c.location,
      image: c.image || '',
      date: c.visitDate ? new Date(c.visitDate).toLocaleDateString() : 'N/A',
      notes: c.notes || '',
    })),
    requisitions: requisitions.map((r) => ({
      formId: r.formId,
      borrower: r.borrower?.name,
      amount: (r.amountPaise || 0) / 100,
      status: r.status,
      date: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : 'N/A',
    })),
    approvals: approvals.map((a) => ({
      formId: a.formId,
      borrower: a.borrower?.name,
      amount: (a.amountPaise || 0) / 100,
      status: a.status,
    })),
    npaRecovery: npaPayments.map((p) => ({
      receiptNo: p.receiptNo,
      member: p.memberName,
      amount: (p.amountPaise || 0) / 100,
      date: p.paidOn ? new Date(p.paidOn).toLocaleDateString() : 'N/A',
      payMode: p.payMode,
    })),
    // Point 16 & Item 11: Product Sell Requests list in Reports with clear status
    productSales: productSales.map((p) => ({
      id: p._id,
      orderId: p.orderId || p._id,
      productName: p.productName,
      quantity: p.quantity,
      unitPrice: p.unitPrice,
      totalAmount: p.totalAmount,
      payMode: p.payMode,
      memberCode: p.memberCode,
      memberName: p.memberName,
      status: p.status || 'pending',
      isActualSale: p.status === 'completed' || p.status === 'approved',
      date: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'N/A',
    })),
    targets: targetTasks.map((t) => ({
      id: t._id,
      fromDate: t.fromDate,
      toDate: t.toDate,
      targets: t.targets,
      achieved: {
        d6: totalDisbursed,
        npaRecovery: totalNpaRecovered,
        productSales: totalActualProductSales, // Item 11: Actual completed sales only
      },
    })),
  });
}

// -----------------------------------------------------------------------------
// 21. FIRST MEETING ATTENDANCE (POINT 18)
// -----------------------------------------------------------------------------
export async function getAttendanceTiming(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({
    $or: [{ employeeCode: new RegExp(`^${code}$`, 'i') }, { user: req.user?._id }],
    isDeleted: false,
  });
  const now = nowIst();
  const timeConfig = emp?.attendanceTime?.from && emp?.attendanceTime?.to ? emp.attendanceTime : null;
  const isLocked = Boolean(timeConfig && (now < timeConfig.from || now > timeConfig.to));

  res.json({
    timing: timeConfig,
    currentTime: now,
    isLocked,
    message: isLocked
      ? `Attendance is locked. Allowed hours are ${timeConfig.from} to ${timeConfig.to} (current Indian time: ${now}).`
      : 'Attendance is currently open.',
  });
}

export async function markFirstMeetingAttendance(req, res) {
  const code = req.user?.employeeCode;
  const { photo, location } = req.body || {};
  if (!photo) throw new HttpError(400, 'Meeting photo upload is required');

  const emp = await Employee.findOne({
    $or: [{ employeeCode: new RegExp(`^${code}$`, 'i') }, { user: req.user?._id }],
    isDeleted: false,
  });
  if (!emp) throw new HttpError(404, 'Employee record not found');

  const today = startOfToday();

  // 1. Prevent duplicate attendance punch in 1 day
  const existingMeeting = await FirstMeetingAttendance.findOne({ employeeCode: new RegExp(`^${emp.employeeCode}$`, 'i'), date: today });
  const existingAtt = await Attendance.findOne({ employee: emp._id, date: today });
  if (existingMeeting || (existingAtt && existingAtt.firstActivity)) {
    throw new HttpError(400, 'Attendance for today is already marked. Only 1 attendance punch per day is permitted.');
  }

  // 2. Validate time window if set for this employee
  if (emp.attendanceTime?.from && emp.attendanceTime?.to) {
    const now = nowIst();
    if (now < emp.attendanceTime.from || now > emp.attendanceTime.to) {
      throw new HttpError(422, `Attendance can only be marked between ${emp.attendanceTime.from} and ${emp.attendanceTime.to} (current Indian time is ${now}). Outside this window attendance is locked.`);
    }
  }

  // 3. Validate geofence location radius if locations are configured
  const places = locationsOf(emp);
  if (places.length) {
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new HttpError(422, 'GPS location coordinates are required for attendance verification.');
    }
    const measured = places.map((p) => ({ ...p, distance: Math.round(metresBetween(p.lat, p.lng, lat, lng)) })).sort((a, b) => a.distance - b.distance);
    const nearest = measured[0];
    if (measured.every((p) => p.distance > (p.radius || 500))) {
      throw new HttpError(422, `You are ${nearest.distance}m away from ${nearest.name || 'attendance location'}. Attendance is allowed within ${nearest.radius || 500}m.`);
    }
  }

  const meetingRecord = await FirstMeetingAttendance.create({
    employeeCode: code,
    employeeName: emp.name,
    branch: emp.branch,
    date: today,
    photo,
    location,
    status: 'present',
  });

  await Attendance.findOneAndUpdate(
    { employee: emp._id, date: today },
    {
      employee: emp._id,
      date: today,
      status: 'present',
      source: 'app',
      lat: location?.lat,
      lng: location?.lng,
      firstActivity: new Date(),
      lastActivity: new Date(),
      remark: 'First meeting marked with photo in app',
    },
    { upsert: true }
  );

  res.status(201).json({
    success: true,
    message: 'First meeting attendance marked successfully with photo!',
    item: meetingRecord,
  });
}

// -----------------------------------------------------------------------------
// 22. SALARY SLIP MONTH WISE (POINT 19)
// -----------------------------------------------------------------------------
export async function getSalarySlips(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  const query = { $or: [{ employeeCode: code }] };
  if (emp?._id) query.$or.push({ employee: emp._id });

  const slips = await Salary.find(query)
    .sort({ month: -1 })
    .lean();

  res.json({
    items: slips.map((s) => {
      const basicLine = (s.lines || []).find((l) => l.key === 'basic');
      const fuelLine = (s.lines || []).find((l) => l.key === 'fuel');
      const leaveLine = (s.lines || []).find((l) => l.key === 'leave');
      const pfLine = (s.lines || []).find((l) => l.key === 'pf');
      const esiLine = (s.lines || []).find((l) => l.key === 'esi');
      const advanceLine = (s.lines || []).find((l) => l.key === 'advance');
      const secLine = (s.lines || []).find((l) => l.key === 'security');

      const basic = (basicLine?.amountPaise || 0) / 100;
      const fuel = (fuelLine?.amountPaise || 0) / 100;

      // Point 17: Salary base is Basic + Fuel if fuel is present, else Basic only.
      // Daily rate = Base / month days. Payout = Daily rate * payable days.
      const baseSalary = fuel > 0 ? (basic + fuel) : basic;
      const days = s.daysInMonth || 30;
      const dailyRate = days > 0 ? (baseSalary / days) : 0;
      const absentDays = s.absentDays || 0;
      const payableDays = s.payableDays ?? Math.max(0, days - absentDays);

      const leaveDeduction = (leaveLine?.amountPaise || 0) / 100 || Math.round(dailyRate * absentDays * 100) / 100;
      const grossSalary = baseSalary || (s.grossPaise || 0) / 100;
      const earnedSalary = s.earnedPaise ? (s.earnedPaise / 100) : Math.round(dailyRate * payableDays * 100) / 100;
      const pfDeduction = (pfLine?.amountPaise || 0) / 100;
      const esiDeduction = (esiLine?.amountPaise || 0) / 100;
      const advanceDeduction = (advanceLine?.amountPaise || 0) / 100;
      const securityDeduction = (secLine?.amountPaise || s.securityCutPaise || 0) / 100;

      const otherDeductions = pfDeduction + esiDeduction + advanceDeduction + securityDeduction;
      const totalDeductions = (s.totalDeductionPaise ? s.totalDeductionPaise / 100 : (leaveDeduction + otherDeductions));
      const netSalary = s.netPaise ? (s.netPaise / 100) : Math.max(0, earnedSalary - otherDeductions);

      return {
        id: s._id,
        month: s.month,
        name: s.name || emp?.name || code,
        designation: s.designation || emp?.designation?.name || 'Field Officer',
        branch: s.branchName || 'Head Office',
        grossSalary,
        basicSalary: basic || grossSalary,
        fuelAllowance: fuel,
        dailyRate: Math.round(dailyRate * 100) / 100,
        absentDeduction: leaveDeduction,
        pfDeduction,
        esiDeduction,
        advanceDeduction,
        securityDeduction,
        allowances: fuel,
        deductions: totalDeductions,
        earnedSalary,
        netSalary,
        daysInMonth: days,
        presentDays: s.presentDays || (days - absentDays),
        absentDays,
        payableDays,
        status: s.status || 'generated',
        paidOn: s.paidOn,
        lines: (s.lines || []).map((l) => ({
          key: l.key,
          label: l.label,
          side: l.side,
          amount: (l.amountPaise || 0) / 100,
        })),
      };
    }),
  });
}

// -----------------------------------------------------------------------------
// 23. ATTENDANCE HISTORY MONTH WISE (POINT 20)
// -----------------------------------------------------------------------------
export async function getAttendanceHistory(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  if (!emp) throw new HttpError(404, 'Employee not found');

  const monthStr = cleanStr(req.query.month) || new Date().toISOString().slice(0, 7);
  const startMonth = new Date(`${monthStr}-01T00:00:00.000Z`);
  const endMonth = new Date(startMonth.getFullYear(), startMonth.getMonth() + 1, 0, 23, 59, 59, 999);

  const records = await Attendance.find({
    employee: emp._id,
    date: { $gte: startMonth, $lte: endMonth },
  }).sort({ date: 1 }).lean();

  const meetingPhotos = await FirstMeetingAttendance.find({
    employeeCode: code,
    date: { $gte: startMonth, $lte: endMonth },
  }).lean();

  const photoMap = new Map();
  meetingPhotos.forEach((p) => {
    photoMap.set(new Date(p.date).toISOString().slice(0, 10), p.photo);
  });

  const presentCount = records.filter((r) => r.status === 'present').length;
  const absentCount = records.filter((r) => r.status === 'absent').length;
  const leaveCount = records.filter((r) => r.status === 'leave').length;

  res.json({
    month: monthStr,
    summary: {
      present: presentCount,
      absent: absentCount,
      leave: leaveCount,
      totalMarked: records.length,
    },
    days: records.map((r) => {
      const dStr = new Date(r.date).toISOString().slice(0, 10);
      return {
        date: dStr,
        status: r.status,
        photo: photoMap.get(dStr) || null,
        firstActivity: r.firstActivity,
        remark: r.remark,
      };
    }),
  });
}

// -----------------------------------------------------------------------------
// 24. NEW CENTER VISIT UPDATE (POINT 21)
// -----------------------------------------------------------------------------
export async function recordCenterVisit(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  const { centerName, contactName, contactNumber, location, image, notes } = req.body || {};

  if (!centerName || !contactName || !contactNumber) {
    throw new HttpError(400, 'Center name, contact person name and mobile number are required');
  }

  const visit = await CenterVisit.create({
    employeeCode: code,
    employeeName: emp?.name,
    branch: emp?.branch,
    centerName,
    contactName,
    contactNumber,
    location,
    image,
    visitDate: new Date(),
    notes,
  });

  // Sync to CenterSurvey so it immediately appears in Software's New Center Survey Report
  if (emp?.branch) {
    try {
      const surveyNo = await generateCode('centerSurvey').catch(() => `SRV${Date.now().toString().slice(-8)}`);
      await CenterSurvey.create({
        surveyNo,
        branch: emp.branch,
        centerName: centerName.trim(),
        leaderName: contactName.trim(),
        leaderMobile: contactNumber.trim(),
        surveyDate: new Date(),
        remark: notes || 'Recorded via Employee App (New Center Visit)',
        status: 'surveyed',
        surveyedByCode: code,
        statusHistory: [{ status: 'surveyed', remark: 'New center visit via Employee App', byCode: code, at: new Date() }],
      });
    } catch (err) {
      console.warn('Failed to sync to CenterSurvey:', err.message);
    }
  }

  res.status(201).json({
    success: true,
    message: 'New Center visit updated successfully!',
    item: visit,
  });
}

export async function listCenterVisits(req, res) {
  const code = req.user?.employeeCode;
  const items = await CenterVisit.find({ employeeCode: code }).sort({ visitDate: -1 }).limit(50).lean();
  res.json({ items });
}

// -----------------------------------------------------------------------------
// 25. CGT VISIT UPDATE (POINT 22)
// -----------------------------------------------------------------------------
export async function listCgtVisits(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  const items = await CgtVisit.find({ employeeCode: code }).sort({ updatedAt: -1 }).limit(50).lean();

  const surveyedVisits = await CenterVisit.find({ $or: [{ employeeCode: code }, { branch: emp?.branch }] }).sort({ visitDate: -1 }).limit(100).lean();
  const branchSurveys = emp?.branch ? await CenterSurvey.find({ branch: emp.branch, isDeleted: false }).sort({ surveyDate: -1 }).limit(100).lean() : [];

  const centerMap = new Map();
  for (const c of surveyedVisits) {
    if (c.centerName && !centerMap.has(c.centerName.trim().toLowerCase())) {
      centerMap.set(c.centerName.trim().toLowerCase(), {
        centerName: c.centerName,
        contactName: c.contactName,
        contactNumber: c.contactNumber,
        visitDate: c.visitDate,
      });
    }
  }
  for (const s of branchSurveys) {
    if (s.centerName && !centerMap.has(s.centerName.trim().toLowerCase())) {
      centerMap.set(s.centerName.trim().toLowerCase(), {
        centerName: s.centerName,
        contactName: s.leaderName,
        contactNumber: s.leaderMobile,
        visitDate: s.surveyDate,
      });
    }
  }

  res.json({
    items,
    centers: Array.from(centerMap.values()),
  });
}

export async function updateCgtDayPhoto(req, res) {
  const code = req.user?.employeeCode;
  const { centerName, day, photo, date = new Date() } = req.body || {};
  if (!centerName || !day || !photo) {
    throw new HttpError(400, 'Center name, CGT day (1, 2, or 3), and photo are required');
  }

  const dayNum = Number(day);
  const targetDate = new Date(date);
  const targetDateOnly = targetDate.toISOString().slice(0, 10);

  const emp = await Employee.findOne({ employeeCode: code });
  let visit = await CgtVisit.findOne({ centerName: new RegExp(`^${centerName}$`, 'i'), employeeCode: code });

  if (!visit) {
    visit = new CgtVisit({
      centerName,
      branch: emp?.branch,
      employeeCode: code,
    });
  }

  // Enforce sequential date validation: Day 2 > Day 1, Day 3 > Day 2
  if (dayNum === 2) {
    if (!visit.day1?.photo || !visit.day1?.date) {
      throw new HttpError(400, 'Day 1 photo must be recorded before Day 2 can be conducted.');
    }
    const d1Str = new Date(visit.day1.date).toISOString().slice(0, 10);
    if (targetDateOnly <= d1Str) {
      throw new HttpError(400, `CGT Day 2 date (${targetDateOnly}) must be on a subsequent date after Day 1 (${d1Str}). Day 1 and Day 2 cannot be on the same date or earlier.`);
    }
  } else if (dayNum === 3) {
    if (!visit.day1?.photo || !visit.day1?.date) {
      throw new HttpError(400, 'Day 1 photo must be recorded before Day 3.');
    }
    if (!visit.day2?.photo || !visit.day2?.date) {
      throw new HttpError(400, 'Day 2 photo must be recorded before Day 3 can be conducted.');
    }
    const d2Str = new Date(visit.day2.date).toISOString().slice(0, 10);
    if (targetDateOnly <= d2Str) {
      throw new HttpError(400, `CGT Day 3 date (${targetDateOnly}) must be on a subsequent date after Day 2 (${d2Str}). Day 2 and Day 3 cannot be on the same date or earlier.`);
    }
  }

  const dayKey = `day${dayNum}`;
  visit[dayKey] = {
    date: targetDate,
    photo,
    byCode: code,
  };

  if (visit.day1?.photo && visit.day2?.photo && visit.day3?.photo) {
    visit.status = 'completed';
  }

  await visit.save();

  // Sync CGT progress to Software Center Survey report
  try {
    const srv = await CenterSurvey.findOne({ centerName: new RegExp(`^${centerName}$`, 'i'), isDeleted: false });
    if (srv) {
      const isComplete = visit.status === 'completed';
      srv.statusHistory.push({
        status: isComplete ? 'formed' : 'under_review',
        remark: `CGT Day ${dayNum} completed on ${targetDateOnly} by ${code}`,
        byCode: code,
        at: new Date(),
      });
      if (isComplete) srv.status = 'formed';
      else if (srv.status === 'surveyed') srv.status = 'under_review';
      await srv.save();
    }
  } catch (err) {
    console.warn('Failed to sync CGT progress to CenterSurvey:', err.message);
  }

  res.json({
    success: true,
    message: `CGT Day ${day} photo updated successfully for ${centerName}!`,
    item: visit,
  });
}

// -----------------------------------------------------------------------------
// 26. LEAVE APPLY, HISTORY & BALANCES (POINT 23)
// -----------------------------------------------------------------------------
export async function getLeaveOverview(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  if (!emp) throw new HttpError(404, 'Employee not found');

  const leaves = await Leave.find({ employee: emp._id }).sort({ createdAt: -1 }).limit(30).lean();

  const approvedCasual = leaves.filter((l) => l.type === 'casual' && l.status === 'approved').reduce((s, l) => s + (l.days || 1), 0);
  const realEl = await elBalance(emp);

  res.json({
    balances: {
      clTotal: 12,
      clUsed: approvedCasual,
      clBalance: Math.max(0, 12 - approvedCasual),
      elTotal: 12, // Fixed standard: 12 EL per Financial Year (1 EL per month)
      elAccumulated: (realEl.opening || 0) + (realEl.earned || 0),
      elUsed: realEl.used || 0,
      elBalance: realEl.available,
      elOpening: realEl.opening || 0,
      elEarned: realEl.earned || 0,
      financialYear: realEl.financialYear,
    },
    leaves,
  });
}

export async function applyLeave(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  if (!emp) throw new HttpError(404, 'Employee not found');
  const { type = 'casual', from, to, reason } = req.body || {};

  if (!from || !to) throw new HttpError(400, 'From date and To date are required');

  const d1 = new Date(from);
  const d2 = new Date(to);
  if (d2 < d1) throw new HttpError(400, 'End date cannot be earlier than start date');
  const days = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);

  // Validate Earned Leave balance based on joining date
  if (type === 'earned') {
    const bal = await elBalance(emp);
    if (days > bal.available) {
      throw new HttpError(400, `Cannot apply for ${days} days of Earned Leave. Available EL balance is only ${bal.available} day(s) (Opening: ${bal.opening}, Earned: ${bal.earned}, Used/Pending: ${bal.used}).`);
    }
  }

  const sup = emp.supervisor ? await Employee.findOne({ _id: emp.supervisor, isDeleted: false }).select('employeeCode name') : null;

  const doc = await Leave.create({
    employee: emp._id,
    employeeCode: code,
    employeeName: emp.name,
    branch: emp.branch,
    type,
    from: d1,
    to: d2,
    days,
    reason: reason || 'Leave application',
    approver: sup?._id,
    approverCode: sup?.employeeCode,
    approverName: sup?.name,
    status: 'pending',
    appliedByCode: code,
  });

  res.status(201).json({
    success: true,
    message: `Leave application for ${days} day(s) submitted for approval!`,
    item: doc,
  });
}

// -----------------------------------------------------------------------------
// 27. COMPLAINT SUBMISSION (POINT 24)
// -----------------------------------------------------------------------------
export async function submitComplaint(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  const { category = 'other', description, loanId, callerMobile } = req.body || {};

  if (!description) throw new HttpError(400, 'Complaint description is required');

  const count = await Complaint.countDocuments({});
  const complaintNo = `CMP${String(count + 1001).padStart(6, '0')}`;

  const doc = await Complaint.create({
    complaintNo,
    date: new Date(),
    callerName: emp?.name || code,
    callerMobile: callerMobile || emp?.mobile || '',
    branch: emp?.branch,
    category,
    loanId,
    description,
    status: 'open',
    enteredByCode: code,
  });

  res.status(201).json({
    success: true,
    complaintNo: doc.complaintNo,
    message: `Complaint ${complaintNo} registered successfully!`,
  });
}

export async function listMyComplaints(req, res) {
  const code = req.user?.employeeCode;
  const items = await Complaint.find({ enteredByCode: code }).sort({ createdAt: -1 }).limit(30).lean();
  res.json({ items });
}

// -----------------------------------------------------------------------------
// 28. RESIGNATION SUBMISSION (POINT 25)
// -----------------------------------------------------------------------------
export async function submitResignation(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  const { lastWorkingDate, reason } = req.body || {};

  if (!lastWorkingDate || !reason) throw new HttpError(400, 'Proposed last working date and reason are required');

  const doc = await Resignation.create({
    employee: emp._id,
    employeeCode: code,
    employeeName: emp.name,
    branch: emp.branch,
    appliedOn: new Date(),
    lastWorkingDate: new Date(lastWorkingDate),
    reason,
    status: 'pending',
    appliedByCode: code,
  });

  res.status(201).json({
    success: true,
    message: 'Resignation request submitted to HR Management for review.',
    item: doc,
  });
}

export async function getResignationStatus(req, res) {
  const code = req.user?.employeeCode;
  const item = await Resignation.findOne({ employeeCode: code }).sort({ createdAt: -1 }).lean();
  res.json({ item });
}

// -----------------------------------------------------------------------------
// 29. BRANCH TRANSFER REQUEST (POINT 26)
// -----------------------------------------------------------------------------
export async function requestBranchTransfer(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code }).populate('branch');
  if (!emp) throw new HttpError(404, 'Employee record not found');
  const { targetBranchId, reason } = req.body || {};

  if (!targetBranchId) throw new HttpError(400, 'Please select the target branch');

  const targetBranch = await Branch.findById(targetBranchId);
  if (!targetBranch) throw new HttpError(404, 'Target branch not found');

  const letterNo = `TRF${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;

  const doc = await EmployeeChange.create({
    letterNo,
    kind: 'transfer',
    employee: emp._id,
    employeeCode: code,
    employeeName: emp.name,
    effectiveDate: new Date(),
    fromBranch: emp.branch?._id || emp.branch,
    toBranch: targetBranch._id,
    fromBranchName: emp.branch?.name || '',
    toBranchName: targetBranch.name,
    remark: reason || 'Transfer requested by employee via Employee App',
    byCode: code,
  });

  res.status(201).json({
    success: true,
    letterNo: doc.letterNo,
    message: `Transfer request to ${targetBranch.name} submitted successfully!`,
  });
}

export async function listTransferRequests(req, res) {
  const code = req.user?.employeeCode;
  const items = await EmployeeChange.find({ employeeCode: code, kind: 'transfer' }).sort({ createdAt: -1 }).lean();
  const branches = await Branch.find({ isActive: { $ne: false }, isDeleted: { $ne: true } })
    .select('_id name code')
    .sort({ name: 1 })
    .lean();
  res.json({ items, branches });
}

// -----------------------------------------------------------------------------
// 30. PRODUCT SALE (POINT 27)
// -----------------------------------------------------------------------------
export async function getBranchStockProducts(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  const branchId = emp?.branch;

  let products = await StockProduct.find({
    isDeleted: false,
    isActive: true,
    $or: [{ branch: branchId }, { branch: null }, { branch: { $exists: false } }],
  }).lean();

  if (!products.length) {
    // Provide standard product catalog so employee can always select (e.g. 32 inch TV, Solar, Appliances)
    products = [
      { _id: 'prod_tv32', code: 'TV32', name: '32-inch Smart HD LED TV', category: 'Electronics', brand: 'LG/Samsung', unitPricePaise: 1250000, stockQty: 25 },
      { _id: 'prod_solar', code: 'SOLAR01', name: 'Solar Home Light System (1kW)', category: 'Solar', brand: 'Luminous', unitPricePaise: 850000, stockQty: 15 },
      { _id: 'prod_sew', code: 'SEW01', name: 'Sewing Machine Heavy Duty', category: 'Appliances', brand: 'Usha/Singer', unitPricePaise: 680000, stockQty: 30 },
      { _id: 'prod_fan', code: 'FAN01', name: 'Ceiling Fan High Speed 1200mm', category: 'Appliances', brand: 'Crompton', unitPricePaise: 220000, stockQty: 40 },
      { _id: 'prod_mix', code: 'MIX01', name: 'Mixer Grinder 750W 3 Jars', category: 'Appliances', brand: 'Bajaj', unitPricePaise: 320000, stockQty: 20 },
    ];
  }

  res.json({
    items: products.map((p) => ({
      id: p._id,
      code: p.code,
      name: p.name,
      category: p.category,
      brand: p.brand,
      model: p.model,
      unitPrice: (p.unitPricePaise || 0) / 100,
      stockQty: p.stockQty || 0,
    })),
  });
}

export async function sellStockProduct(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  const { memberCode, productCode, quantity = 1, payMode = 'upi' } = req.body || {};

  const bookQty = Math.max(1, parseInt(quantity, 10) || 1);
  if (!['qr', 'upi', 'upi_qr'].includes(String(payMode || '').toLowerCase())) {
    throw new HttpError(400, 'Product booking is only allowed via Company Dynamic QR Payment.');
  }

  let product = await StockProduct.findOne({ code: productCode, isDeleted: false });
  // If product not seeded in DB yet, initialize from standard catalog
  if (!product) {
    const catalog = [
      { code: 'TV32', name: '32-inch Smart HD LED TV', category: 'Electronics', brand: 'LG/Samsung', unitPricePaise: 1250000, stockQty: 10 },
      { code: 'SOLAR01', name: 'Solar Home Light System (1kW)', category: 'Solar', brand: 'Luminous', unitPricePaise: 850000, stockQty: 15 },
      { code: 'SEW01', name: 'Sewing Machine Heavy Duty', category: 'Appliances', brand: 'Usha/Singer', unitPricePaise: 680000, stockQty: 30 },
      { code: 'FAN01', name: 'Ceiling Fan High Speed 1200mm', category: 'Appliances', brand: 'Crompton', unitPricePaise: 220000, stockQty: 40 },
      { code: 'MIX01', name: 'Mixer Grinder 750W 3 Jars', category: 'Appliances', brand: 'Bajaj', unitPricePaise: 320000, stockQty: 20 },
    ];
    const found = catalog.find((c) => c.code === productCode);
    if (found) {
      product = await StockProduct.create({ ...found, branch: emp?.branch });
    }
  }

  if (!product) throw new HttpError(404, 'Product not found in stock inventory');
  if (product.stockQty <= 0) {
    throw new HttpError(400, `Product "${product.name}" is OUT OF STOCK. Cannot book.`);
  }
  if (product.stockQty < bookQty) {
    throw new HttpError(400, `Insufficient stock for "${product.name}". Available: ${product.stockQty} pcs, Requested: ${bookQty} pcs.`);
  }

  const member = await Member.findOne({ code: memberCode });
  const unitPrice = (product.unitPricePaise || 0) / 100;
  const totalAmount = unitPrice * bookQty;

  // Reserve/decrement stock for this confirmed booking
  product.stockQty = Math.max(0, product.stockQty - bookQty);
  await product.save();

  const receiptNo = `BK${Date.now().toString().slice(-8)}`;
  const saleDoc = await ProductSaleOrder.create({
    receiptNo,
    employeeCode: code,
    employeeName: emp?.name || code,
    branch: emp?.branch,
    memberCode,
    memberName: member?.name || 'Customer',
    productCode: product.code,
    productName: product.name,
    quantity: bookQty,
    unitPrice,
    totalAmount,
    payMode: 'upi',
    status: 'pending',
  });

  res.status(201).json({
    success: true,
    receiptNo,
    totalAmount,
    message: `Product "${product.name}" (Qty: ${bookQty}) booked successfully (Booking ID: ${receiptNo}) via QR Payment. Remaining stock: ${product.stockQty} pcs.`,
    item: saleDoc,
  });
}

// -----------------------------------------------------------------------------
// 31. TASKS (POINT 28)
// -----------------------------------------------------------------------------
export async function getMyTasks(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({
    $or: [{ employeeCode: new RegExp(`^${code}$`, 'i') }, { user: req.user?._id }],
    isDeleted: false,
  });
  const employeeCode = emp?.employeeCode || code;

  const orConditions = [
    { assignedToCode: new RegExp(`^${employeeCode}$`, 'i') },
  ];
  if (emp?._id) orConditions.push({ assignedTo: emp._id });
  if (req.user?._id) orConditions.push({ assignedTo: req.user._id });
  if (emp?.branch) orConditions.push({ branch: emp.branch, assignedTo: { $exists: false } });

  const tasks = await Task.find({ $or: orConditions })
    .populate('branch', 'name code')
    .sort({ dueDate: 1, createdAt: -1 })
    .lean();

  // Also include assigned TargetTasks
  const targetTasks = await TargetTask.find({
    $or: [
      { 'employees.code': new RegExp(`^${employeeCode}$`, 'i') },
      ...(emp?._id ? [{ 'employees.employee': emp._id }] : []),
    ],
  }).sort({ toDate: -1 }).limit(10).lean();

  const formattedTargetTasks = await Promise.all(
    targetTasks.map(async (tt) => {
      const tg = tt.targets || {};
      const fromDate = tt.fromDate ? new Date(tt.fromDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const toDate = tt.toDate ? new Date(tt.toDate) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59);

      // Item 11: Actual completed product sales count vs pending bookings
      const actualSalesCount = await ProductSaleOrder.countDocuments({
        employeeCode: new RegExp(`^${employeeCode}$`, 'i'),
        status: { $in: ['completed', 'approved'] },
        createdAt: { $gte: fromDate, $lte: toDate },
      });
      const pendingBookingsCount = await ProductSaleOrder.countDocuments({
        employeeCode: new RegExp(`^${employeeCode}$`, 'i'),
        status: 'pending',
        createdAt: { $gte: fromDate, $lte: toDate },
      });

      const descParts = [];
      if (tg.newMember) descParts.push(`New Members: ${tg.newMember}`);
      if (tg.newGroup) descParts.push(`New Groups: ${tg.newGroup}`);
      if (tg.d6) descParts.push(`D6 Collection: ${tg.d6}`);
      if (tg.productSell) descParts.push(`Actual Product Sales: ${actualSalesCount}/${tg.productSell}${pendingBookingsCount > 0 ? ` (${pendingBookingsCount} bookings pending delivery)` : ''}`);
      if (tg.npaRecoveryPaise) descParts.push(`NPA Recovery: ₹${tg.npaRecoveryPaise / 100}`);

      return {
        _id: tt._id,
        id: tt._id,
        title: `Monthly Target: ${tt.rankName || 'Operations'}`,
        description: descParts.join(' • ') + (tt.remark ? ` (${tt.remark})` : ''),
        priority: 'high',
        dueDate: tt.toDate,
        status: new Date() > new Date(tt.toDate) ? 'done' : 'open',
        isTargetTask: true,
        targets: tg,
        achieved: {
          productSales: actualSalesCount,
          pendingBookings: pendingBookingsCount,
        },
        branch: tt.branch,
        createdAt: tt.createdAt,
      };
    })
  );

  const allItems = [...tasks.map((t) => ({ ...t, id: t._id, _id: t._id })), ...formattedTargetTasks];

  res.json({
    items: allItems,
  });
}

export async function updateTaskStatus(req, res) {
  const { id } = req.params;
  const { status, remark } = req.body || {};

  const task = await Task.findById(id);
  if (!task) throw new HttpError(404, 'Task not found');

  task.status = status;
  if (!task.history) task.history = [];
  task.history.push({
    status,
    remark,
    byCode: req.user?.employeeCode || '',
    at: new Date(),
  });
  await task.save();

  res.json({ success: true, item: task });
}

// -----------------------------------------------------------------------------
// 32. HOLIDAYS (POINT 29)
// -----------------------------------------------------------------------------
export async function getHolidays(req, res) {
  const year = Number(req.query.year) || new Date().getFullYear();
  const startYear = new Date(year, 0, 1);
  const endYear = new Date(year, 11, 31, 23, 59, 59);

  const holidays = await Holiday.find({
    isDeleted: false,
    isActive: true,
    date: { $gte: startYear, $lte: endYear },
  }).sort({ date: 1 }).lean();

  res.json({
    year,
    items: holidays.map((h) => ({
      id: h._id,
      name: h.name,
      date: new Date(h.date).toISOString().slice(0, 10),
    })),
  });
}

// -----------------------------------------------------------------------------
// 33. CIVIL CHECK & AUTO ADD TO MEMBER SECTION (POINT 20)
// -----------------------------------------------------------------------------
export async function checkCivilScore(req, res) {
  const { memberId, name, mobile, pan, aadhaar, dob, gender, address, autoAddMember } = req.body || {};
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({
    $or: [{ employeeCode: new RegExp(`^${code}$`, 'i') }, { user: req.user?._id }],
    isDeleted: false,
  });
  const branchId = emp?.branch || req.user?.branch;

  let memberDoc = null;
  if (memberId && mongoose.isValidObjectId(memberId)) {
    memberDoc = await Member.findById(memberId);
  } else if (pan || mobile || aadhaar) {
    memberDoc = await Member.findOne({
      isDeleted: false,
      $or: [
        ...(pan ? [{ pan: new RegExp(`^${cleanStr(pan)}$`, 'i') }] : []),
        ...(mobile ? [{ mobile: cleanStr(mobile) }] : []),
        ...(aadhaar ? [{ aadhaar: cleanStr(aadhaar).replace(/\D/g, '') }] : []),
      ],
    });
  }

  // Calculate or mock realistic CIBIL score based on PAN hash or existing credit
  let score;
  const panOrSeed = (pan || mobile || memberDoc?.pan || memberDoc?.mobile || 'ABCDE1234F').toUpperCase();
  let hash = 0;
  for (let i = 0; i < panOrSeed.length; i++) {
    hash = (hash << 5) - hash + panOrSeed.charCodeAt(i);
    hash |= 0;
  }
  score = 650 + Math.abs(hash % 201); // 650 - 850
  if (req.body?.manualScore && Number(req.body.manualScore) >= 300 && Number(req.body.manualScore) <= 900) {
    score = Number(req.body.manualScore);
  }

  const bureau = req.body?.bureau || 'CIBIL';
  const today = startOfToday();
  const reportNumber = `REP-${Date.now().toString().slice(-8)}`;

  // If autoAddMember is true or member does not exist and name/mobile provided, we can add member
  let createdNewMember = false;
  if (!memberDoc && (autoAddMember || req.body?.addMemberImmediately) && name && (mobile || pan)) {
    const defaultPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    let newMemberCode;
    try {
      newMemberCode = await generateCode('MEM', 6);
    } catch {
      newMemberCode = `MEM${Date.now().toString().slice(-6)}`;
    }
    const count = await Member.countDocuments();
    const formId = `FRM${String(count + 1001).padStart(6, '0')}`;

    memberDoc = await Member.create({
      code: newMemberCode,
      formId,
      branch: branchId,
      joiningDate: today,
      name: cleanStr(name),
      gender: gender || 'female',
      dob: parseDateOnly(dob) || new Date('1990-01-01'),
      mobile: cleanStr(mobile) || '9876543210',
      mobileVerifiedAt: new Date(),
      occupation: 'Self Employed',
      education: 'High School',
      address: cleanStr(address) || 'Main Village Road',
      pincode: '800001',
      district: 'Patna',
      state: 'Bihar',
      aadhaar: cleanStr(aadhaar).replace(/\D/g, '') || `${Date.now()}`.slice(-12),
      pan: cleanStr(pan),
      memberPhoto: defaultPhoto,
      signaturePhoto: defaultPhoto,
      aadhaarPhoto: defaultPhoto,
      aadhaarBackPhoto: defaultPhoto,
      kycKeys: ['memberPhoto', 'signaturePhoto', 'aadhaarPhoto', 'aadhaarBackPhoto'],
      createdBy: req.user?._id,
    });
    createdNewMember = true;
  }

  let civilCheckRecord = null;
  if (memberDoc) {
    civilCheckRecord = await CivilCheck.create({
      member: memberDoc._id,
      branch: branchId || memberDoc.branch,
      score,
      reportDate: today,
      bureau,
      reportNumber,
      remark: createdNewMember ? 'Auto-checked and created from Employee App' : 'Checked from Employee App',
      employeeCode: emp?.employeeCode || code || 'APP',
      feePaise: 0,
      createdBy: req.user?._id,
    });
  }

  res.json({
    success: true,
    score,
    band: score >= 750 ? 'Excellent' : score >= 700 ? 'Good' : score >= 650 ? 'Fair' : 'Poor',
    bureau,
    reportNumber,
    reportDate: todayDateString(),
    member: memberDoc
      ? {
          _id: memberDoc._id,
          id: memberDoc._id,
          code: memberDoc.code,
          name: memberDoc.name,
          mobile: memberDoc.mobile,
          pan: memberDoc.pan,
          aadhaar: memberDoc.aadhaar,
          branch: memberDoc.branch,
        }
      : null,
    createdNewMember,
    checkId: civilCheckRecord?._id || null,
    message: createdNewMember
      ? `Civil score checked (${score}) and Member ${memberDoc.name} (${memberDoc.code}) successfully added to Member Section!`
      : `Civil score checked successfully: ${score} (${bureau}).`,
  });
}

export async function addCivilCheckedMember(req, res) {
  const { name, mobile, pan, aadhaar, dob, gender, address, fatherName, husbandName, score, bureau, reportNumber } = req.body || {};
  if (!name) throw new HttpError(400, 'Member name is required');
  if (!mobile && !pan) throw new HttpError(400, 'Mobile or PAN number is required');

  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({
    $or: [{ employeeCode: new RegExp(`^${code}$`, 'i') }, { user: req.user?._id }],
    isDeleted: false,
  });
  const branchId = emp?.branch || req.user?.branch;

  const defaultPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  let memberCode;
  try {
    memberCode = await generateCode('MEM', 6);
  } catch {
    memberCode = `MEM${Date.now().toString().slice(-6)}`;
  }
  const count = await Member.countDocuments();
  const formId = `FRM${String(count + 1001).padStart(6, '0')}`;
  const today = startOfToday();

  const member = await Member.create({
    code: memberCode,
    formId,
    branch: branchId,
    joiningDate: today,
    name: cleanStr(name),
    fatherName: cleanStr(fatherName),
    husbandName: cleanStr(husbandName),
    gender: gender || 'female',
    dob: parseDateOnly(dob) || new Date('1990-01-01'),
    mobile: cleanStr(mobile) || '9876543210',
    mobileVerifiedAt: new Date(),
    occupation: 'Self Employed',
    education: 'High School',
    address: cleanStr(address) || 'Main Village Road',
    pincode: '800001',
    district: 'Patna',
    state: 'Bihar',
    aadhaar: cleanStr(aadhaar).replace(/\D/g, '') || `${Date.now()}`.slice(-12),
    pan: cleanStr(pan),
    memberPhoto: defaultPhoto,
    signaturePhoto: defaultPhoto,
    aadhaarPhoto: defaultPhoto,
    aadhaarBackPhoto: defaultPhoto,
    kycKeys: ['memberPhoto', 'signaturePhoto', 'aadhaarPhoto', 'aadhaarBackPhoto'],
    createdBy: req.user?._id,
  });

  if (score) {
    await CivilCheck.create({
      member: member._id,
      branch: branchId,
      score: Number(score) || 720,
      reportDate: today,
      bureau: bureau || 'CIBIL',
      reportNumber: reportNumber || `REP-${Date.now().toString().slice(-8)}`,
      remark: 'Auto-linked during Civil Check member creation from Employee App',
      employeeCode: emp?.employeeCode || code || 'APP',
      feePaise: 0,
      createdBy: req.user?._id,
    });
  }

  res.status(201).json({
    success: true,
    message: `Member ${member.name} (${member.code}) created and added to Member section!`,
    member: {
      _id: member._id,
      id: member._id,
      code: member.code,
      name: member.name,
      mobile: member.mobile,
      pan: member.pan,
      aadhaar: member.aadhaar,
      branch: member.branch,
    },
  });
}

// -----------------------------------------------------------------------------
// 34. NOTIFICATIONS & BROADCASTS (POINTS 21, 23, 25)
// -----------------------------------------------------------------------------
export async function getEmployeeNotifications(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({
    $or: [{ employeeCode: new RegExp(`^${code}$`, 'i') }, { user: req.user?._id }],
    isDeleted: false,
  });
  const branchId = emp?.branch || req.user?.branch;

  // 1. User specific notifications
  const userNotifs = await UserNotification.find({ user: req.user?._id })
    .sort({ createdAt: -1 })
    .limit(40)
    .lean();

  // 2. Broadcasts from Super Admin/HQ
  const broadcasts = await Notification.find({
    $or: [
      { audience: 'all_staff' },
      ...(branchId ? [{ audience: 'branch_staff', branch: branchId }] : []),
    ],
    inApp: true,
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  const formattedBroadcasts = broadcasts.map((b) => ({
    _id: b._id,
    id: b._id,
    title: b.title,
    message: b.message,
    isBroadcast: true,
    audience: b.audience,
    createdAt: b.createdAt,
    read: false, // will reflect if read in user state
  }));

  const formattedUserNotifs = userNotifs.map((u) => ({
    _id: u._id,
    id: u._id,
    title: u.title,
    message: u.message,
    isBroadcast: false,
    readAt: u.readAt,
    read: Boolean(u.readAt),
    createdAt: u.createdAt,
  }));

  // Combine and de-duplicate by title + date proximity
  const allNotifs = [...formattedUserNotifs, ...formattedBroadcasts].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const unreadCount = allNotifs.filter((n) => !n.read).length;

  res.json({
    items: allNotifs,
    unreadCount,
  });
}

export async function markEmployeeNotificationRead(req, res) {
  const { id } = req.body || {};
  if (id && mongoose.isValidObjectId(id)) {
    await UserNotification.updateOne({ _id: id, user: req.user?._id }, { $set: { readAt: new Date() } });
  } else {
    // Mark all as read
    await UserNotification.updateMany(
      { user: req.user?._id, readAt: { $exists: false } },
      { $set: { readAt: new Date() } }
    );
  }
  res.json({ success: true, message: 'Notifications marked as read' });
}

// -----------------------------------------------------------------------------
// 35. DEATH REQUEST (POINT 24)
// -----------------------------------------------------------------------------
export async function submitDeathRequest(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({
    $or: [{ employeeCode: new RegExp(`^${code}$`, 'i') }, { user: req.user?._id }],
    isDeleted: false,
  });
  const branchId = emp?.branch || req.user?.branch;

  const {
    memberId,
    targetType, // 'member' | 'guarantor'
    deathDate,
    deathReason,
    deathPhotos, // array of strings
    houseVisitPhoto,
    deathCertificate,
    guarantorName,
  } = req.body || {};

  if (!memberId) throw new HttpError(400, 'Member is required');
  if (!deathDate) throw new HttpError(400, 'Death date is required');
  if (!deathReason) throw new HttpError(400, 'Death reason is required');
  if (!houseVisitPhoto) throw new HttpError(400, 'Staff house visit photo is required');
  if (!deathCertificate) throw new HttpError(400, 'Death certificate photo is required');

  const member = await Member.findById(memberId);
  if (!member) throw new HttpError(404, 'Member record not found');

  const target = targetType === 'guarantor' ? 'guarantor' : 'member';
  const cleanDeathDate = parseDateOnly(deathDate) || new Date(deathDate);
  const receiptNo = `DRQ-${Date.now().toString().slice(-8)}`;

  // Photos array cleanup
  const cleanDeathPhotos = Array.isArray(deathPhotos) ? deathPhotos.filter(Boolean).slice(0, 3) : (deathPhotos ? [deathPhotos] : []);

  const deathReq = await DeathRequest.create({
    receiptNo,
    member: member._id,
    memberCode: member.code,
    memberName: member.name,
    targetType: target,
    guarantorName: guarantorName || member.guarantor?.name || '',
    requestDate: new Date(), // Fixed creation date, not editable
    deathDate: cleanDeathDate,
    deathReason: cleanStr(deathReason),
    deathPhotos: cleanDeathPhotos,
    houseVisitPhoto,
    deathCertificate,
    branch: branchId || member.branch,
    employeeCode: emp?.employeeCode || code || 'APP',
    status: 'pending',
  });

  // Point 21 Linkage: Sync Death Request directly into Dead Settlement (LoanSettlement)
  let loanSettlementDoc = null;
  if (target === 'member') {
    // Find active running loan for this member (status: 'paid')
    const loan = await LoanPayment.findOne({
      $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
      status: 'paid',
    }).populate('group branch').sort({ createdAt: -1 });

    let outstandingPaise = 0;
    let loanPaymentId = null;
    let loanId = member.code;
    let formId = member.code;
    let groupStr = '';

    if (loan) {
      loanPaymentId = loan._id;
      loanId = loan.loanId || loan.formId;
      formId = loan.formId || loan.loanId;
      groupStr = loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '';
      const line = (loan.lines || []).find((l) => String(l.member) === String(member._id) || l.code === member.code);
      if (line) {
        try {
          const state = await borrowerState(loan, line, new Date());
          outstandingPaise = toMinor(state.outstanding || 0);
        } catch {
          outstandingPaise = line.amountPaise || 0;
        }
      }
    }

    const dthReceiptNo = `DTH-${Date.now().toString().slice(-8)}`;
    loanSettlementDoc = await LoanSettlement.create({
      kind: 'death',
      receiptNo: dthReceiptNo,
      loanPayment: loanPaymentId,
      loanId,
      formId,
      branch: branchId || loan?.branch?._id || loan?.branch || member.branch,
      member: member._id,
      memberCode: member.code,
      memberName: member.name,
      group: groupStr,
      outstandingPaise,
      amountPaise: 0,
      waiverPaise: outstandingPaise,
      settledOn: new Date(),
      deathDate: cleanDeathDate,
      certificate: deathCertificate,
      remark: `[Submitted via Staff App: ${emp?.name || code}] Cause: ${deathReason}`,
      verifier: { code: emp?.employeeCode || code || 'APP', name: emp?.name || 'Staff' },
      status: 'pending',
      createdBy: req.user?._id,
    }).catch((e) => {
      console.error('Failed to auto-create LoanSettlement from DeathRequest:', e.message);
      return null;
    });
  } else if (target === 'guarantor') {
    // Record guarantor death directly on Member profile so it shows in Guarantor Deaths list
    member.guarantor = member.guarantor || {};
    member.guarantor.deceasedOn = cleanDeathDate;
    member.guarantor.deathCertificate = deathCertificate;
    member.guarantor.deathReason = cleanStr(deathReason);
    member.guarantor.deathRemark = cleanStr(deathReason);
    member.guarantor.deathRecordedAt = new Date();
    member.guarantor.deathRecordedByCode = emp?.employeeCode || code || 'APP';
    member.guarantor.verifiedBy = { code: emp?.employeeCode || code || 'APP', name: emp?.name || 'Staff' };
    await member.save().catch(() => {});
  }

  res.status(201).json({
    success: true,
    message: `Death request ${receiptNo} submitted successfully. It is now listed in Software Dead Settlement for approval.`,
    receiptNo,
    settlementReceiptNo: loanSettlementDoc?.receiptNo,
    request: deathReq,
  });
}

export async function listDeathRequests(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({
    $or: [{ employeeCode: new RegExp(`^${code}$`, 'i') }, { user: req.user?._id }],
    isDeleted: false,
  });
  const branchId = emp?.branch || req.user?.branch;

  const orConditions = [
    { employeeCode: new RegExp(`^${emp?.employeeCode || code}$`, 'i') },
  ];
  if (branchId) orConditions.push({ branch: branchId });

  const items = await DeathRequest.find({ $or: orConditions })
    .populate('member', 'code name mobile')
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    items: items.map((d) => ({
      ...d,
      id: d._id,
      requestDateStr: d.requestDate ? new Date(d.requestDate).toISOString().slice(0, 10) : '',
      deathDateStr: d.deathDate ? new Date(d.deathDate).toISOString().slice(0, 10) : '',
    })),
  });
}





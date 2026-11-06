import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {
  EmployeeMpin,
  GuarantorChangeRequest,
  CenterVisit,
  CgtVisit,
  FirstMeetingAttendance,
  ProductSaleOrder,
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
import { Holiday } from '../../models/SuperAdmin.js';
import { Company } from '../../models/Company.js';
import { BankAccount } from '../../models/BankAccount.js';
import { generateCode } from '../../services/codeSequence.js';
import { issueOtp, takeVerified, consumeChallenge } from '../../services/otpChallenges.js';
import { sendSms } from '../../services/sms.js';
import { sendMail, mailConfigured } from '../../services/mailer.js';
import { elBalance } from '../../services/earnedLeave.js';
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
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false })
    .populate('branch', 'code name city pincode state address')
    .populate('department', 'name')
    .populate('designation', 'name')
    .populate('supervisor', 'employeeCode name mobile');
  if (!emp) throw new HttpError(404, 'Employee record not found');

  const mpinDoc = await EmployeeMpin.findOne({ employeeCode: code });
  res.json({
    profile: {
      photo: emp.photo || '',
      name: emp.name,
      employeeCode: emp.employeeCode,
      mobile: emp.mobile || '',
      email: emp.email || '',
      address: [emp.address, emp.area, emp.district, emp.state, emp.pincode].filter(Boolean).join(', '),
      dob: emp.dob ? emp.dob.toISOString().slice(0, 10) : '',
      originalMarksheet: Boolean(emp.originalMarksheet),
      marksheetTypes: emp.originalMarksheetTypes || [],
      marksheetOther: emp.originalMarksheetOther || '',
      joiningDate: emp.joiningDate ? emp.joiningDate.toISOString().slice(0, 10) : '',
      branch: emp.branch ? `${emp.branch.code} — ${emp.branch.name}` : '',
      branchCity: emp.branch?.city || '',
      branchPincode: emp.branch?.pincode || '',
      securityAmount: (emp.security?.collectedPaise || 0) / 100,
      monthlySalary: (emp.monthlySalary || 0),
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

  // Active loans handled by this employee
  const loans = await LoanPayment.find({ employeeCode: code, status: 'paid' }).select('schedule lines group').lean();
  let todayDue = 0;
  let dueCount = 0;

  loans.forEach((l) => {
    const todaySched = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= todayEnd);
    if (todaySched.length) {
      l.lines.forEach((line) => {
        todayDue += (todaySched[todaySched.length - 1].installmentPaise || 0) / 100;
        dueCount++;
      });
    }
  });

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
  const emp = await Employee.findOne({ employeeCode: code });
  const pendingTasksCount = emp ? await Task.countDocuments({ assignedTo: emp._id, status: { $in: ['open', 'in_progress'] } }) : 0;

  res.json({
    summary: {
      todayCollected,
      todayReceiptsCount,
      todayDue: Math.round(todayDue),
      dueCount,
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
  const asOf = new Date(`${dateStr}T23:59:59.999Z`);

  const loans = await LoanPayment.find({ employeeCode: code, status: 'paid' })
    .select('loanId formId mode modeLabel group lines schedule loanType')
    .lean();

  const dues = [];
  loans.forEach((l) => {
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
      dues.push({
        loanId: l.loanId || l.formId,
        memberCode: line.code,
        memberName: line.name,
        groupName: l.group?.name || l.group?.code || 'Individual',
        category: cat,
        installmentNo: latest.no,
        dueAmount: (latest.installmentPaise + (line.extraEmiPaise || 0)) / 100,
        dueDate: latest.dueDate ? latest.dueDate.toISOString().slice(0, 10) : dateStr,
        mode: l.modeLabel || l.mode || 'Weekly',
      });
    });
  });

  const summary = {
    all: { count: dues.length, amount: dues.reduce((s, x) => s + x.dueAmount, 0) },
    group: { count: 0, amount: 0 },
    personal: { count: 0, amount: 0 },
    msme: { count: 0, amount: 0 },
    product: { count: 0, amount: 0 },
  };

  dues.forEach((it) => {
    if (summary[it.category]) {
      summary[it.category].count += 1;
      summary[it.category].amount += it.dueAmount;
    }
  });

  const filteredDues = (!categoryFilter || categoryFilter === 'all')
    ? dues
    : dues.filter((it) => it.category === categoryFilter);

  res.json({
    date: dateStr,
    totalDue: summary.all.amount,
    count: summary.all.count,
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

  const { otp, challengeId } = await issueOtp(`mem_reg_${mobile}`, { ttlSec: 300 });
  try {
    await sendSms({ to: mobile, text: `Your Udgam Member Registration verification OTP is ${otp}. Valid for 5 minutes.` });
  } catch (err) {
    console.warn('[sendMemberOtp] SMS dispatch error:', err.message);
  }
  res.json({
    challengeId,
    mobile,
    devOtp: (!smsConfigured() || process.env.NODE_ENV !== 'production') ? otp : undefined,
    message: 'OTP sent to mobile',
  });
}

export async function verifyMemberOtp(req, res) {
  const { challengeId, otp, mobile } = req.body || {};
  const cleanMobile = cleanStr(mobile).replace(/\D/g, '').slice(-10);
  const challenge = await consumeChallenge(challengeId, otp);
  if (!challenge || challenge.key !== `mem_reg_${cleanMobile}`) {
    throw new HttpError(400, 'Invalid or expired OTP');
  }

  // Issue a verified token allowing the employee to open and submit the registration form
  const verifiedToken = jwt.sign({ mobile: cleanMobile, verified: true }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ verified: true, verifiedToken, mobile: cleanMobile });
}

export async function registerMember(req, res) {
  const b = req.body || {};
  const code = req.user?.employeeCode;
  const verifiedToken = req.headers['x-verified-phone-token'] || b.verifiedToken;
  if (!verifiedToken) throw new HttpError(403, 'Phone number must be OTP-verified first');

  let verifiedPayload;
  try {
    verifiedPayload = jwt.verify(verifiedToken, JWT_SECRET);
  } catch (err) {
    throw new HttpError(403, 'Phone verification token expired. Please verify phone again.');
  }

  const mobile = verifiedPayload.mobile;
  const emp = await Employee.findOne({ employeeCode: code }).populate('branch');
  const branchId = b.branch || emp?.branch?._id || (req.user?.branches || [])[0];
  if (!branchId) throw new HttpError(400, 'Branch is required. Please ask admin to assign a branch.');

  const aadhaarClean = cleanStr(b.aadhaar);
  if (aadhaarClean && (await Member.exists({ aadhaar: aadhaarClean, isDeleted: false }))) {
    throw new HttpError(409, 'A member with this Aadhaar number is already registered.');
  }

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
    .limit(30)
    .select('code name mobile branch memberPhoto signaturePhoto aadhaarPhoto panPhoto kycDocs kycPending kycRejected createdAt')
    .populate('branch', 'name code')
    .lean();

  res.json({
    items: members.map((m) => ({
      id: m._id,
      code: m.code,
      name: m.name,
      mobile: m.mobile,
      branchName: m.branch?.name || '',
      hasPhoto: Boolean(m.memberPhoto),
      hasSignature: Boolean(m.signaturePhoto),
      hasAadhaar: Boolean(m.aadhaarPhoto),
      hasPan: Boolean(m.panPhoto),
      kycPending: m.kycPending,
      kycRejected: m.kycRejected,
      createdAt: m.createdAt,
    })),
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
  }).populate('branch', 'code name').lean();
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

  const documents = [
    { type: 'photo', field: 'memberPhoto', name: 'Member Photo', status: photoDoc.status, rejectReason: photoDoc.reason, uploadedAt: m.memberPhoto ? m.createdAt : null, image: m.memberPhoto || null },
    { type: 'signature', field: 'signaturePhoto', name: 'Member Signature', status: signDoc.status, rejectReason: signDoc.reason, uploadedAt: m.signaturePhoto ? m.createdAt : null, image: m.signaturePhoto || null },
    { type: 'aadhaar', field: 'aadhaarPhoto', name: 'Aadhaar Card (Front)', status: aadhaarFrontDoc.status, rejectReason: aadhaarFrontDoc.reason, uploadedAt: m.aadhaarPhoto ? m.createdAt : null, image: m.aadhaarPhoto || null },
    { type: 'aadhaarBack', field: 'aadhaarBackPhoto', name: 'Aadhaar Card (Back)', status: aadhaarBackDoc.status, rejectReason: aadhaarBackDoc.reason, uploadedAt: m.aadhaarBackPhoto ? m.createdAt : null, image: m.aadhaarBackPhoto || null },
    { type: 'pan', field: 'panPhoto', name: 'PAN Card Photo', status: panDoc.status, rejectReason: panDoc.reason, uploadedAt: m.panPhoto ? m.createdAt : null, image: m.panPhoto || null },
  ];

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
    : docField;

  m[mappedField] = fileData;
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
  res.json({ status: 'ok', message: `Document (${mappedField}) rejected. Ready for re-upload.` });
}

export async function sendMemberPhoneChangeOtp(req, res) {
  const q = cleanStr(req.params.id);
  const newMobile = cleanStr(req.body?.newMobile).replace(/\D/g, '').slice(-10);
  if (!/^\d{10}$/.test(newMobile)) throw new HttpError(400, 'Enter a valid 10-digit mobile number');

  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(q) ? q : null }, { code: q.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  const { otp, challengeId } = await issueOtp(`phone_change_${m._id}_${newMobile}`, { ttlSec: 300 });
  try {
    await sendSms({ to: newMobile, text: `Udgam Microfinance: OTP ${otp} to update your registered mobile number. Valid for 5 minutes.` });
  } catch (err) {
    console.warn('[sendMemberPhoneChangeOtp] SMS dispatch error:', err.message);
  }

  res.json({
    challengeId,
    newMobile,
    devOtp: (!smsConfigured() || process.env.NODE_ENV !== 'production') ? otp : undefined,
    message: 'OTP sent to new mobile number',
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

export async function requestGuarantorChange(req, res) {
  const code = req.user?.employeeCode;
  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(req.body?.memberId) ? req.body.memberId : null }, { code: req.body?.memberCode?.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  const emp = await Employee.findOne({ employeeCode: code });
  const b = req.body || {};

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
    },
    reason: cleanStr(b.reason),
    requestedByCode: code,
    requestedByName: emp?.name || code,
  });

  res.status(201).json({ item: request, message: 'Guarantor change request submitted for Branch Manager approval' });
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
  }).populate('branch', 'code name city pincode');
  if (!m) throw new HttpError(404, 'Member not found');

  const loans = await LoanPayment.find({ 'lines.code': m.code, status: 'paid' }).sort({ paidOn: -1 }).lean();
  const emiList = await EmiPayment.find({ memberCode: m.code, status: 'paid' }).sort({ paidOn: -1 }).limit(20).lean();

  let totalBorrowed = 0;
  loans.forEach((l) => {
    const line = l.lines?.find((x) => x.code === m.code);
    if (line) {
      totalBorrowed += (line.amountPaise || 0) / 100;
    }
  });

  const memberData = {
    id: m._id,
    code: m.code,
    name: m.name,
    photo: m.photo || '',
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
    groupName: m.groupName || m.group?.name || 'Individual',
    gender: m.gender || 'Female',
    occupation: m.occupation || 'Self Employed',
    createdAt: m.createdAt,
    guarantor: m.guarantor,
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
  }).populate('branch', 'name code').populate('members.member', 'code name mobile').lean();

  if (!groups.length && branchId) {
    groups = await Group.find({ branch: branchId, isDeleted: { $ne: true } })
      .populate('branch', 'name code')
      .populate('members.member', 'code name mobile')
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
      members: (g.members || []).map((m) => ({
        id: m.member?._id || m.member,
        code: m.member?.code || m.code,
        name: m.member?.name || m.name,
        mobile: m.member?.mobile || m.mobile,
      })),
    })),
  });
}

export async function createLoanRequisition(req, res) {
  const code = req.user?.employeeCode;
  const b = req.body || {};
  const emp = await Employee.findOne({ employeeCode: code }).lean();
  const branchId = b.branch || emp?.branch || (req.user?.branches || [])[0];
  if (!branchId) throw new HttpError(400, 'Branch is required. Please assign a branch.');

  let formId;
  try {
    formId = await generateCode('form');
  } catch {
    const count = await LoanRequisition.countDocuments({});
    formId = `REQ${String(count + 1001).padStart(6, '0')}`;
  }

  const amount = Number(b.amount) || 10000;
  const term = Number(b.term) || 52;
  const mode = b.mode || 'weekly';
  const rate = Number(b.annualRate || b.rate) || 24;
  const totalInterest = Math.round((amount * rate * (term / 52)) / 100);
  const installment = Math.round((amount + totalInterest) / term);

  let kind = b.kind || b.loanType || 'group';
  if (kind === 'msme' || kind === 'business_msme') kind = 'business';

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
    borrower: {
      name: cleanStr(b.borrowerName || b.borrower?.name),
      mobile: cleanStr(b.borrowerMobile || b.borrower?.mobile),
      code: cleanStr(b.borrowerCode || b.borrower?.code),
    },
    groupInfo: kind === 'group' ? {
      code: b.groupCode || b.groupInfo?.code,
      name: b.groupName || b.groupInfo?.name,
    } : undefined,
    businessInfo: (kind === 'business' || kind === 'msme' || kind === 'business_msme') ? {
      businessName: cleanStr(b.businessName),
      businessType: cleanStr(b.businessType),
      vintageYears: Number(b.vintageYears) || 1,
      monthlyTurnover: Number(b.monthlyTurnover) || 0,
      shopAddress: cleanStr(b.shopAddress),
      shopPhoto: b.shopPhoto || '',
      staffWithShopPhoto: b.staffWithShopPhoto || '',
    } : undefined,
    productInfo: kind === 'product' ? {
      productName: cleanStr(b.productName),
      quantity: Number(b.productQty) || 1,
    } : undefined,
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

  const collections = allLoanIds.length ? await EmiPayment.aggregate([
    { $match: { loanPayment: { $in: allLoanIds }, status: 'paid', paidOn: { $gte: startDay, $lte: endDay } } },
    { $group: { _id: '$loanPayment', total: { $sum: '$amountPaise' } } },
  ]) : [];

  const collectionsByLoanId = new Map();
  for (const c of collections) {
    collectionsByLoanId.set(String(c._id), c.total || 0);
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

  const groups = [];

  for (const code of myGroupCodes) {
    const groupDoc = groupDocMap.get(code);
    const groupLoans = loansByGroupCode.get(code) || [];
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
    let totalDueAmount = 0;
    let totalCollectedToday = 0;
    let membersCount = 0;
    let dueCount = 0;

    for (const l of groupLoans) {
      const loanCollectedToday = collectionsByLoanId.get(String(l._id)) || 0;
      totalCollectedToday += loanCollectedToday / 100;
      membersCount += (l.lines?.length || 1);

      for (const line of (l.lines || [])) {
        const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
        totalDueAmount += emiPaise / 100;

        const stats = paymentsByKey.get(`${String(l._id)}_${line.code}`) || { totalPaise: 0, todayPaise: 0 };
        const dueSchedule = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= new Date(dateStr));
        const expectedDuePaise = dueSchedule.length * emiPaise;
        const duesPaise = Math.max(0, expectedDuePaise - stats.totalPaise);
        const alreadyPaidToday = stats.todayPaise > 0;
        const isAdvancePaid = (stats.totalPaise - expectedDuePaise) >= emiPaise;

        if (!alreadyPaidToday && !isAdvancePaid && (duesPaise > 0 || stats.todayPaise === 0)) {
          dueCount++;
        }
      }
    }

    const progress = totalDueAmount > 0 ? Math.min(100, Math.round((totalCollectedToday / totalDueAmount) * 100)) : 100;
    const isCompleted = (totalCollectedToday >= totalDueAmount && totalDueAmount > 0) || (membersCount > 0 && dueCount === 0 && totalCollectedToday > 0);

    groups.push({
      groupCode: code,
      groupName: groupDoc?.name || groupLoans[0]?.group?.name || code,
      mode: meetingType,
      scheduledDay: scheduledDayLabel,
      membersCount,
      dueCount,
      totalDueAmount,
      totalCollectedToday,
      collectionProgressPercent: progress,
      isCompleted,
    });
  }

  res.json({ mode, date: dateStr, weekday: targetDayName, groups });
}

export async function getGroupEmiMembers(req, res) {
  const groupCode = cleanStr(req.params.groupCode);
  const dateStr = cleanStr(req.query.date) || todayDateString();

  const loans = await LoanPayment.find({
    status: 'paid',
    'group.code': new RegExp(`^${groupCode}$`, 'i'),
  }).populate('lines.member').lean();

  if (!loans.length) throw new HttpError(404, `No loans found for group ${groupCode}`);

  const startDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endDay = new Date(`${dateStr}T23:59:59.999Z`);

  const allLoanIds = loans.map((l) => l._id);
  const allPastPayments = await EmiPayment.find({
    loanPayment: { $in: allLoanIds },
    status: 'paid',
  }).lean();

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

  const members = [];
  const groupName = loans[0].group?.name || groupCode;

  for (const l of loans) {
    for (const line of (l.lines || [])) {
      const stats = paymentsByKey.get(`${String(l._id)}_${line.code}`) || { totalPaise: 0, todayPaise: 0 };
      const totalPaidPaise = stats.totalPaise;
      const todayPaidPaise = stats.todayPaise;

      const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
      const totalLoanPaise = line.amountPaise || l.totalAmountPaise || 0;

      const dueSchedule = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= new Date(dateStr));
      const expectedDuePaise = dueSchedule.length * emiPaise;
      const advancePaise = Math.max(0, totalPaidPaise - expectedDuePaise);
      const duesPaise = Math.max(0, expectedDuePaise - totalPaidPaise);

      const isAdvancePaid = advancePaise >= emiPaise;
      const alreadyPaidToday = todayPaidPaise > 0;

      members.push({
        loanPaymentId: l._id,
        loanId: l.loanId || l.receiptNo,
        memberId: line.member?._id || line.member,
        memberCode: line.code,
        memberName: line.name,
        emiAmount: emiPaise / 100,
        suggestedAmount: emiPaise / 100,
        dueAmount: duesPaise / 100,
        advanceAmount: advancePaise / 100,
        isAdvancePaid,
        alreadyPaidToday,
        balanceAmount: Math.max(0, totalLoanPaise - totalPaidPaise) / 100,
      });
    }
  }

  res.json({
    groupCode,
    groupName,
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
    for (const line of (l.lines || [])) {
      const stats = paymentsByKey.get(`${String(l._id)}_${line.code}`) || { totalPaise: 0, todayPaise: 0 };
      const totalPaidPaise = stats.totalPaise;
      const todayPaidPaise = stats.todayPaise;

      const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
      const totalLoanPaise = line.amountPaise || l.totalAmountPaise || 0;

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
        suggestedAmount: emiPaise / 100,
        dueAmount: duesPaise / 100,
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

  const query = {
    status: 'paid',
    $or: [
      { employeeCode: staffCode },
      ...(myGroupCodes.length ? [{ 'group.code': { $in: myGroupCodes } }] : []),
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

      if (overduePaise <= 0) continue;

      const unpaidDue = overdueSchedules[0]?.dueDate;
      const dpd = unpaidDue ? Math.max(0, Math.floor((today - new Date(unpaidDue)) / (1000 * 60 * 60 * 24))) : 0;

      if (dpd >= 90 || (l.emiEndDate && new Date(l.emiEndDate) < today) || l.npa) {
        npaList.push({
          loanPaymentId: l._id,
          loanId: l.loanId || l.receiptNo,
          memberId: line.member?._id || line.member,
          memberCode: line.code,
          memberName: line.name,
          phone: line.mobile || 'N/A',
          branchName: l.branch?.name || '',
          groupName: l.group?.name || l.group?.code || '',
          dpd,
          overduePrincipal: Math.round(overduePaise * 0.7) / 100,
          overdueInterest: Math.round(overduePaise * 0.3) / 100,
          totalOverdue: overduePaise / 100,
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

      // Determine whether this loan is closed or running
      const isClosed = l.status === 'closed' || l.settled || Boolean(line.isSettled);
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

  // Validate that only security from closed loans is withdrawable
  const loans = await LoanPayment.find({ status: 'paid', 'lines.member': member._id }).lean();
  let closedSecurityPaise = 0;
  for (const l of loans) {
    const line = l.lines?.find((x) => String(x.member) === String(member._id));
    if (line && line.securityPaise > 0) {
      const isClosed = l.status === 'closed' || l.settled || Boolean(line.isSettled);
      if (isClosed) {
        closedSecurityPaise += line.securityPaise;
      }
    }
  }

  const existingWithdrawals = await SecurityWithdrawal.find({ member: member._id, status: { $in: ['pending', 'approved'] } });
  const alreadyRequestedPaise = existingWithdrawals.reduce((sum, w) => sum + (w.amountPaise || 0), 0);
  const withdrawablePaise = Math.max(0, closedSecurityPaise - alreadyRequestedPaise);

  if (withdrawablePaise <= 0) {
    throw new HttpError(400, 'Security for running loans cannot be withdrawn. Only security from closed loans is eligible for withdrawal.');
  }
  if (requestedPaise > withdrawablePaise) {
    throw new HttpError(400, `Requested amount ₹${payAmount} exceeds withdrawable closed-loan security of ₹${withdrawablePaise / 100}. Running loan security is locked.`);
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
    targets: targetTasks.map((t) => ({
      id: t._id,
      fromDate: t.fromDate,
      toDate: t.toDate,
      targets: t.targets,
      achieved: {
        d6: totalDisbursed,
        npaRecovery: totalNpaRecovered,
      },
    })),
  });
}

// -----------------------------------------------------------------------------
// 21. FIRST MEETING ATTENDANCE (POINT 18)
// -----------------------------------------------------------------------------
export async function markFirstMeetingAttendance(req, res) {
  const code = req.user?.employeeCode;
  const { photo, location } = req.body || {};
  if (!photo) throw new HttpError(400, 'Meeting photo upload is required');

  const emp = await Employee.findOne({ employeeCode: code });
  if (!emp) throw new HttpError(404, 'Employee record not found');

  const today = startOfToday();

  // 1. Prevent duplicate attendance punch in 1 day
  const existingMeeting = await FirstMeetingAttendance.findOne({ employeeCode: code, date: today });
  const existingAtt = await Attendance.findOne({ employee: emp._id, date: today });
  if (existingMeeting || (existingAtt && existingAtt.firstActivity)) {
    throw new HttpError(400, 'Attendance for today is already marked. Only 1 attendance punch per day is permitted.');
  }

  // 2. Validate time window if set for this employee
  if (emp.attendanceTime?.from && emp.attendanceTime?.to) {
    const now = nowIst();
    if (now < emp.attendanceTime.from || now > emp.attendanceTime.to) {
      throw new HttpError(422, `Attendance can only be marked between ${emp.attendanceTime.from} and ${emp.attendanceTime.to} (current time is ${now}).`);
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
      const leaveDeduction = (leaveLine?.amountPaise || 0) / 100;
      const grossSalary = (s.grossPaise || s.earnedPaise || (basic + fuel) * 100) / 100;
      const totalEarnings = (s.totalEarningPaise || s.grossPaise || 0) / 100;
      const totalDeductions = (s.totalDeductionPaise || 0) / 100;
      const netSalary = (s.netPaise || (totalEarnings - totalDeductions)) / 100;

      return {
        id: s._id,
        month: s.month,
        name: s.name || emp?.name || code,
        designation: s.designation || emp?.designation?.name || 'Field Officer',
        branch: s.branchName || 'Head Office',
        grossSalary,
        basicSalary: basic || grossSalary,
        fuelAllowance: fuel,
        absentDeduction: leaveDeduction,
        pfDeduction: (pfLine?.amountPaise || 0) / 100,
        esiDeduction: (esiLine?.amountPaise || 0) / 100,
        advanceDeduction: (advanceLine?.amountPaise || 0) / 100,
        securityDeduction: (secLine?.amountPaise || s.securityCutPaise || 0) / 100,
        allowances: Math.max(0, totalEarnings - basic),
        deductions: totalDeductions,
        netSalary,
        daysInMonth: s.daysInMonth || 30,
        presentDays: s.presentDays || 0,
        absentDays: s.absentDays || 0,
        payableDays: s.payableDays ?? (s.presentDays || 30),
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
  const items = await CgtVisit.find({ employeeCode: code }).sort({ updatedAt: -1 }).limit(50).lean();
  const surveyedCenters = await CenterVisit.find({ employeeCode: code }).sort({ visitDate: -1 }).limit(100).lean();
  res.json({
    items,
    centers: surveyedCenters.map((c) => ({
      centerName: c.centerName,
      contactName: c.contactName,
      contactNumber: c.contactNumber,
      visitDate: c.visitDate,
    })),
  });
}

export async function updateCgtDayPhoto(req, res) {
  const code = req.user?.employeeCode;
  const { centerName, day, photo, date = new Date() } = req.body || {};
  if (!centerName || !day || !photo) {
    throw new HttpError(400, 'Center name, CGT day (1, 2, or 3), and photo are required');
  }

  const emp = await Employee.findOne({ employeeCode: code });
  let visit = await CgtVisit.findOne({ centerName: new RegExp(`^${centerName}$`, 'i'), employeeCode: code });

  if (!visit) {
    visit = new CgtVisit({
      centerName,
      branch: emp?.branch,
      employeeCode: code,
    });
  }

  const dayKey = `day${day}`;
  visit[dayKey] = {
    date: new Date(date),
    photo,
    byCode: code,
  };

  if (visit.day1?.photo && visit.day2?.photo && visit.day3?.photo) {
    visit.status = 'completed';
  }

  await visit.save();

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
      elTotal: (realEl.opening || 0) + (realEl.earned || 0),
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
  const { type = 'casual', from, to, reason } = req.body || {};

  if (!from || !to) throw new HttpError(400, 'From date and To date are required');

  const d1 = new Date(from);
  const d2 = new Date(to);
  const days = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);

  const doc = await Leave.create({
    employee: emp._id,
    employeeCode: code,
    employeeName: emp.name,
    branch: emp.branch,
    type,
    from: d1,
    to: d2,
    days,
    reason,
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

  const products = await StockProduct.find({
    isDeleted: false,
    isActive: true,
    $or: [{ branch: branchId }, { branch: null }],
  }).lean();

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
  const { memberCode, productCode, quantity = 1, payMode = 'cash' } = req.body || {};

  const product = await StockProduct.findOne({ code: productCode, isDeleted: false });
  if (!product) throw new HttpError(404, 'Product not found');
  if (product.stockQty < quantity) throw new HttpError(400, `Insufficient stock (Available: ${product.stockQty})`);

  const member = await Member.findOne({ code: memberCode });
  const unitPrice = (product.unitPricePaise || 0) / 100;
  const totalAmount = unitPrice * quantity;

  product.stockQty -= quantity;
  await product.save();

  const receiptNo = `SALE${Date.now().toString().slice(-8)}`;
  const saleDoc = await ProductSaleOrder.create({
    receiptNo,
    employeeCode: code,
    branch: emp?.branch,
    memberCode,
    memberName: member?.name || 'Customer',
    productCode: product.code,
    productName: product.name,
    quantity,
    unitPrice,
    totalAmount,
    payMode,
    status: 'completed',
  });

  res.status(201).json({
    success: true,
    receiptNo,
    totalAmount,
    message: `Product ${product.name} sold successfully (Receipt: ${receiptNo})`,
    item: saleDoc,
  });
}

// -----------------------------------------------------------------------------
// 31. TASKS (POINT 28)
// -----------------------------------------------------------------------------
export async function getMyTasks(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code });
  const orConditions = [{ assignedToCode: code }, { assignedToCode: code?.toUpperCase() }, { assignedToCode: code?.toLowerCase() }];
  if (emp) orConditions.push({ assignedTo: emp._id });

  const tasks = await Task.find({ $or: orConditions })
    .populate('branch', 'name code')
    .sort({ dueDate: 1, createdAt: -1 })
    .lean();

  res.json({
    items: tasks.map((t) => ({
      ...t,
      id: t._id,
      _id: t._id,
    })),
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




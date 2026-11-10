import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {
  EmployeeMpin,
  CenterVisit,
  CgtVisit,
  FirstMeetingAttendance,
  ProductSaleOrder,
} from '../employee/employeeAppModel.js';
import { Employee, Department, Designation, Attendance, Salary } from '../../models/Hr.js';
import { User } from '../../models/User.js';
import { Branch } from '../../models/Branch.js';
import { Member } from '../../models/Member.js';
import { LoanPayment } from '../../models/LoanPayment.js';
import { EmiPayment } from '../../models/EmiPayment.js';
import { AppEmiCollection } from '../../models/AppEmiCollection.js';
import { LoanSettlement } from '../../models/LoanSettlement.js';
import { Group } from '../../models/Group.js';
import { Task, Complaint, Leave, Resignation, Requirement, EmployeeChange, SupervisorVisit, TASK_CATEGORIES } from '../../models/HrExtra.js';
import { Holiday } from '../../models/SuperAdmin.js';
import { Company } from '../../models/Company.js';
import { BankAccount } from '../../models/BankAccount.js';
import { generateCode } from '../../services/codeSequence.js';
import { issueOtp, takeVerified, consumeChallenge } from '../../services/otpChallenges.js';
import { sendSms } from '../../services/sms.js';
import { notifyEmployee } from '../../services/hrNotify.js';
import { asString, parseDateOnly, HttpError, startOfToday, todayDateString } from '../../utils/http.js';
import { audit } from '../../utils/audit.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-udgam-2026';
const COOKIE_NAME = process.env.COOKIE_NAME || 'udgam_token';

const cleanStr = (s) => String(s || '').trim();

// Strictly checks if employee / user is authorized as a Supervisor or Manager
export function isEmployeeSupervisor(emp, user = null) {
  if (!emp) return false;
  if (emp.isSupervisor === true) return true;
  if (Array.isArray(emp.supervisedBranches) && emp.supervisedBranches.length > 0) return true;
  const desigName = (emp.designation?.name || '').toLowerCase();
  if (/supervisor|manager|branch manager|area manager|coordinator|regional|director|admin|head/i.test(desigName)) {
    return true;
  }
  const role = (user?.role || '').toLowerCase();
  if (['supervisor', 'branch_manager', 'area_manager', 'admin', 'super_admin', 'manager'].includes(role)) {
    return true;
  }
  return false;
}

// Finds matching Employee record for Supervisor by code, mobile or email
async function findSupervisor(identifier) {
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

  let emp = await Employee.findOne(query)
    .populate('branch', 'code name city pincode')
    .populate('supervisedBranches', 'code name city pincode')
    .populate('department', 'name')
    .populate('designation', 'name');

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
      emp = await Employee.findOne({ user: user._id, isDeleted: false })
        .populate('branch', 'code name city pincode')
        .populate('supervisedBranches', 'code name city pincode')
        .populate('department', 'name')
        .populate('designation', 'name');
    }
  }
  return emp;
}

// Ensure supervisor has a linked User account
async function ensureUserForSupervisor(emp) {
  let user = await User.findOne({ employeeCode: emp.employeeCode });
  if (!user && emp.email) user = await User.findOne({ email: emp.email.toLowerCase() });
  if (!user) {
    user = await User.create({
      name: emp.name,
      email: emp.email || `${emp.employeeCode.toLowerCase()}@udgam.local`,
      mobile: emp.mobile,
      employeeCode: emp.employeeCode,
      password: await EmployeeMpin.hashMpin('123456'),
      role: 'branch_manager',
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

// Get all branch IDs under this supervisor
async function getSupervisorBranchIds(emp, user) {
  const branchIds = [];
  if (emp?.branch?._id) branchIds.push(String(emp.branch._id));
  else if (emp?.branch) branchIds.push(String(emp.branch));

  if (Array.isArray(emp?.supervisedBranches)) {
    for (const b of emp.supervisedBranches) {
      const id = String(b._id || b);
      if (id && !branchIds.includes(id)) branchIds.push(id);
    }
  }
  if (Array.isArray(user?.branches)) {
    for (const b of user.branches) {
      const id = String(b._id || b);
      if (id && !branchIds.includes(id)) branchIds.push(id);
    }
  }
  if (branchIds.length === 0) {
    const all = await Branch.find({ isActive: true }).select('_id');
    return all.map((b) => b._id);
  }
  return branchIds.map((id) => new mongoose.Types.ObjectId(id));
}

// Get all employees attached to this supervisor by ID, employeeCode, email, or supervised branches
async function getSupervisedEmployees(emp, user) {
  const branchIds = await getSupervisorBranchIds(emp, user);
  const conditions = [
    { branch: { $in: branchIds } },
    { supervisor: emp._id },
  ];
  if (emp.employeeCode) conditions.push({ supervisorCode: emp.employeeCode });
  if (emp.email) conditions.push({ supervisorEmail: emp.email.toLowerCase() });

  return await Employee.find({
    $or: conditions,
    isDeleted: false,
    status: 'active',
  })
    .populate('branch', 'code name city')
    .populate('designation', 'name')
    .sort({ name: 1 });
}

// -----------------------------------------------------------------------------
// 1. AUTHENTICATION & MPIN
// -----------------------------------------------------------------------------

export async function lookupSupervisor(req, res) {
  const identifier = req.body?.identifier || req.query?.identifier;
  const emp = await findSupervisor(identifier);
  if (!emp) throw new HttpError(404, 'Supervisor record not found in system. Please contact Admin/HR to register you first.');

  const user = await User.findOne({
    $or: [
      { employeeCode: emp.employeeCode },
      ...(emp.user ? [{ _id: emp.user }] : []),
      ...(emp.email ? [{ email: emp.email.toLowerCase() }] : []),
    ],
  }).lean();

  if (!isEmployeeSupervisor(emp, user)) {
    throw new HttpError(403, 'Access denied: You are registered as field staff, not a Supervisor. Please use the Employee App.');
  }

  const mpinRecord = await EmployeeMpin.findOne({ employeeCode: emp.employeeCode }).select('+mpinHash');
  res.json({
    found: true,
    employeeCode: emp.employeeCode,
    name: emp.name,
    photo: emp.photo || '',
    branch: emp.branch ? { id: emp.branch._id, code: emp.branch.code, name: emp.branch.name } : null,
    supervisedBranches: (emp.supervisedBranches || []).map((b) => ({ id: b._id, code: b.code, name: b.name })),
    department: emp.department?.name || 'Operations',
    designation: emp.designation?.name || 'Supervisor',
    mobile: emp.mobile || '',
    email: emp.email || '',
    hasMpin: Boolean(mpinRecord?.mpinHash),
  });
}

export async function createMpin(req, res) {
  const code = cleanStr(req.body?.employeeCode).toUpperCase();
  const mpin = cleanStr(req.body?.mpin);
  if (!code) throw new HttpError(400, 'Supervisor code is required');
  if (!/^\d{4,6}$/.test(mpin)) throw new HttpError(400, 'mPIN must be 4 to 6 digits');

  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false })
    .populate('designation')
    .populate('supervisedBranches')
    .populate('branch');
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const user = await User.findOne({
    $or: [
      { employeeCode: emp.employeeCode },
      ...(emp.user ? [{ _id: emp.user }] : []),
      ...(emp.email ? [{ email: emp.email.toLowerCase() }] : []),
    ],
  });

  if (!isEmployeeSupervisor(emp, user)) {
    throw new HttpError(403, 'Access denied: Only designated Supervisors and Branch Managers can create an mPIN for the Supervisor App.');
  }

  const ensuredUser = await ensureUserForSupervisor(emp);
  const mpinHash = await EmployeeMpin.hashMpin(mpin);

  let record = await EmployeeMpin.findOne({ employeeCode: code });
  if (record) {
    record.mpinHash = mpinHash;
    record.mobile = emp.mobile;
    record.email = emp.email;
    record.isSupervisor = true;
    record.user = ensuredUser._id;
    record.employee = emp._id;
    await record.save();
  } else {
    record = await EmployeeMpin.create({
      employee: emp._id,
      user: ensuredUser._id,
      employeeCode: code,
      mobile: emp.mobile,
      email: emp.email,
      mpinHash,
      isSupervisor: true,
    });
  }

  await audit(req, { action: 'supervisorApp.createMpin', entity: 'EmployeeMpin', entityId: record._id, after: { code } });
  res.json({ status: 'ok', message: 'mPIN created successfully! You can now login.' });
}

export async function loginWithMpin(req, res) {
  const id = cleanStr(req.body?.identifier);
  const mpin = cleanStr(req.body?.mpin);
  if (!id || !mpin) throw new HttpError(400, 'Identifier and mPIN are required');

  const emp = await findSupervisor(id);
  if (!emp) throw new HttpError(401, 'Invalid credentials');
  if (emp.status !== 'active' || emp.isBlocked) throw new HttpError(403, 'Your account is inactive or blocked');

  const user = await User.findOne({
    $or: [
      { employeeCode: emp.employeeCode },
      ...(emp.user ? [{ _id: emp.user }] : []),
      ...(emp.email ? [{ email: emp.email.toLowerCase() }] : []),
    ],
  });

  if (!isEmployeeSupervisor(emp, user)) {
    throw new HttpError(403, 'Access denied: This portal is strictly for Supervisors. Please use the Employee App.');
  }

  const mpinDoc = await EmployeeMpin.findOne({ employeeCode: emp.employeeCode }).select('+mpinHash');
  if (!mpinDoc) throw new HttpError(401, 'mPIN not set. Please create your mPIN first.');

  const ok = await mpinDoc.compareMpin(mpin);
  if (!ok) throw new HttpError(401, 'Incorrect mPIN');

  const ensuredUser = await ensureUserForSupervisor(emp);
  const activeUser = ensuredUser || user;
  mpinDoc.lastLoginAt = new Date();
  mpinDoc.isSupervisor = true;
  await mpinDoc.save();

  const token = jwt.sign(
    {
      id: activeUser._id,
      userId: activeUser._id,
      role: activeUser.role,
      employeeCode: emp.employeeCode,
      branchId: emp.branch?._id || activeUser.branches?.[0] || null,
      isSupervisor: true,
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
      id: activeUser._id,
      employeeId: emp._id,
      employeeCode: emp.employeeCode,
      name: emp.name,
      role: 'supervisor',
      branch: emp.branch ? { id: emp.branch._id, code: emp.branch.code, name: emp.branch.name } : null,
      supervisedBranches: (emp.supervisedBranches || []).map((b) => ({ id: b._id, code: b.code, name: b.name })),
      designation: emp.designation?.name || 'Supervisor',
      department: emp.department?.name || 'Operations',
      photo: emp.photo || '',
      mobile: emp.mobile,
    },
  });
}

export async function forgotMpinSendOtp(req, res) {
  const id = cleanStr(req.body?.identifier);
  const emp = await findSupervisor(id);
  if (!emp || !emp.mobile) throw new HttpError(404, 'Supervisor not found or mobile not registered');

  const user = await User.findOne({
    $or: [
      { employeeCode: emp.employeeCode },
      ...(emp.user ? [{ _id: emp.user }] : []),
      ...(emp.email ? [{ email: emp.email.toLowerCase() }] : []),
    ],
  }).lean();

  if (!isEmployeeSupervisor(emp, user)) {
    throw new HttpError(403, 'Access denied: You are registered as field staff, not a Supervisor.');
  }

  const challenge = await issueOtp('supervisor_mpin_reset', emp.mobile);
  let smsSent = false;
  try {
    await sendSms(emp.mobile, `Your Udgam Supervisor mPIN reset OTP is ${challenge.otp}. Valid for 5 minutes.`);
    smsSent = true;
  } catch (err) {
    console.warn('SMS send failed:', err.message);
  }

  res.json({
    status: 'ok',
    message: smsSent ? 'OTP sent to your registered mobile number' : `OTP generated (Dev: ${challenge.otp})`,
    mobileMasked: emp.mobile.replace(/(\d{2})\d{6}(\d{2})/, '$1******$2'),
  });
}

export async function forgotMpinVerifyAndReset(req, res) {
  const id = cleanStr(req.body?.identifier);
  const otp = cleanStr(req.body?.otp);
  const newMpin = cleanStr(req.body?.newMpin);

  if (!/^\d{4,6}$/.test(newMpin)) throw new HttpError(400, 'New mPIN must be 4 to 6 digits');

  const emp = await findSupervisor(id);
  if (!emp || !emp.mobile) throw new HttpError(404, 'Supervisor not found');

  const valid = await takeVerified('supervisor_mpin_reset', emp.mobile, otp);
  if (!valid) throw new HttpError(400, 'Invalid or expired OTP');

  const mpinHash = await EmployeeMpin.hashMpin(newMpin);
  await EmployeeMpin.findOneAndUpdate(
    { employeeCode: emp.employeeCode },
    { $set: { mpinHash, isSupervisor: true, updatedAt: new Date() } },
    { upsert: true }
  );

  res.json({ status: 'ok', message: 'mPIN reset successfully. Please login with your new mPIN.' });
}

// -----------------------------------------------------------------------------
// 2. SUPERVISOR PROFILE
// -----------------------------------------------------------------------------

export async function getSupervisorProfile(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false })
    .populate('branch', 'code name city pincode state address')
    .populate('supervisedBranches', 'code name city pincode state address')
    .populate('department', 'name')
    .populate('designation', 'name');
  if (!emp) throw new HttpError(404, 'Supervisor record not found');

  // Count managed staff under supervised branches
  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const teamStaff = await Employee.find({ branch: { $in: branchIds }, isDeleted: false, status: 'active' })
    .select('employeeCode name designation mobile photo branch')
    .populate('branch', 'code name')
    .populate('designation', 'name');

  res.json({
    profile: {
      photo: emp.photo || '',
      name: emp.name,
      employeeCode: emp.employeeCode,
      mobile: emp.mobile || '',
      email: emp.email || '',
      address: [emp.address, emp.area, emp.district, emp.state, emp.pincode].filter(Boolean).join(', '),
      joiningDate: emp.joiningDate ? emp.joiningDate.toISOString().slice(0, 10) : '',
      branch: emp.branch ? `${emp.branch.code} — ${emp.branch.name}` : '',
      supervisedBranches: (emp.supervisedBranches || []).map((b) => ({ id: b._id, code: b.code, name: b.name })),
      designation: emp.designation?.name || 'Supervisor',
      department: emp.department?.name || 'Operations',
      status: emp.status === 'active' ? 'Active' : 'Inactive',
      teamCount: teamStaff.length,
      teamStaff,
    },
  });
}

// -----------------------------------------------------------------------------
// 3. SUPERVISOR DASHBOARD (Staff-wise & Branch-wise overview)
// -----------------------------------------------------------------------------

export async function getSupervisorDashboard(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false })
    .populate('branch', 'code name city')
    .populate('supervisedBranches', 'code name city');
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);

  // Managed branches & staff
  const branches = await Branch.find({ _id: { $in: branchIds } }).select('code name city');
  const staffMembers = await Employee.find({ branch: { $in: branchIds }, isDeleted: false, status: 'active' })
    .select('employeeCode name designation branch mobile')
    .populate('branch', 'code name')
    .populate('designation', 'name');

  // Today Dues from LoanPayment (status: 'paid')
  const todayEnd = new Date(`${todayDateString()}T23:59:59.999Z`);
  const todayStart = new Date(`${todayDateString()}T00:00:00.000Z`);

  const loans = await LoanPayment.find({
    branch: { $in: branchIds },
    status: 'paid',
  })
    .select('loanId formId mode modeLabel group lines schedule branch employeeCode totalAmountPaise')
    .populate('branch', 'code name')
    .lean();

  let totalDueToday = 0;
  let totalDueCount = 0;
  let totalCollectedToday = 0;
  let totalCollectedCount = 0;

  const staffDueMap = {};
  const branchDueMap = {};

  for (const b of branches) {
    branchDueMap[String(b._id)] = {
      branchId: b._id,
      branchCode: b.code,
      branchName: b.name,
      dueAmount: 0,
      collectedAmount: 0,
      dueMembers: 0,
      paidMembers: 0,
    };
  }

  for (const s of staffMembers) {
    staffDueMap[s.employeeCode] = {
      staffCode: s.employeeCode,
      staffName: s.name,
      designation: s.designation?.name || 'Field Officer',
      branchName: s.branch?.name || '',
      dueAmount: 0,
      collectedAmount: 0,
      dueMembers: 0,
      paidMembers: 0,
    };
  }

  const groupCodes = [...new Set(loans.map((l) => l.group?.code).filter(Boolean))];
  const groupDocs = groupCodes.length
    ? await Group.find({ code: { $in: groupCodes } }).select('code meetingType collectionDay dayOfWeek').lean()
    : [];
  const groupMap = new Map(groupDocs.map((g) => [g.code, g]));

  const jsDay = todayStart.getUTCDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const dayOfMonth = todayStart.getUTCDate();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayDateStr = todayDateString();

  loans.forEach((l) => {
    // Point 2: Filter strictly to loans scheduled for today's meeting day / due date
    let meetsToday = false;
    const mode = (l.mode || l.modeLabel || 'weekly').toLowerCase();
    const g = l.group?.code ? groupMap.get(l.group.code) : null;
    const meetingType = (g?.meetingType || mode).toLowerCase();

    if (meetingType === 'daily') {
      meetsToday = jsDay !== 0; // Daily: Mon-Sat
    } else if (meetingType === 'weekly') {
      let gDayNum = null;
      if (g?.collectionDay !== undefined && g?.collectionDay !== null) {
        gDayNum = Number(g.collectionDay);
      } else if (g?.dayOfWeek) {
        const idx = dayNames.indexOf(String(g.dayOfWeek).toLowerCase().trim());
        if (idx >= 0) gDayNum = idx === 0 ? 7 : idx;
      }
      if (gDayNum !== null) {
        meetsToday = gDayNum === isoDay;
      } else {
        meetsToday = (l.schedule || []).some((s) => s.dueDate && new Date(s.dueDate).toISOString().slice(0, 10) === todayDateStr);
      }
    } else if (meetingType === 'monthly') {
      const gMonthDay = g?.collectionDay ? Number(g.collectionDay) : null;
      if (gMonthDay !== null) {
        meetsToday = gMonthDay === dayOfMonth;
      } else {
        meetsToday = (l.schedule || []).some((s) => s.dueDate && new Date(s.dueDate).toISOString().slice(0, 10) === todayDateStr);
      }
    } else {
      meetsToday = (l.schedule || []).some((s) => s.dueDate && new Date(s.dueDate).toISOString().slice(0, 10) === todayDateStr);
    }

    if (!meetsToday) return;

    const exactInst = (l.schedule || []).find((s) => s.dueDate && new Date(s.dueDate).toISOString().slice(0, 10) === todayDateStr);
    const dueInst = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= todayEnd);
    if (!exactInst && !dueInst.length) return;
    const latest = exactInst || dueInst[dueInst.length - 1];
    const bId = String(l.branch?._id || l.branch);
    const sCode = l.employeeCode || 'OFFICER';

    (l.lines || []).forEach((line) => {
      const emi = (latest.installmentPaise + (line.extraEmiPaise || 0)) / 100;
      totalDueToday += emi;
      totalDueCount += 1;

      if (branchDueMap[bId]) {
        branchDueMap[bId].dueAmount += emi;
        branchDueMap[bId].dueMembers += 1;
      }
      if (staffDueMap[sCode]) {
        staffDueMap[sCode].dueAmount += emi;
        staffDueMap[sCode].dueMembers += 1;
      }
    });
  });

  // Today collected EMIs from EmiPayment
  const collectionsToday = await EmiPayment.find({
    branch: { $in: branchIds },
    status: 'paid',
    paidOn: { $gte: todayStart, $lte: todayEnd },
  }).lean();

  for (const col of collectionsToday) {
    const amt = (col.amountPaise || 0) / 100;
    totalCollectedToday += amt;
    totalCollectedCount += 1;
    const bId = String(col.branch?._id || col.branch);
    const sCode = col.employeeCode || col.collectedByCode;

    if (branchDueMap[bId]) {
      branchDueMap[bId].collectedAmount += amt;
      branchDueMap[bId].paidMembers += 1;
    }
    if (staffDueMap[sCode]) {
      staffDueMap[sCode].collectedAmount += amt;
      staffDueMap[sCode].paidMembers += 1;
    }
  }

  // NPA loans overview across supervised branches
  const npaLoans = loans.filter((l) => {
    if (l.isNpa) return true;
    const overdueSchedules = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) < todayStart);
    return overdueSchedules.length >= 12; // 90+ days weekly
  });
  const npaTotalAmount = npaLoans.reduce((sum, l) => sum + (l.totalAmountPaise || 0) / 100, 0);

  // New members registered this month
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const newMembersCount = await Member.countDocuments({
    branch: { $in: branchIds },
    createdAt: { $gte: monthStart },
  });

  // Scheduled / upcoming branch visits from system software (SupervisorVisit)
  const branchVisits = await SupervisorVisit.find({
    $or: [{ supervisor: emp._id }, { supervisorCode: code }, { branch: { $in: branchIds } }],
    visitDate: { $gte: startOfToday() },
    status: { $ne: 'cancelled' },
  })
    .populate('branch', 'code name city pincode')
    .sort({ visitDate: 1 })
    .limit(10)
    .lean();

  // Pending tasks for supervisor and supervised staff
  const staffCodes = staffMembers.map((s) => s.employeeCode);
  const staffIds = staffMembers.map((s) => s._id);
  const pendingTasks = await Task.find({
    $or: [
      { assignedTo: { $in: staffIds } },
      { assignedToCode: { $in: staffCodes } },
      { branch: { $in: branchIds } },
      { createdByCode: code },
      { assignedTo: emp._id },
      { assignedToCode: code },
    ],
    status: { $in: ['open', 'in_progress'] },
  })
    .sort({ dueDate: 1 })
    .limit(10)
    .lean();

  res.json({
    metrics: {
      totalDueToday: Math.round(totalDueToday),
      totalDueCount,
      totalCollectedToday: Math.round(totalCollectedToday),
      totalCollectedCount,
      totalStaffCount: staffMembers.length,
      totalBranchCount: branches.length,
      npaCount: npaLoans.length,
      npaTotalAmount: Math.round(npaTotalAmount),
      newMembersCount,
      pendingTasksCount: pendingTasks.length,
      branchVisitsCount: branchVisits.length,
    },
    staffWiseDues: Object.values(staffDueMap),
    branchWiseDues: Object.values(branchDueMap),
    branches,
    staffMembers,
    branchVisits,
    pendingTasks,
  });
}

// -----------------------------------------------------------------------------
// 4. TODAY DUE - STAFF-WISE & BRANCH-WISE
// -----------------------------------------------------------------------------

export async function getSupervisorTodayDue(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false })
    .populate('branch', 'code name')
    .populate('supervisedBranches', 'code name');
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const { branchId } = req.query;

  let filterBranchIds = branchIds;
  if (branchId && mongoose.isValidObjectId(branchId)) {
    filterBranchIds = [new mongoose.Types.ObjectId(branchId)];
  }

  const dateStr = asString(req.query.date) || todayDateString();
  const targetDate = new Date(`${dateStr}T12:00:00.000Z`);
  const jsDay = targetDate.getUTCDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const dayOfMonth = targetDate.getUTCDate();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayEnd = new Date(`${dateStr}T23:59:59.999Z`);

  const loans = await LoanPayment.find({
    branch: { $in: filterBranchIds },
    status: 'paid',
  })
    .select('loanId formId mode modeLabel group lines schedule branch employeeCode')
    .populate('branch', 'code name')
    .lean();

  const groupCodes = [...new Set(loans.map((l) => l.group?.code).filter(Boolean))];
  const groupDocs = groupCodes.length
    ? await Group.find({ code: { $in: groupCodes } }).select('code meetingType collectionDay dayOfWeek').lean()
    : [];
  const groupMap = new Map(groupDocs.map((g) => [g.code, g]));

  const branches = await Branch.find({ _id: { $in: branchIds } }).select('code name');
  const staffList = await Employee.find({ branch: { $in: branchIds }, isDeleted: false, status: 'active' }).select('employeeCode name designation branch');

  const staffMap = {};
  const branchMap = {};

  for (const b of branches) {
    branchMap[String(b._id)] = { branchId: b._id, branchCode: b.code, branchName: b.name, totalDue: 0, count: 0, items: [] };
  }
  for (const s of staffList) {
    staffMap[s.employeeCode] = { staffCode: s.employeeCode, staffName: s.name, totalDue: 0, count: 0, items: [] };
  }

  loans.forEach((l) => {
    // Point 2: Filter strictly to loans scheduled for today's meeting day / due date
    let meetsToday = false;
    const mode = (l.mode || l.modeLabel || 'weekly').toLowerCase();
    const g = l.group?.code ? groupMap.get(l.group.code) : null;
    const meetingType = (g?.meetingType || mode).toLowerCase();

    if (meetingType === 'daily') {
      meetsToday = jsDay !== 0; // Daily: Mon-Sat
    } else if (meetingType === 'weekly') {
      let gDayNum = null;
      if (g?.collectionDay !== undefined && g?.collectionDay !== null) {
        gDayNum = Number(g.collectionDay);
      } else if (g?.dayOfWeek) {
        const idx = dayNames.indexOf(String(g.dayOfWeek).toLowerCase().trim());
        if (idx >= 0) gDayNum = idx === 0 ? 7 : idx;
      }
      if (gDayNum !== null) {
        meetsToday = gDayNum === isoDay;
      } else {
        meetsToday = (l.schedule || []).some((s) => s.dueDate && new Date(s.dueDate).toISOString().slice(0, 10) === dateStr);
      }
    } else if (meetingType === 'monthly') {
      const gMonthDay = g?.collectionDay ? Number(g.collectionDay) : null;
      if (gMonthDay !== null) {
        meetsToday = gMonthDay === dayOfMonth;
      } else {
        meetsToday = (l.schedule || []).some((s) => s.dueDate && new Date(s.dueDate).toISOString().slice(0, 10) === dateStr);
      }
    } else {
      meetsToday = (l.schedule || []).some((s) => s.dueDate && new Date(s.dueDate).toISOString().slice(0, 10) === dateStr);
    }

    if (!meetsToday) return;

    const exactInst = (l.schedule || []).find((s) => s.dueDate && new Date(s.dueDate).toISOString().slice(0, 10) === dateStr);
    const dueInst = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= todayEnd);
    if (!exactInst && !dueInst.length) return;
    const latest = exactInst || dueInst[dueInst.length - 1];
    const bId = String(l.branch?._id || l.branch);
    const sCode = l.employeeCode || 'OFFICER';

    (l.lines || []).forEach((line, idx) => {
      const emi = (latest.installmentPaise + (line.extraEmiPaise || 0)) / 100;
      const item = {
        loanId: l._id,
        loanNumber: l.loanId || l.formId,
        memberName: line.name || 'Borrower',
        memberCode: line.code || '',
        groupName: l.group?.name || l.group?.code || 'Group Loan',
        centerName: l.group?.code ? `Center ${l.group.code}` : 'Branch Center',
        emiAmount: emi,
        branchName: branchMap[bId]?.branchName || l.branch?.name || '',
        staffCode: sCode,
        dueDate: latest.dueDate ? new Date(latest.dueDate).toISOString().slice(0, 10) : dateStr,
      };

      if (branchMap[bId]) {
        branchMap[bId].totalDue += emi;
        branchMap[bId].count += 1;
        branchMap[bId].items.push(item);
      }
      if (staffMap[sCode]) {
        staffMap[sCode].totalDue += emi;
        staffMap[sCode].count += 1;
        staffMap[sCode].items.push(item);
      }
    });
  });

  res.json({
    branchWise: Object.values(branchMap),
    staffWise: Object.values(staffMap),
    branches,
    staffList,
  });
}

// -----------------------------------------------------------------------------
// 5. TODAY COLLECTION PAID - STAFF-WISE & BRANCH-WISE
// -----------------------------------------------------------------------------

export async function getSupervisorCollectionPaid(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false })
    .populate('branch', 'code name')
    .populate('supervisedBranches', 'code name');
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));

  const collections = await EmiPayment.find({
    branch: { $in: branchIds },
    status: 'paid',
    paidOn: { $gte: todayStart, $lte: todayEnd },
  })
    .populate('branch', 'code name')
    .sort({ paidOn: -1 })
    .lean();

  const branches = await Branch.find({ _id: { $in: branchIds } }).select('code name');
  const staffList = await Employee.find({ branch: { $in: branchIds }, isDeleted: false, status: 'active' }).select('employeeCode name designation');

  const branchMap = {};
  const staffMap = {};

  for (const b of branches) {
    branchMap[String(b._id)] = { branchId: b._id, branchCode: b.code, branchName: b.name, totalCollected: 0, count: 0, receipts: [] };
  }
  for (const s of staffList) {
    staffMap[s.employeeCode] = { staffCode: s.employeeCode, staffName: s.name, totalCollected: 0, count: 0, receipts: [] };
  }

  for (const c of collections) {
    const bId = String(c.branch?._id || c.branch);
    const sCode = c.employeeCode || c.collectedByCode || 'OFFICER';
    const amt = (c.amountPaise || 0) / 100;

    const receipt = {
      id: c._id,
      receiptNo: c.receiptNo || String(c._id).slice(-6).toUpperCase(),
      memberName: c.memberName || 'Member',
      amount: amt,
      paymentMode: c.payMode || 'Cash',
      time: c.paidOn ? new Date(c.paidOn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      branchName: c.branch?.name || '',
      staffCode: sCode,
    };

    if (branchMap[bId]) {
      branchMap[bId].totalCollected += amt;
      branchMap[bId].count += 1;
      branchMap[bId].receipts.push(receipt);
    }
    if (staffMap[sCode]) {
      staffMap[sCode].totalCollected += amt;
      staffMap[sCode].count += 1;
      staffMap[sCode].receipts.push(receipt);
    }
  }

  res.json({
    branchWise: Object.values(branchMap),
    staffWise: Object.values(staffMap),
    totalAmount: collections.reduce((acc, c) => acc + (c.amountPaise || 0) / 100, 0),
    totalReceipts: collections.length,
    recentReceipts: collections.slice(0, 50),
  });
}

// -----------------------------------------------------------------------------
// 6. NEW MEMBER REPORT (Staff-wise & Branch-wise)
// -----------------------------------------------------------------------------

export async function getSupervisorNewMemberReport(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const { period = 'month' } = req.query;

  const startDate = period === 'week'
    ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const members = await Member.find({
    branch: { $in: branchIds },
    createdAt: { $gte: startDate },
  })
    .populate('branch', 'code name')
    .sort({ createdAt: -1 });

  const branchWise = {};
  const staffWise = {};

  for (const m of members) {
    const bId = String(m.branch?._id || m.branch);
    const sCode = m.createdByCode || 'OFFICER';

    if (!branchWise[bId]) {
      branchWise[bId] = { branchName: m.branch?.name || 'Branch', count: 0, members: [] };
    }
    branchWise[bId].count += 1;
    branchWise[bId].members.push({ id: m._id, name: m.name, mobile: m.mobile, date: m.createdAt });

    if (!staffWise[sCode]) {
      staffWise[sCode] = { staffCode: sCode, count: 0, members: [] };
    }
    staffWise[sCode].count += 1;
    staffWise[sCode].members.push({ id: m._id, name: m.name, mobile: m.mobile, date: m.createdAt });
  }

  res.json({
    totalCount: members.length,
    branchWise: Object.values(branchWise),
    staffWise: Object.values(staffWise),
    members,
  });
}

// -----------------------------------------------------------------------------
// 7. NPA RECOVERY (Branch-wise & Center-wise)
// -----------------------------------------------------------------------------

export async function getSupervisorNpaOverview(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const branches = await Branch.find({ _id: { $in: branchIds } }).select('code name');

  const loans = await LoanPayment.find({
    branch: { $in: branchIds },
    status: 'paid',
  })
    .populate('branch', 'code name')
    .lean();

  const branchMap = {};
  const centerMap = {};
  const staffMap = {};
  const today = new Date();
  const npaList = [];

  for (const b of branches) {
    branchMap[String(b._id)] = { branchId: b._id, branchName: b.name, totalNpaAmount: 0, loanCount: 0, loans: [] };
  }

  for (const l of loans) {
    for (const line of (l.lines || [])) {
      const overdueSchedules = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) < today);
      if (overdueSchedules.length < 8 && !l.isNpa) continue; // must have multiple overdue schedules or marked NPA

      const emi = (overdueSchedules[0]?.installmentPaise || 0) / 100;
      const bId = String(l.branch?._id || l.branch);
      const center = l.group?.code ? `Center ${l.group.code}` : (l.branch?.name ? `${l.branch.name} Center` : 'Main Center');
      const amount = Math.round(emi * overdueSchedules.length) || (l.totalAmountPaise || 0) / 100;
      const staffCode = l.employeeCode || 'OFFICER';

      const item = {
        loanPaymentId: l._id,
        loanId: l.loanId || l.formId || String(l._id),
        loanNo: l.loanId || l.formId || String(l._id).slice(-6).toUpperCase(),
        memberCode: line.code || '',
        memberName: line.name || 'Borrower',
        memberMobile: line.mobile || '',
        centerName: center,
        branchId: bId,
        branchName: branchMap[bId]?.branchName || l.branch?.name || '',
        staffCode,
        overdueDays: Math.min(365, overdueSchedules.length * 7 || 90),
        balanceAmount: amount,
        isSettlement: false,
      };

      npaList.push(item);

      if (branchMap[bId]) {
        branchMap[bId].totalNpaAmount += amount;
        branchMap[bId].loanCount += 1;
        branchMap[bId].loans.push(item);
      }

      if (!centerMap[center]) {
        centerMap[center] = { centerName: center, branchName: branchMap[bId]?.branchName || '', totalNpaAmount: 0, loanCount: 0, loans: [] };
      }
      centerMap[center].totalNpaAmount += amount;
      centerMap[center].loanCount += 1;
      centerMap[center].loans.push(item);

      if (!staffMap[staffCode]) {
        staffMap[staffCode] = { staffCode, totalNpaAmount: 0, loanCount: 0, loans: [] };
      }
      staffMap[staffCode].totalNpaAmount += amount;
      staffMap[staffCode].loanCount += 1;
      staffMap[staffCode].loans.push(item);
    }
  }

  // Point 4: Include active / pending settlement loans in NPA Recovery list
  const settlements = await LoanSettlement.find({
    branch: { $in: branchIds },
    status: { $in: ['active', 'pending'] },
  }).populate('branch', 'code name').lean();

  for (const s of settlements) {
    const remainingSettlement = Math.max(0, (s.outstandingPaise - (s.amountPaise || 0)) / 100);
    const bId = String(s.branch?._id || s.branch);
    const center = s.group ? `Center ${s.group}` : (s.branch?.name ? `${s.branch.name} Center` : 'Main Center');
    const staffCode = s.createdByCode || 'OFFICER';
    const balAmt = remainingSettlement > 0 ? remainingSettlement : (s.outstandingPaise / 100);

    const item = {
      loanPaymentId: s.loanPayment || s._id,
      loanId: s.loanId || String(s._id),
      loanNo: s.loanId || s.receiptNo || 'SETTLED',
      memberCode: s.memberCode || '',
      memberName: s.memberName || 'Borrower',
      memberMobile: '',
      centerName: center,
      branchId: bId,
      branchName: branchMap[bId]?.branchName || s.branch?.name || '',
      staffCode,
      overdueDays: 90,
      balanceAmount: balAmt,
      isSettlement: true,
      settlementKind: s.kind,
      settlementReceiptNo: s.receiptNo,
    };

    npaList.push(item);

    if (branchMap[bId]) {
      branchMap[bId].totalNpaAmount += balAmt;
      branchMap[bId].loanCount += 1;
      branchMap[bId].loans.push(item);
    }

    if (!centerMap[center]) {
      centerMap[center] = { centerName: center, branchName: branchMap[bId]?.branchName || '', totalNpaAmount: 0, loanCount: 0, loans: [] };
    }
    centerMap[center].totalNpaAmount += balAmt;
    centerMap[center].loanCount += 1;
    centerMap[center].loans.push(item);

    if (!staffMap[staffCode]) {
      staffMap[staffCode] = { staffCode, totalNpaAmount: 0, loanCount: 0, loans: [] };
    }
    staffMap[staffCode].totalNpaAmount += balAmt;
    staffMap[staffCode].loanCount += 1;
    staffMap[staffCode].loans.push(item);
  }

  res.json({
    totalNpaLoans: npaList.length,
    totalNpaAmount: npaList.reduce((sum, l) => sum + l.balanceAmount, 0),
    items: npaList,
    branchWise: Object.values(branchMap),
    centerWise: Object.values(centerMap),
    staffWise: Object.values(staffMap),
    branches,
  });
}

export async function recoverNpaLoan(req, res) {
  const { loanPaymentId, loanId: bodyLoanId, memberCode, amount, payMode = 'cash', paymentMode, reference = '' } = req.body || {};
  const payAmount = Number(amount);
  if (!payAmount || payAmount < 1) throw new HttpError(400, 'Enter recovery amount of ₹1 or more');

  const searchId = loanPaymentId || bodyLoanId;
  if (!searchId) throw new HttpError(400, 'Loan ID or Payment ID is required');

  let loan = null;
  if (mongoose.isValidObjectId(searchId)) {
    loan = await LoanPayment.findById(searchId);
  }
  if (!loan) {
    loan = await LoanPayment.findOne({
      $or: [
        { loanId: searchId },
        { formId: searchId },
        { receiptNo: searchId },
      ],
    });
  }

  let settlementDoc = null;
  if (!loan) {
    if (mongoose.isValidObjectId(searchId)) {
      settlementDoc = await LoanSettlement.findById(searchId);
    }
    if (!settlementDoc) {
      settlementDoc = await LoanSettlement.findOne({
        $or: [{ loanId: searchId }, { receiptNo: searchId }],
      });
    }
    if (settlementDoc?.loanPayment) {
      loan = await LoanPayment.findById(settlementDoc.loanPayment);
    }
  }

  if (!loan && !settlementDoc) {
    throw new HttpError(404, 'Loan record not found in system');
  }

  const line = (loan?.lines || []).find((l) => l.code === memberCode)
    || loan?.lines?.[0]
    || { code: memberCode || settlementDoc?.memberCode || 'N/A', name: settlementDoc?.memberName || 'Borrower' };

  const resolvedBranch = loan?.branch?._id || loan?.branch || settlementDoc?.branch || (req.user?.branches || [])[0];
  const receiptNo = await generateCode('emiReceipt').catch(() => `NPA${Date.now().toString().slice(-8)}`);

  const modeClean = ['cash', 'bank', 'upi', 'cheque'].includes(String(payMode || paymentMode).toLowerCase())
    ? String(payMode || paymentMode).toLowerCase()
    : 'cash';

  // Point 4: Record in AppEmiCollection with status: 'pending' so it strictly appears in System EMI Approval (/app/emi-approval)
  await AppEmiCollection.create({
    loanPayment: loan?._id || null,
    loanId: loan?.loanId || loan?.formId || settlementDoc?.loanId || searchId,
    branch: resolvedBranch,
    memberCode: line.code || memberCode || 'MEMBER',
    memberName: line.name || 'Borrower',
    group: loan?.group?.code ? `${loan.group.code} — ${loan.group.name}` : (settlementDoc?.group || ''),
    amountPaise: Math.round(payAmount * 100),
    collectedOn: new Date(),
    type: 'regular',
    npa: true,
    payMode: modeClean,
    reference: reference || '',
    collectedBy: req.user._id,
    collectedByCode: req.user?.employeeCode || '',
    status: 'pending',
    receiptNo,
  });

  res.status(201).json({
    success: true,
    receiptNo,
    amount: payAmount,
    loanId: loan?.loanId || searchId,
    memberCode: line.code,
    memberName: line.name,
    pendingApproval: true,
    message: `NPA recovery payment of ₹${payAmount} collected and submitted for System EMI Approval (Receipt ${receiptNo})`,
  });
}

// -----------------------------------------------------------------------------
// 8. STAFF ATTENDANCE / BRANCH PRESENT
// -----------------------------------------------------------------------------

export async function getSupervisorStaffAttendance(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const branches = await Branch.find({ _id: { $in: branchIds } }).select('code name city');

  const today = todayDateString();
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));

  const staffMembers = await Employee.find({ branch: { $in: branchIds }, isDeleted: false, status: 'active' })
    .populate('branch', 'code name')
    .populate('designation', 'name');

  const attendances = await Attendance.find({
    employee: { $in: staffMembers.map((s) => s._id) },
    date: { $gte: todayStart },
  });

  const attendanceMap = new Map();
  attendances.forEach((a) => attendanceMap.set(String(a.employee), a));

  const branchAttendance = {};
  for (const b of branches) {
    branchAttendance[String(b._id)] = {
      branchId: b._id,
      branchName: b.name,
      branchCode: b.code,
      totalStaff: 0,
      presentStaff: 0,
      staffList: [],
    };
  }

  for (const s of staffMembers) {
    const bId = String(s.branch?._id || s.branch);
    const att = attendanceMap.get(String(s._id));
    const isPresent = Boolean(att && att.status === 'present');

    const staffRow = {
      id: s._id,
      code: s.employeeCode,
      name: s.name,
      designation: s.designation?.name || 'Staff',
      photo: s.photo || '',
      status: isPresent ? 'Present' : (att?.status || 'Not Marked'),
      checkIn: att?.checkInTime || '',
    };

    if (branchAttendance[bId]) {
      branchAttendance[bId].totalStaff += 1;
      if (isPresent) branchAttendance[bId].presentStaff += 1;
      branchAttendance[bId].staffList.push(staffRow);
    }
  }

  res.json({
    summary: {
      totalStaff: staffMembers.length,
      totalPresent: attendances.filter((a) => a.status === 'present').length,
    },
    branchWiseAttendance: Object.values(branchAttendance),
  });
}

// -----------------------------------------------------------------------------
// 9. SUPERVISOR SALARY SLIPS
// -----------------------------------------------------------------------------

export async function getSupervisorSalarySlips(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const query = { $or: [{ employee: emp._id }, { employeeCode: code }] };
  const slips = await Salary.find(query).sort({ month: -1 }).lean();

  const formatted = slips.map((s) => {
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
      year: s.month ? s.month.slice(0, 4) : new Date().getFullYear(),
      name: s.name || emp.name,
      designation: s.designation || 'Supervisor',
      branch: s.branchName || 'Area Office',
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
      status: s.status || 'Paid',
      paymentDate: s.paidOn || s.createdAt,
      lines: (s.lines || []).map((l) => ({
        key: l.key,
        label: l.label,
        side: l.side,
        amount: (l.amountPaise || 0) / 100,
      })),
    };
  });

  res.json({
    slips: formatted,
    items: formatted,
  });
}

// -----------------------------------------------------------------------------
// 10. ATTENDANCE: PERSONAL & TEAM-WISE (Items 18, 20, 21)
// -----------------------------------------------------------------------------

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

export async function markSupervisorFirstMeetingAttendance(req, res) {
  const code = req.user?.employeeCode;
  const { photo, location, pincode } = req.body || {};
  if (!photo) throw new HttpError(400, 'First meeting live photo upload is required');

  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false })
    .populate('branch')
    .populate('supervisedBranches');
  if (!emp) throw new HttpError(404, 'Supervisor record not found');

  const today = startOfToday();

  // 1. Prevent duplicate attendance punch in 1 day
  const existingMeeting = await FirstMeetingAttendance.findOne({ employeeCode: code, date: today });
  const existingAtt = await Attendance.findOne({ employee: emp._id, date: today });
  if (existingMeeting || (existingAtt && existingAtt.firstActivity)) {
    throw new HttpError(400, 'Attendance for today is already marked. Only 1 punch per day is permitted.');
  }

  // 2. Validate time window if set for this supervisor
  if (emp.attendanceTime?.from && emp.attendanceTime?.to) {
    const now = nowIst();
    if (now < emp.attendanceTime.from || now > emp.attendanceTime.to) {
      throw new HttpError(422, `Attendance can only be marked between ${emp.attendanceTime.from} and ${emp.attendanceTime.to} (current time is ${now}).`);
    }
  }

  // Point 8: Pincode-wise attendance verification
  const cleanPin = String(pincode || location?.pincode || '').replace(/\D/g, '').slice(0, 6);
  let pincodeVerified = false;
  if (cleanPin.length === 6) {
    // Check against supervisor's branch, supervised branches, or active branch network
    const allowedPins = [
      emp.branch?.pincode,
      ...(emp.supervisedBranches || []).map((b) => b.pincode),
    ].filter(Boolean);

    if (allowedPins.length > 0) {
      if (allowedPins.includes(cleanPin)) {
        pincodeVerified = true;
      } else {
        // Also verify if it exists as an active branch pincode in company
        const branchMatch = await Branch.findOne({ pincode: cleanPin, isActive: true });
        if (branchMatch) pincodeVerified = true;
      }
    } else {
      pincodeVerified = true;
    }
  }

  // 3. Validate geofence location radius if places are configured and pincode is not already verified
  const places = locationsOf(emp);
  if (places.length && !pincodeVerified) {
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new HttpError(422, 'GPS location coordinates or valid 6-digit branch Pincode is required for attendance verification.');
    }
    const measured = places.map((p) => ({ ...p, distance: Math.round(metresBetween(p.lat, p.lng, lat, lng)) })).sort((a, b) => a.distance - b.distance);
    const nearest = measured[0];
    if (measured.every((p) => p.distance > (p.radius || 500))) {
      throw new HttpError(422, `You are ${nearest.distance}m away from ${nearest.name || 'attendance location'}. Please mark attendance from your assigned branch or enter branch pincode.`);
    }
  }

  const resolvedLocation = {
    ...(location || {}),
    pincode: cleanPin || emp.branch?.pincode || '',
    address: location?.address || (cleanPin ? `Pincode: ${cleanPin}` : ''),
  };

  const meetingRecord = await FirstMeetingAttendance.create({
    employeeCode: code,
    employeeName: emp.name,
    branch: emp.branch?._id || emp.branch,
    date: today,
    photo,
    location: resolvedLocation,
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
      remark: cleanPin ? `Supervisor attendance marked with Pincode ${cleanPin}` : 'Supervisor first meeting marked with photo in app',
    },
    { upsert: true }
  );

  res.status(201).json({
    success: true,
    message: cleanPin ? `Attendance marked successfully for Pincode ${cleanPin}!` : 'First meeting attendance marked successfully with live photo!',
    item: meetingRecord,
  });
}

export async function getPersonalAttendance(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const history = await Attendance.find({ employee: emp._id }).sort({ date: -1 }).limit(90);
  res.json({
    attendance: history.map((a) => ({
      id: a._id,
      date: a.date ? a.date.toISOString().slice(0, 10) : '',
      status: a.status || 'present',
      checkInTime: a.checkInTime || '',
      checkOutTime: a.checkOutTime || '',
    })),
  });
}

export async function getTeamAttendance(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const { date } = req.query;
  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
  const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

  const staffList = await Employee.find({ branch: { $in: branchIds }, isDeleted: false, status: 'active' })
    .populate('branch', 'code name')
    .populate('designation', 'name');

  const attendances = await Attendance.find({
    employee: { $in: staffList.map((s) => s._id) },
    date: { $gte: startOfDay, $lte: endOfDay },
  });

  const attMap = new Map();
  attendances.forEach((a) => attMap.set(String(a.employee), a));

  res.json({
    date: startOfDay.toISOString().slice(0, 10),
    records: staffList.map((s) => {
      const att = attMap.get(String(s._id));
      return {
        id: s._id,
        code: s.employeeCode,
        name: s.name,
        designation: s.designation?.name || 'Staff',
        branchName: s.branch?.name || '',
        status: att?.status || 'Not Marked',
        checkIn: att?.checkInTime || '—',
      };
    }),
  });
}

// -----------------------------------------------------------------------------
// 11. TEAM-WISE CENTER VISIT REQUESTS / LOGS (Item 22)
// -----------------------------------------------------------------------------

export async function getTeamCenterVisits(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const visits = await CenterVisit.find({ branch: { $in: branchIds } })
    .populate('branch', 'code name')
    .sort({ createdAt: -1 })
    .limit(100);

  res.json({ visits });
}

export async function updateCenterVisitStatus(req, res) {
  const { id } = req.params;
  const { status, remark = '' } = req.body || {};
  if (!['done', 'not_done', 'cancelled'].includes(status)) {
    throw new HttpError(400, 'Status must be done, not_done, or cancelled');
  }

  const visit = await CenterVisit.findById(id);
  if (!visit) throw new HttpError(404, 'Center visit record not found');

  visit.status = status;
  if (remark) {
    visit.notes = (visit.notes ? `${visit.notes} | ` : '') + `[Status Update: ${status.toUpperCase()}] ${remark}`;
  }
  await visit.save();

  res.json({
    status: 'ok',
    visitId: visit._id,
    newStatus: status,
    message: `Center visit marked as ${status === 'not_done' ? 'NOT Done' : status === 'cancelled' ? 'Cancelled' : 'Done'}`,
  });
}

// -----------------------------------------------------------------------------
// 12. LEAVE APPROVAL WITH REJECT DATE & PERMISSION (Item 23)
// -----------------------------------------------------------------------------

export async function getStaffLeaves(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const leaves = await Leave.find({ branch: { $in: branchIds } })
    .populate('employee', 'name employeeCode mobile designation photo')
    .populate('branch', 'code name')
    .sort({ createdAt: -1 });

  res.json({ leaves });
}

export async function decideStaffLeave(req, res) {
  const code = req.user?.employeeCode;
  const { id } = req.params;
  const { action, rejectReason, remark, fromDate, toDate, from, to, days, decisionDate, rejectDate } = req.body || {};

  if (!['approved', 'rejected'].includes(action)) {
    throw new HttpError(400, "Action must be 'approved' or 'rejected'");
  }

  const leave = await Leave.findById(id);
  if (!leave) throw new HttpError(404, 'Leave request not found');

  // Point 10: Allow supervisor to edit leave dates upon decision
  const resolvedFrom = fromDate || from;
  const resolvedTo = toDate || to;
  if (resolvedFrom) leave.from = new Date(resolvedFrom);
  if (resolvedTo) leave.to = new Date(resolvedTo);
  if (days && Number(days) > 0) {
    leave.days = Number(days);
  } else if (leave.from && leave.to) {
    const diffDays = Math.max(1, Math.round((new Date(leave.to) - new Date(leave.from)) / (24 * 60 * 60 * 1000)) + 1);
    leave.days = diffDays;
  }

  leave.status = action;
  leave.decidedByCode = code;
  leave.decidedAt = decisionDate ? new Date(decisionDate) : rejectDate ? new Date(rejectDate) : new Date();

  if (action === 'rejected') {
    leave.rejectReason = rejectReason || remark || 'Rejected by Supervisor';
  } else {
    leave.decisionRemark = remark || 'Approved by Supervisor';
  }

  await leave.save();

  // Notify employee of leave decision and updated dates
  notifyEmployee(
    leave.employee,
    `Leave Application ${action.toUpperCase()}`,
    `Your leave application from ${leave.from ? new Date(leave.from).toISOString().slice(0, 10) : ''} to ${leave.to ? new Date(leave.to).toISOString().slice(0, 10) : ''} (${leave.days} day${leave.days === 1 ? '' : 's'}) has been ${action} by Supervisor ${code}.`
  ).catch(() => {});

  res.json({
    status: 'ok',
    message: `Leave request has been ${action} successfully.`,
    leave,
  });
}

// -----------------------------------------------------------------------------
// 13. COMPLAINTS: SUBMIT & BRANCH/EMPLOYEE REPORT (Item 24)
// -----------------------------------------------------------------------------

export async function submitSupervisorComplaint(req, res) {
  const code = req.user?.employeeCode;
  const { branchId, category = 'other', description, callerName, callerMobile } = req.body || {};

  if (!description) throw new HttpError(400, 'Complaint description is required');

  const complaintNo = await generateCode('complaint').catch(() => `CMP${Date.now().toString().slice(-6)}`);
  const doc = await Complaint.create({
    complaintNo,
    date: new Date(),
    branch: branchId || req.user?.branchId,
    callerName: callerName || req.user?.name || 'Supervisor',
    callerMobile: callerMobile || req.user?.mobile || '',
    category,
    description,
    enteredByCode: code,
    status: 'open',
  });

  res.status(201).json({ status: 'ok', message: 'Complaint submitted successfully', complaint: doc });
}

export async function getComplaintsReport(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const complaints = await Complaint.find({ branch: { $in: branchIds } })
    .populate('branch', 'code name')
    .sort({ createdAt: -1 });

  res.json({ complaints });
}

// -----------------------------------------------------------------------------
// 14. RESIGNATION: SUBMIT & STAFF REPORT (Item 25)
// -----------------------------------------------------------------------------

export async function submitSupervisorResignation(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const { lastWorkingDate, reason } = req.body || {};
  if (!lastWorkingDate || !reason) throw new HttpError(400, 'Last working date and reason are required');

  const doc = await Resignation.create({
    employee: emp._id,
    employeeCode: emp.employeeCode,
    employeeName: emp.name,
    branch: emp.branch,
    appliedOn: new Date(),
    lastWorkingDate: new Date(lastWorkingDate),
    reason,
    appliedByCode: code,
    status: 'pending',
  });

  res.status(201).json({ status: 'ok', message: 'Resignation submitted successfully', resignation: doc });
}

export async function getResignationsReport(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const resignations = await Resignation.find({ branch: { $in: branchIds } })
    .populate('employee', 'name employeeCode designation mobile photo')
    .populate('branch', 'code name')
    .sort({ createdAt: -1 });

  res.json({ resignations });
}

// -----------------------------------------------------------------------------
// 15. REPORT BRANCH TRANSFER REQUEST (Item 26)
// -----------------------------------------------------------------------------

export async function getBranchTransferReport(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const transfers = await EmployeeChange.find({
    kind: 'transfer',
    $or: [{ fromBranch: { $in: branchIds } }, { toBranch: { $in: branchIds } }],
  })
    .populate('employee', 'name employeeCode designation mobile')
    .populate('fromBranch', 'code name')
    .populate('toBranch', 'code name')
    .sort({ createdAt: -1 });

  res.json({ transfers });
}

// -----------------------------------------------------------------------------
// 16. REPORT PRODUCT SELL (Item 27)
// -----------------------------------------------------------------------------

export async function getProductSalesReport(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const sales = await ProductSaleOrder.find({ branch: { $in: branchIds } })
    .populate('branch', 'code name')
    .sort({ createdAt: -1 });

  const totalAmount = sales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalUnits = sales.reduce((acc, s) => acc + (s.quantity || 0), 0);

  res.json({
    summary: { totalAmount, totalUnits, totalOrders: sales.length },
    sales,
  });
}

// -----------------------------------------------------------------------------
// 17. STAFF RATING (Item 28 - Admin and Staff ko show hoga)
// -----------------------------------------------------------------------------

export async function rateStaffMember(req, res) {
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

  const total = mpinDoc.ratings.reduce((sum, r) => sum + r.stars, 0);
  mpinDoc.averageRating = Math.round((total / mpinDoc.ratings.length) * 10) / 10;
  await mpinDoc.save();

  // Also save averageRating and rating entry on targetEmp model for Admin HR & Staff App visibility
  targetEmp.averageRating = mpinDoc.averageRating;
  if (!Array.isArray(targetEmp.ratings)) targetEmp.ratings = [];
  targetEmp.ratings.unshift({
    stars,
    review,
    supervisorCode,
    supervisorName: supervisor?.name || supervisorCode,
    date: new Date(),
  });
  await targetEmp.save();

  res.json({
    status: 'ok',
    message: `Rating of ${stars} stars submitted for ${targetEmp.name}!`,
    averageRating: mpinDoc.averageRating,
  });
}

export async function getStaffRatingsList(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  // Point 11: Strictly exclude the supervisor themselves so their own name doesn't appear
  const staff = await Employee.find({
    branch: { $in: branchIds },
    employeeCode: { $ne: code },
    _id: { $ne: emp._id },
    isDeleted: false,
    status: 'active',
  })
    .populate('branch', 'code name')
    .populate('designation', 'name');

  const mpins = await EmployeeMpin.find({ employeeCode: { $in: staff.map((s) => s.employeeCode) } });
  const mpinMap = new Map();
  mpins.forEach((m) => mpinMap.set(m.employeeCode, m));

  res.json({
    staff: staff.map((s) => {
      const doc = mpinMap.get(s.employeeCode);
      const avg = s.averageRating || doc?.averageRating || 5;
      const allRatings = (s.ratings?.length ? s.ratings : doc?.ratings) || [];
      return {
        id: s._id,
        code: s.employeeCode,
        name: s.name,
        designation: s.designation?.name || 'Field Officer',
        branchName: s.branch?.name || '',
        photo: s.photo || '',
        averageRating: avg,
        ratings: allRatings,
      };
    }),
  });
}

// -----------------------------------------------------------------------------
// 18. CENTER VISIT REPORT WITH AUTO LOCATION & PHOTO (Item 29)
// -----------------------------------------------------------------------------

export async function recordSupervisorCenterVisit(req, res) {
  const code = req.user?.employeeCode;
  const { centerName, groupName, contactName, contactNumber, image, location, notes } = req.body || {};

  if (!centerName) throw new HttpError(400, 'Center name is required');

  const emp = await Employee.findOne({ employeeCode: code });
  const visit = await CenterVisit.create({
    employeeCode: code,
    employeeName: emp?.name || 'Supervisor',
    branch: emp?.branch || req.user?.branchId,
    centerName,
    contactName: contactName || groupName || 'Center Group',
    contactNumber: contactNumber || '—',
    image: image || '',
    location: location || { lat: 0, lng: 0, address: 'Captured via App GPS' },
    visitDate: new Date(),
    notes: notes || '',
  });

  res.status(201).json({ status: 'ok', message: 'Center visit report submitted successfully!', visit });
}

// -----------------------------------------------------------------------------
// 19. EMPLOYEE REQUISITION (Item 30 - Branch name, designation, count, reason, experience)
// -----------------------------------------------------------------------------

export async function submitStaffRequisition(req, res) {
  const code = req.user?.employeeCode;
  const { branchId, designation, count, reason, experience } = req.body || {};

  if (!branchId) throw new HttpError(400, 'Branch is required');
  if (!count || Number(count) < 1) throw new HttpError(400, 'Please enter number of employees needed');
  if (!reason) throw new HttpError(400, 'Reason for hiring is required');

  const reqNo = await generateCode('requirement').catch(() => `REQ${Date.now().toString().slice(-6)}`);
  const doc = await Requirement.create({
    reqNo,
    branch: branchId,
    count: Number(count),
    reason: `${reason}${experience ? ` (Experience Required: ${experience})` : ''}`,
    expectedTime: experience || 'Immediate',
    requestedByCode: code,
    status: 'pending',
  });

  res.status(201).json({
    status: 'ok',
    message: 'Employee requisition submitted to Admin/HR successfully!',
    requisition: doc,
  });
}

export async function listStaffRequisitions(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const requisitions = await Requirement.find({ branch: { $in: branchIds } })
    .populate('branch', 'code name city')
    .sort({ createdAt: -1 });

  res.json({ requisitions });
}

// -----------------------------------------------------------------------------
// 20. SUPERVISED STAFF LIST & FULL DOSSIER (Handwritten Sheet: Point 1)
// "Employee ka All data supervisor pe show ho. Jiss Supervisor ka mail id ya
// employee code jis jis employee k sath attached hoga wahi wahi employee ka All data"
// -----------------------------------------------------------------------------

export async function getSupervisedEmployeesList(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const staff = await getSupervisedEmployees(emp, req.user);
  res.json({
    total: staff.length,
    staff: staff.map((s) => ({
      id: s._id,
      code: s.employeeCode,
      name: s.name,
      designation: s.designation?.name || 'Field Officer',
      branch: s.branch ? { id: s.branch._id, code: s.branch.code, name: s.branch.name } : null,
      mobile: s.mobile || '',
      email: s.email || '',
      photo: s.photo || '',
      averageRating: s.averageRating || 5,
      status: s.status,
    })),
  });
}

export async function getEmployeeFullDossier(req, res) {
  const { id } = req.params;
  const emp = await Employee.findById(id)
    .populate('branch', 'code name city pincode')
    .populate('department', 'name')
    .populate('designation', 'name');
  if (!emp) throw new HttpError(404, 'Employee record not found');

  // 1. Recent Attendance (Last 30 records)
  const attendance = await Attendance.find({ employee: emp._id })
    .sort({ date: -1 })
    .limit(30)
    .lean();

  // 2. Assigned Tasks (Pending and Completed)
  const tasks = await Task.find({
    $or: [{ assignedTo: emp._id }, { assignedToCode: emp.employeeCode }],
  })
    .sort({ dueDate: 1 })
    .lean();

  // 3. Center Visits
  const visits = await CenterVisit.find({ employeeCode: emp.employeeCode })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  // 4. Leaves
  const leaves = await Leave.find({
    $or: [{ employee: emp._id }, { employeeCode: emp.employeeCode }],
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  // 5. Ratings
  const mpinDoc = await EmployeeMpin.findOne({ employeeCode: emp.employeeCode });

  // 6. Today's collections
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));
  const todayCollections = await EmiPayment.find({
    $or: [{ employeeCode: emp.employeeCode }, { collectedByCode: emp.employeeCode }],
    status: 'paid',
    paidOn: { $gte: todayStart, $lte: todayEnd },
  }).lean();

  const totalCollectedToday = todayCollections.reduce((acc, c) => acc + (c.amountPaise || 0) / 100, 0);

  res.json({
    employee: {
      id: emp._id,
      code: emp.employeeCode,
      name: emp.name,
      designation: emp.designation?.name || 'Field Officer',
      department: emp.department?.name || 'Operations',
      branch: emp.branch ? `${emp.branch.code} — ${emp.branch.name}` : '',
      mobile: emp.mobile || '',
      email: emp.email || '',
      joiningDate: emp.joiningDate ? emp.joiningDate.toISOString().slice(0, 10) : '',
      photo: emp.photo || '',
      averageRating: mpinDoc?.averageRating || emp.averageRating || 5,
      ratings: mpinDoc?.ratings || [],
    },
    performance: {
      todayCollectedAmount: Math.round(totalCollectedToday),
      todayReceiptsCount: todayCollections.length,
      pendingTasksCount: tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
    },
    attendance: attendance.map((a) => ({
      id: a._id,
      date: a.date ? a.date.toISOString().slice(0, 10) : '',
      status: a.status || 'present',
      checkInTime: a.checkInTime || '—',
    })),
    tasks,
    visits,
    leaves,
  });
}

// -----------------------------------------------------------------------------
// 21. SUPERVISOR LIVE NOTIFICATIONS (Handwritten Sheet: Point 2)
// "Notification aayega dekhne ke baad jayega"
// -----------------------------------------------------------------------------

export async function getSupervisorNotifications(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const staff = await getSupervisedEmployees(emp, req.user);
  const staffIds = staff.map((s) => s._id);
  const staffCodes = staff.map((s) => s.employeeCode);

  const notifications = [];

  // 1. Pending Leaves from supervised staff
  const pendingLeaves = await Leave.find({
    $or: [{ branch: { $in: branchIds } }, { employee: { $in: staffIds } }],
    status: 'pending',
  })
    .populate('employee', 'name employeeCode')
    .sort({ createdAt: -1 })
    .limit(5);

  pendingLeaves.forEach((l) => {
    notifications.push({
      id: `leave_${l._id}`,
      type: 'leave',
      title: 'Pending Leave Request',
      message: `${l.employee?.name || l.employeeName || 'Staff'} has applied for ${l.type} leave (${l.days || 1} days)`,
      link: '/supervisor/leaves',
      time: l.createdAt ? new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today',
      read: false,
    });
  });

  // 2. Open Complaints
  const openComplaints = await Complaint.find({
    branch: { $in: branchIds },
    status: 'open',
  })
    .sort({ createdAt: -1 })
    .limit(5);

  openComplaints.forEach((c) => {
    notifications.push({
      id: `complaint_${c._id}`,
      type: 'complaint',
      title: 'Branch Complaint Filed',
      message: `${c.complaintNo}: ${c.category} - ${c.description?.slice(0, 45)}…`,
      link: '/supervisor/complaints',
      time: c.createdAt ? new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today',
      read: false,
    });
  });

  // 3. Pending Resignations
  const pendingResignations = await Resignation.find({
    $or: [{ branch: { $in: branchIds } }, { employee: { $in: staffIds } }],
    status: 'pending',
  })
    .populate('employee', 'name')
    .limit(3);

  pendingResignations.forEach((r) => {
    notifications.push({
      id: `resign_${r._id}`,
      type: 'resignation',
      title: 'Resignation Application',
      message: `${r.employee?.name || r.employeeName || 'Staff'} applied for resignation`,
      link: '/supervisor/resignation',
      time: r.appliedOn ? new Date(r.appliedOn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent',
      read: false,
    });
  });

  // 4. Pending Tasks due
  const pendingTasks = await Task.find({
    $or: [{ assignedTo: { $in: staffIds } }, { assignedToCode: { $in: staffCodes } }],
    status: { $in: ['open', 'in_progress'] },
  })
    .limit(5);

  pendingTasks.forEach((t) => {
    notifications.push({
      id: `task_${t._id}`,
      type: 'task',
      title: 'Pending Staff Task',
      message: `${t.assignedToName || t.assignedToCode}: ${t.title}`,
      link: '/supervisor/tasks',
      time: t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'Due Soon',
      read: false,
    });
  });

  // 5. Scheduled Branch Visits (Point 9: SupervisorVisit)
  const branchVisits = await SupervisorVisit.find({
    $or: [{ supervisor: emp._id }, { supervisorCode: code }, { branch: { $in: branchIds } }],
    visitDate: { $gte: startOfToday() },
    status: { $ne: 'cancelled' },
  })
    .populate('branch', 'code name city pincode')
    .sort({ visitDate: 1 })
    .limit(5);

  branchVisits.forEach((v) => {
    notifications.push({
      id: `visit_${v._id}`,
      type: 'branch_visit',
      title: 'Scheduled Branch Visit',
      message: `Branch visit scheduled at ${v.branchCode} - ${v.branchName} (${v.branchCity || ''}) on ${v.visitDate ? new Date(v.visitDate).toISOString().slice(0, 10) : 'Today'}`,
      link: '/supervisor/center-visits',
      time: v.visitDate ? new Date(v.visitDate).toLocaleDateString() : 'Today',
      read: false,
    });
  });

  res.json({
    total: notifications.length,
    notifications,
  });
}

export async function dismissSupervisorNotification(req, res) {
  // Returns success so client marks as read/dismissed in local cache and UI
  res.json({ status: 'ok', message: 'Notification dismissed' });
}

// -----------------------------------------------------------------------------
// 22. SUPERVISOR TASKS: PENDING & ASSIGNED (Points 7 & 12)
// "Task show and Pending" + Module Categories Dropdown
// -----------------------------------------------------------------------------

export async function getSupervisorTasks(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const staff = await getSupervisedEmployees(emp, req.user);
  const staffIds = staff.map((s) => s._id);
  const staffCodes = staff.map((s) => s.employeeCode);

  const { category } = req.query;
  const query = {
    $or: [
      { assignedTo: { $in: staffIds } },
      { assignedToCode: { $in: staffCodes } },
      { branch: { $in: branchIds } },
      { createdByCode: code },
      { assignedTo: emp._id },
      { assignedToCode: code },
    ],
  };

  if (category && category !== 'all') {
    query.category = category;
  }

  const tasks = await Task.find(query)
    .sort({ dueDate: 1, createdAt: -1 })
    .lean();

  const pendingTasks = tasks.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const completedTasks = tasks.filter((t) => t.status === 'completed' || t.status === 'done');

  res.json({
    summary: {
      totalTasks: tasks.length,
      pendingCount: pendingTasks.length,
      completedCount: completedTasks.length,
    },
    tasks,
    pendingTasks,
    completedTasks,
    categories: ['Disbursement', 'Collections', 'New Member', 'Product', 'NPA Report', 'General'],
    staff: staff.map((s) => ({ id: s._id, code: s.employeeCode, name: s.name, designation: s.designation?.name })),
  });
}

export async function createSupervisorTask(req, res) {
  const code = req.user?.employeeCode;
  const { title, description, assignedToId, dueDate, priority = 'medium', category = 'General' } = req.body || {};

  if (!title) throw new HttpError(400, 'Task title is required');
  if (!assignedToId) throw new HttpError(400, 'Please select employee to assign task');

  const assignedEmp = await Employee.findById(assignedToId).populate('branch');
  if (!assignedEmp) throw new HttpError(404, 'Assigned staff member not found');

  const task = await Task.create({
    title: cleanStr(title),
    description: cleanStr(description),
    category: cleanStr(category) || 'General',
    branch: assignedEmp.branch?._id || assignedEmp.branch,
    assignedTo: assignedEmp._id,
    assignedToCode: assignedEmp.employeeCode,
    assignedToName: assignedEmp.name,
    dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    priority,
    status: 'open',
    createdByCode: code,
  });

  // Notify staff member in Employee App
  notifyEmployee(
    assignedEmp._id,
    `New Task Assigned: ${task.title}`,
    `Supervisor ${code} has assigned you a task (${task.category}): ${task.title}. Due date: ${task.dueDate ? task.dueDate.toISOString().slice(0, 10) : 'Immediate'}.`
  ).catch(() => {});

  res.status(201).json({
    status: 'ok',
    message: `Task assigned to ${assignedEmp.name} successfully!`,
    task,
  });
}

export async function updateSupervisorTaskStatus(req, res) {
  const code = req.user?.employeeCode;
  const { id } = req.params;
  const { status, remark } = req.body || {};

  const task = await Task.findById(id);
  if (!task) throw new HttpError(404, 'Task not found');

  // Accept both 'completed' and 'done' without schema validation failures
  const cleanStatus = status === 'completed' ? 'done' : status;
  task.status = cleanStatus;

  if (!task.history) task.history = [];
  task.history.push({
    status: cleanStatus,
    remark: remark || `Updated by Supervisor ${code}`,
    byCode: code,
    at: new Date(),
  });
  await task.save();

  res.json({ status: 'ok', message: `Task status updated to ${status}!`, task });
}

// -----------------------------------------------------------------------------
// 23. BRANCH VISITS (SUPERVISOR VISIT SYSTEM LINKAGE - Point 9)
// "New Branch Visit system se update ke baad Home Page se show nahi ho raha hai"
// -----------------------------------------------------------------------------

export async function getSupervisorBranchVisits(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false });
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const branchIds = await getSupervisorBranchIds(emp, req.user);
  const visits = await SupervisorVisit.find({
    $or: [{ supervisor: emp._id }, { supervisorCode: code }, { branch: { $in: branchIds } }],
  })
    .populate('branch', 'code name city pincode state address')
    .sort({ visitDate: -1, createdAt: -1 })
    .limit(100)
    .lean();

  res.json({
    total: visits.length,
    visits,
  });
}

export async function recordSupervisorBranchVisit(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false }).populate('branch');
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const { branchId, visitDate, roomRentCharged = true, notes = '' } = req.body || {};
  if (!branchId) throw new HttpError(400, 'Branch selection is required for Branch Visit');

  const targetBranch = await Branch.findById(branchId);
  if (!targetBranch) throw new HttpError(404, 'Target branch not found');

  const parsedDate = visitDate ? new Date(visitDate) : new Date();

  // Point 9: Persist directly into the system's SupervisorVisit collection
  const visit = await SupervisorVisit.create({
    supervisor: emp._id,
    supervisorCode: emp.employeeCode,
    supervisorName: emp.name,
    supervisorMobile: emp.mobile || '',
    branch: targetBranch._id,
    branchCode: targetBranch.code,
    branchName: targetBranch.name,
    branchCity: targetBranch.city || '',
    branchPincode: targetBranch.pincode || '',
    visitDate: parsedDate,
    roomRentCharged: Boolean(roomRentCharged),
    notes: cleanStr(notes),
    status: 'scheduled',
    createdByCode: code,
  });

  const msg = `Branch visit scheduled on ${parsedDate.toISOString().slice(0, 10)} for branch ${targetBranch.code} - ${targetBranch.name} (${targetBranch.city || ''}, Pincode: ${targetBranch.pincode || ''}).`;
  notifyEmployee(emp._id, 'Branch Visit Scheduled', msg).catch(() => {});

  await audit(req, {
    action: 'supervisorApp.branchVisit',
    entity: 'SupervisorVisit',
    entityId: visit._id,
    after: { supervisor: emp.employeeCode, branch: targetBranch.code, date: parsedDate.toISOString().slice(0, 10) },
  });

  res.status(201).json({
    status: 'ok',
    message: `Branch visit for ${targetBranch.name} recorded into system successfully!`,
    visit,
  });
}

export async function updateSupervisorBranchVisitStatus(req, res) {
  const code = req.user?.employeeCode;
  const { id } = req.params;
  const { status, notes } = req.body || {};

  const visit = await SupervisorVisit.findById(id);
  if (!visit) throw new HttpError(404, 'Branch visit record not found');

  if (status) visit.status = status;
  if (notes) visit.notes = (visit.notes ? `${visit.notes} | ` : '') + cleanStr(notes);
  await visit.save();

  res.json({
    status: 'ok',
    message: `Branch visit status updated to ${visit.status}!`,
    visit,
  });
}


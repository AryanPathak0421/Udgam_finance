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
import { Group } from '../../models/Group.js';
import { Task, Complaint, Leave, Resignation, Requirement, EmployeeChange } from '../../models/HrExtra.js';
import { Holiday } from '../../models/SuperAdmin.js';
import { Company } from '../../models/Company.js';
import { BankAccount } from '../../models/BankAccount.js';
import { generateCode } from '../../services/codeSequence.js';
import { issueOtp, takeVerified, consumeChallenge } from '../../services/otpChallenges.js';
import { sendSms } from '../../services/sms.js';
import { asString, parseDateOnly, HttpError, startOfToday, todayDateString } from '../../utils/http.js';
import { audit } from '../../utils/audit.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-udgam-2026';
const COOKIE_NAME = process.env.COOKIE_NAME || 'udgam_token';

const cleanStr = (s) => String(s || '').trim();

// Finds matching Employee record for Supervisor by code, mobile or email
async function findSupervisor(identifier) {
  const id = cleanStr(identifier);
  if (!id) return null;
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id);
  const isPhone = /^\d{10}$/.test(id.replace(/\D/g, ''));
  const query = { isDeleted: false };
  if (isEmail) query.email = id.toLowerCase();
  else if (isPhone) query.mobile = id.slice(-10);
  else query.employeeCode = id.toUpperCase();

  let emp = await Employee.findOne(query)
    .populate('branch', 'code name city pincode')
    .populate('supervisedBranches', 'code name city pincode')
    .populate('department', 'name')
    .populate('designation', 'name');

  if (!emp) {
    const userQuery = {};
    if (isEmail) userQuery.email = id.toLowerCase();
    else if (isPhone) userQuery.mobile = id.slice(-10);
    else userQuery.employeeCode = id.toUpperCase();
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

// -----------------------------------------------------------------------------
// 1. AUTHENTICATION & MPIN
// -----------------------------------------------------------------------------

export async function lookupSupervisor(req, res) {
  const identifier = req.body?.identifier || req.query?.identifier;
  const emp = await findSupervisor(identifier);
  if (!emp) throw new HttpError(404, 'Supervisor record not found in system. Please contact Admin/HR to register you first.');

  const mpinRecord = await EmployeeMpin.findOne({ employeeCode: emp.employeeCode });
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

  const emp = await Employee.findOne({ employeeCode: code, isDeleted: false }).populate('designation');
  if (!emp) throw new HttpError(404, 'Supervisor not found');

  const user = await ensureUserForSupervisor(emp);
  const mpinHash = await EmployeeMpin.hashMpin(mpin);

  let record = await EmployeeMpin.findOne({ employeeCode: code });
  if (record) {
    record.mpinHash = mpinHash;
    record.mobile = emp.mobile;
    record.email = emp.email;
    record.isSupervisor = true;
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

  const mpinDoc = await EmployeeMpin.findOne({ employeeCode: emp.employeeCode }).select('+mpinHash');
  if (!mpinDoc) throw new HttpError(401, 'mPIN not set. Please create your mPIN first.');

  const ok = await mpinDoc.compareMpin(mpin);
  if (!ok) throw new HttpError(401, 'Incorrect mPIN');

  const user = await ensureUserForSupervisor(emp);
  mpinDoc.lastLoginAt = new Date();
  mpinDoc.isSupervisor = true;
  await mpinDoc.save();

  const token = jwt.sign(
    {
      id: user._id,
      userId: user._id,
      role: user.role,
      employeeCode: emp.employeeCode,
      branchId: emp.branch?._id || user.branches?.[0] || null,
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
      id: user._id,
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

  loans.forEach((l) => {
    const dueInst = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= todayEnd);
    if (!dueInst.length) return;
    const latest = dueInst[dueInst.length - 1];
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
    },
    staffWiseDues: Object.values(staffDueMap),
    branchWiseDues: Object.values(branchDueMap),
    branches,
    staffMembers,
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

  const todayEnd = new Date(`${todayDateString()}T23:59:59.999Z`);
  const loans = await LoanPayment.find({
    branch: { $in: filterBranchIds },
    status: 'paid',
  })
    .select('loanId formId mode modeLabel group lines schedule branch employeeCode')
    .populate('branch', 'code name')
    .lean();

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
    const dueInst = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= todayEnd);
    if (!dueInst.length) return;
    const latest = dueInst[dueInst.length - 1];
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

      const item = {
        loanPaymentId: l._id,
        loanId: l._id,
        loanNo: l.loanId || l.formId || String(l._id).slice(-6).toUpperCase(),
        memberCode: line.code || '',
        memberName: line.name || 'Borrower',
        memberMobile: '',
        centerName: center,
        branchName: branchMap[bId]?.branchName || l.branch?.name || '',
        overdueDays: Math.min(365, overdueSchedules.length * 7 || 90),
        balanceAmount: amount,
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
    }
  }

  res.json({
    totalNpaLoans: npaList.length,
    totalNpaAmount: npaList.reduce((sum, l) => sum + l.balanceAmount, 0),
    branchWise: Object.values(branchMap),
    centerWise: Object.values(centerMap),
  });
}

export async function recoverNpaLoan(req, res) {
  const { loanPaymentId, memberCode, amount, payMode = 'Cash', reference = '' } = req.body || {};
  const payAmount = Number(amount);
  if (!payAmount || payAmount < 1) throw new HttpError(400, 'Enter recovery amount of ₹1 or more');

  const loan = await LoanPayment.findById(loanPaymentId);
  if (!loan) throw new HttpError(404, 'Loan record not found');

  const line = (loan.lines || []).find((l) => l.code === memberCode) || loan.lines?.[0] || { code: 'N/A', name: 'Borrower' };
  const receiptNo = await generateCode('emiReceipt').catch(() => `NPA${Date.now().toString().slice(-8)}`);

  const doc = await EmiPayment.create({
    receiptNo,
    loanPayment: loan._id,
    loanId: loan.loanId,
    formId: loan.formId,
    branch: loan.branch,
    type: 'regular',
    npa: true,
    member: line.member || null,
    memberCode: line.code,
    memberName: line.name,
    amountPaise: Math.round(payAmount * 100),
    paidOn: new Date(),
    payMode: payMode || 'Cash',
    reference,
    employeeCode: req.user?.employeeCode || '',
    createdBy: req.user._id,
    createdByCode: req.user?.employeeCode || '',
    status: 'paid',
  });

  res.status(201).json({
    success: true,
    receiptNo: doc.receiptNo,
    amount: payAmount,
    loanId: loan.loanId,
    memberCode: line.code,
    memberName: line.name,
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

  const slips = await Salary.find({ employee: emp._id }).sort({ year: -1, month: -1 });
  res.json({
    slips: slips.map((s) => ({
      id: s._id,
      month: s.month,
      year: s.year,
      basicSalary: s.basicSalary || emp.monthlySalary || 0,
      netSalary: s.netSalary || emp.monthlySalary || 0,
      deductions: s.deductions || 0,
      allowances: s.allowances || 0,
      status: s.status || 'Paid',
      paymentDate: s.paymentDate || s.createdAt,
    })),
  });
}

// -----------------------------------------------------------------------------
// 10. ATTENDANCE: PERSONAL & TEAM-WISE (Items 20, 21)
// -----------------------------------------------------------------------------

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
  const { action, rejectReason, remark } = req.body || {};

  if (!['approved', 'rejected'].includes(action)) {
    throw new HttpError(400, "Action must be 'approved' or 'rejected'");
  }

  const leave = await Leave.findById(id);
  if (!leave) throw new HttpError(404, 'Leave request not found');

  leave.status = action;
  leave.decidedByCode = code;
  leave.decidedAt = new Date();

  if (action === 'rejected') {
    leave.rejectReason = rejectReason || remark || 'Rejected by Supervisor';
  } else {
    leave.decisionRemark = remark || 'Approved by Supervisor';
  }

  await leave.save();
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

  // Also save averageRating on targetEmp model for Admin HR visibility
  targetEmp.averageRating = mpinDoc.averageRating;
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
  const staff = await Employee.find({ branch: { $in: branchIds }, isDeleted: false, status: 'active' })
    .populate('branch', 'code name')
    .populate('designation', 'name');

  const mpins = await EmployeeMpin.find({ employeeCode: { $in: staff.map((s) => s.employeeCode) } });
  const mpinMap = new Map();
  mpins.forEach((m) => mpinMap.set(m.employeeCode, m));

  res.json({
    staff: staff.map((s) => {
      const doc = mpinMap.get(s.employeeCode);
      return {
        id: s._id,
        code: s.employeeCode,
        name: s.name,
        designation: s.designation?.name || 'Field Officer',
        branchName: s.branch?.name || '',
        photo: s.photo || '',
        averageRating: doc?.averageRating || 5,
        ratings: doc?.ratings || [],
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


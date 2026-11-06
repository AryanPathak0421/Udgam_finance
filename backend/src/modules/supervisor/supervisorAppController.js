import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import {
  EmployeeMpin,
  CenterVisit,
  CgtVisit,
  FirstMeetingAttendance,
} from '../employee/employeeAppModel.js';
import { Employee, Department, Designation, Attendance, Salary } from '../../models/Hr.js';
import { User } from '../../models/User.js';
import { Branch } from '../../models/Branch.js';
import { Member } from '../../models/Member.js';
import { LoanPayment } from '../../models/LoanPayment.js';
import { EmiPayment } from '../../models/EmiPayment.js';
import { Group } from '../../models/Group.js';
import { Task, Complaint, Leave, Resignation } from '../../models/HrExtra.js';
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

  // Managed branches
  const branches = await Branch.find({ _id: { $in: branchIds } }).select('code name city');
  // Managed staff
  const staffMembers = await Employee.find({ branch: { $in: branchIds }, isDeleted: false, status: 'active' })
    .select('employeeCode name designation branch mobile')
    .populate('branch', 'code name')
    .populate('designation', 'name');

  // Today Dues aggregated across supervised branches
  const today = todayDateString();
  const groups = await Group.find({ branch: { $in: branchIds }, isActive: true }).select('_id branch center staff leader');
  const groupIds = groups.map((g) => g._id);

  // Active loans under supervised groups/branches
  const loans = await LoanPayment.find({
    group: { $in: groupIds },
    status: { $in: ['active', 'disbursed'] },
    isSettled: false,
  })
    .populate('member', 'name mobile code branch')
    .populate('group', 'name center branch staff');

  let totalDueToday = 0;
  let totalDueCount = 0;
  let totalCollectedToday = 0;
  let totalCollectedCount = 0;

  // Track staff-wise and branch-wise due stats
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

  for (const loan of loans) {
    const emi = loan.emiAmount || loan.installmentAmount || 0;
    const bId = String(loan.group?.branch || loan.branch);
    const sCode = loan.group?.staff?.employeeCode || loan.createdByCode || 'OFFICER';

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
  }

  // Today collected EMIs
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const collectionsToday = await EmiPayment.find({
    branch: { $in: branchIds },
    createdAt: { $gte: todayStart },
  });

  for (const col of collectionsToday) {
    const amt = col.amount || 0;
    totalCollectedToday += amt;
    totalCollectedCount += 1;
    const bId = String(col.branch);
    const sCode = col.collectedByCode || col.createdByCode;

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
  const npaLoans = await LoanPayment.find({
    group: { $in: groupIds },
    isNpa: true,
  });
  const npaTotalAmount = npaLoans.reduce((sum, l) => sum + (l.balanceAmount || l.npaAmount || 0), 0);

  // New members registered this month
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const newMembersCount = await Member.countDocuments({
    branch: { $in: branchIds },
    createdAt: { $gte: monthStart },
  });

  res.json({
    metrics: {
      totalDueToday,
      totalDueCount,
      totalCollectedToday,
      totalCollectedCount,
      totalStaffCount: staffMembers.length,
      totalBranchCount: branches.length,
      npaCount: npaLoans.length,
      npaTotalAmount,
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
  const { branchId, staffCode } = req.query;

  let filterBranchIds = branchIds;
  if (branchId && mongoose.isValidObjectId(branchId)) {
    filterBranchIds = [new mongoose.Types.ObjectId(branchId)];
  }

  const groupsQuery = { branch: { $in: filterBranchIds }, isActive: true };
  const groups = await Group.find(groupsQuery).select('_id branch center staff name');
  const groupIds = groups.map((g) => g._id);

  const loans = await LoanPayment.find({
    group: { $in: groupIds },
    status: { $in: ['active', 'disbursed'] },
    isSettled: false,
  })
    .populate('member', 'name mobile code address photo')
    .populate('group', 'name center branch staff');

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

  for (const l of loans) {
    const emi = l.emiAmount || l.installmentAmount || 0;
    const bId = String(l.group?.branch || l.branch);
    const sCode = l.group?.staff?.employeeCode || l.createdByCode || 'OFFICER';

    const item = {
      loanId: l._id,
      loanNumber: l.loanNo || l.code,
      memberName: l.member?.name || 'Borrower',
      memberMobile: l.member?.mobile || '',
      memberPhoto: l.member?.photo || '',
      groupName: l.group?.name || 'Group',
      centerName: l.group?.center || '',
      emiAmount: emi,
      branchName: branchMap[bId]?.branchName || '',
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
  }

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

  const collections = await EmiPayment.find({
    branch: { $in: branchIds },
    createdAt: { $gte: todayStart },
  })
    .populate('member', 'name mobile code photo')
    .populate('branch', 'code name')
    .sort({ createdAt: -1 });

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
    const sCode = c.collectedByCode || c.createdByCode || 'OFFICER';
    const amt = c.amount || 0;

    const receipt = {
      id: c._id,
      receiptNo: c.receiptNo || String(c._id).slice(-6).toUpperCase(),
      memberName: c.member?.name || 'Member',
      amount: amt,
      paymentMode: c.paymentMode || 'Cash',
      time: c.createdAt ? new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
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
    totalAmount: collections.reduce((acc, c) => acc + (c.amount || 0), 0),
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
  const groups = await Group.find({ branch: { $in: branchIds } }).select('_id branch center name');
  const groupIds = groups.map((g) => g._id);

  const npaLoans = await LoanPayment.find({
    group: { $in: groupIds },
    isNpa: true,
  })
    .populate('member', 'name mobile photo code')
    .populate('group', 'name center branch');

  const branches = await Branch.find({ _id: { $in: branchIds } }).select('code name');

  // Group by branch and by center
  const branchMap = {};
  const centerMap = {};

  for (const b of branches) {
    branchMap[String(b._id)] = { branchId: b._id, branchName: b.name, totalNpaAmount: 0, loanCount: 0, loans: [] };
  }

  for (const l of npaLoans) {
    const bId = String(l.group?.branch || l.branch);
    const center = l.group?.center || 'Unassigned Center';
    const amount = l.balanceAmount || l.npaAmount || l.emiAmount || 0;

    const item = {
      loanId: l._id,
      loanNo: l.loanNo || l.code,
      memberName: l.member?.name || 'Borrower',
      memberMobile: l.member?.mobile || '',
      memberPhoto: l.member?.photo || '',
      centerName: center,
      branchName: branchMap[bId]?.branchName || '',
      overdueDays: l.overdueDays || 90,
      balanceAmount: amount,
    };

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

  res.json({
    totalNpaLoans: npaLoans.length,
    totalNpaAmount: npaLoans.reduce((sum, l) => sum + (l.balanceAmount || l.npaAmount || 0), 0),
    branchWise: Object.values(branchMap),
    centerWise: Object.values(centerMap),
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

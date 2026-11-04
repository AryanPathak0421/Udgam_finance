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
import { LoanRequisition } from '../../models/LoanRequisition.js';
import { LoanScheme } from '../../models/LoanScheme.js';
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
import { asString, parseDateOnly, HttpError, startOfToday, todayDateString } from '../../utils/http.js';
import { audit } from '../../utils/audit.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-udgam-2026';
const COOKIE_NAME = process.env.COOKIE_NAME || 'udgam_token';

const cleanStr = (s) => String(s || '').trim();

// Finds matching Employee record by code, mobile or email
async function findEmployee(identifier) {
  const id = cleanStr(identifier);
  if (!id) return null;
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id);
  const isPhone = /^\d{10}$/.test(id.replace(/\D/g, ''));
  const query = { isDeleted: false };
  if (isEmail) query.email = id.toLowerCase();
  else if (isPhone) query.mobile = id.slice(-10);
  else query.employeeCode = id.toUpperCase();
  return Employee.findOne(query).populate('branch', 'code name city pincode').populate('department', 'name').populate('designation', 'name');
}

// Ensure employee has a linked User account for token authentication
async function ensureUserForEmployee(emp) {
  let user = await User.findOne({ employeeCode: emp.employeeCode });
  if (!user && emp.email) user = await User.findOne({ email: emp.email.toLowerCase() });
  if (!user) {
    const role = /manager/i.test(emp.designation?.name || '') ? 'branch_manager' : 'field_officer';
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
  const emp = await findEmployee(identifier);
  if (!emp) throw new HttpError(404, 'Employee record not found in system. Please contact Admin/HR to register you first.');

  const mpinRecord = await EmployeeMpin.findOne({ employeeCode: emp.employeeCode });
  res.json({
    found: true,
    employeeCode: emp.employeeCode,
    name: emp.name,
    photo: emp.photo || '',
    branch: emp.branch ? { id: emp.branch._id, code: emp.branch.code, name: emp.branch.name } : null,
    department: emp.department?.name || 'Operations',
    designation: emp.designation?.name || 'Field Officer',
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
      userId: user._id,
      role: user.role,
      employeeCode: emp.employeeCode,
      branchId: emp.branch?._id || user.branches?.[0] || null,
      isEmployeeApp: true,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

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
  const from = new Date(`${dateStr}T00:00:00.000Z`);
  const to = new Date(`${dateStr}T23:59:59.999Z`);

  const list = await EmiPayment.find({
    employeeCode: code,
    status: 'paid',
    paidOn: { $gte: from, $lte: to },
  })
    .sort({ createdAt: -1 })
    .lean();

  const totalAmount = list.reduce((s, x) => s + x.amountPaise, 0) / 100;
  res.json({
    date: dateStr,
    totalAmount,
    count: list.length,
    items: list.map((e) => ({
      id: e._id,
      receiptNo: e.receiptNo,
      loanId: e.loanId || e.formId,
      memberCode: e.memberCode,
      memberName: e.memberName,
      group: e.group || '',
      amount: e.amountPaise / 100,
      payMode: e.payMode,
      time: e.createdAt ? new Date(e.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
    })),
  });
}

export async function getTodayDueList(req, res) {
  const code = req.user?.employeeCode;
  const dateStr = asString(req.query.date) || todayDateString();
  const asOf = new Date(`${dateStr}T23:59:59.999Z`);

  const loans = await LoanPayment.find({ employeeCode: code, status: 'paid' })
    .select('loanId formId mode modeLabel group lines schedule')
    .lean();

  const dues = [];
  loans.forEach((l) => {
    const dueInst = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= asOf);
    if (!dueInst.length) return;
    const latest = dueInst[dueInst.length - 1];
    l.lines.forEach((line) => {
      dues.push({
        loanId: l.loanId || l.formId,
        memberCode: line.code,
        memberName: line.name,
        groupName: l.group?.name || l.group?.code || 'Individual',
        installmentNo: latest.no,
        dueAmount: (latest.installmentPaise + (line.extraEmiPaise || 0)) / 100,
        dueDate: latest.dueDate.toISOString().slice(0, 10),
        mode: l.modeLabel || l.mode || 'Weekly',
      });
    });
  });

  const totalDue = dues.reduce((s, x) => s + x.dueAmount, 0);
  res.json({
    date: dateStr,
    totalDue,
    count: dues.length,
    items: dues,
  });
}

// -----------------------------------------------------------------------------
// 5. MEMBER REGISTRATION WITH PHONE OTP VERIFICATION FIRST
// -----------------------------------------------------------------------------

export async function sendMemberOtp(req, res) {
  const mobile = cleanStr(req.body?.mobile).replace(/\D/g, '').slice(-10);
  if (!/^\d{10}$/.test(mobile)) throw new HttpError(400, 'Enter a valid 10-digit mobile number');

  const { otp, challengeId } = await issueOtp(`mem_reg_${mobile}`, { ttlSec: 300 });
  await sendSms(mobile, `Your Udgam Member Registration verification OTP is ${otp}. Valid for 5 minutes.`);
  res.json({ challengeId, mobile, message: 'OTP sent to mobile' });
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
  const branchId = b.branch || emp?.branch?._id;
  if (!branchId) throw new HttpError(400, 'Branch is required');

  // Create member using standard model
  const count = await Member.countDocuments({});
  const memberCode = `M${String(count + 1001).padStart(6, '0')}`;

  const member = await Member.create({
    code: memberCode,
    branch: branchId,
    name: cleanStr(b.name),
    husbandName: cleanStr(b.husbandName),
    fatherName: cleanStr(b.fatherName),
    gender: b.gender || 'female',
    dob: parseDateOnly(b.dob) || new Date('1990-01-01'),
    mobile,
    mobileVerifiedAt: new Date(), // Blue tick verified!
    address: cleanStr(b.address),
    pincode: cleanStr(b.pincode),
    district: cleanStr(b.district),
    state: cleanStr(b.state),
    aadhaar: cleanStr(b.aadhaar),
    pan: cleanStr(b.pan),
    bankName: cleanStr(b.bankName),
    ifsc: cleanStr(b.ifsc),
    accountNumber: cleanStr(b.accountNumber),
    memberPhoto: b.memberPhoto || '',
    signaturePhoto: b.signaturePhoto || '',
    aadhaarPhoto: b.aadhaarPhoto || '',
    panPhoto: b.panPhoto || '',
    guarantor: {
      name: cleanStr(b.guarantorName),
      relation: cleanStr(b.guarantorRelation),
      mobile: cleanStr(b.guarantorMobile),
      aadhaar: cleanStr(b.guarantorAadhaar),
      address: cleanStr(b.guarantorAddress),
    },
    nominee: {
      name: cleanStr(b.nomineeName),
      relation: cleanStr(b.nomineeRelation),
    },
    employeeCode: code,
    joiningApproval: 'approved',
  });

  await audit(req, { action: 'member.createFromApp', entity: 'Member', entityId: member._id, after: { code: member.code, name: member.name } });
  res.status(201).json({ item: member, message: `Member ${member.code} registered successfully` });
}

// -----------------------------------------------------------------------------
// 6. MEMBER KYC & DOCUMENT RE-UPLOAD
// -----------------------------------------------------------------------------

export async function getMemberKyc(req, res) {
  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { code: req.params.id?.toUpperCase() }],
  }).populate('branch', 'code name');
  if (!m) throw new HttpError(404, 'Member not found');

  res.json({
    member: {
      id: m._id,
      code: m.code,
      name: m.name,
      mobile: m.mobile,
      isMobileVerified: Boolean(m.mobileVerifiedAt),
      aadhaar: m.aadhaar,
      isAadhaarVerified: Boolean(m.aadhaarVerifiedAt || m.aadhaarMatched),
      branch: m.branch?.name || '',
      docs: {
        photo: { status: m.memberPhoto ? 'uploaded' : 'missing', rejected: m.kycDocs?.find((d) => d.field === 'memberPhoto')?.rejected || false, reason: m.kycDocs?.find((d) => d.field === 'memberPhoto')?.reason || '' },
        signature: { status: m.signaturePhoto ? 'uploaded' : 'missing', rejected: m.kycDocs?.find((d) => d.field === 'signaturePhoto')?.rejected || false, reason: m.kycDocs?.find((d) => d.field === 'signaturePhoto')?.reason || '' },
        aadhaar: { status: m.aadhaarPhoto ? 'uploaded' : 'missing', rejected: m.kycDocs?.find((d) => d.field === 'aadhaarPhoto')?.rejected || false, reason: m.kycDocs?.find((d) => d.field === 'aadhaarPhoto')?.reason || '' },
        pan: { status: m.panPhoto ? 'uploaded' : 'missing', rejected: m.kycDocs?.find((d) => d.field === 'panPhoto')?.rejected || false, reason: m.kycDocs?.find((d) => d.field === 'panPhoto')?.reason || '' },
      },
    },
  });
}

export async function reuploadMemberKycDoc(req, res) {
  const { docField, fileData } = req.body || {};
  if (!docField || !fileData) throw new HttpError(400, 'Document field and data are required');

  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null }, { code: req.params.id?.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  m[docField] = fileData;
  if (Array.isArray(m.kycDocs)) {
    m.kycDocs = m.kycDocs.filter((d) => d.field !== docField);
  }
  await m.save();
  res.json({ status: 'ok', message: 'Document re-uploaded for verification' });
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
      photo: b.photo || '',
      signature: b.signature || '',
      aadhaarPhoto: b.aadhaarPhoto || '',
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
  let totalOutstanding = 0;
  loans.forEach((l) => {
    const line = l.lines.find((x) => x.code === m.code);
    if (line) {
      totalBorrowed += (line.amountPaise || 0) / 100;
    }
  });

  res.json({
    member: {
      id: m._id,
      code: m.code,
      name: m.name,
      husbandName: m.husbandName || '',
      mobile: m.mobile,
      isMobileVerified: Boolean(m.mobileVerifiedAt),
      address: [m.address, m.district, m.state, m.pincode].filter(Boolean).join(', '),
      aadhaar: m.aadhaar,
      pan: m.pan,
      bankName: m.bankName,
      accountNumber: m.accountNumber,
      branch: m.branch ? `${m.branch.code} — ${m.branch.name}` : '',
      guarantor: m.guarantor,
      totalBorrowed,
      loansCount: loans.length,
      loans: loans.map((l) => ({
        loanId: l.loanId || l.formId,
        kind: l.kind || l.loanType,
        mode: l.modeLabel || l.mode,
        disbursedOn: l.paidOn ? l.paidOn.toISOString().slice(0, 10) : '',
        amount: (l.totalAmountPaise || 0) / 100,
      })),
      recentEmis: emiList.map((e) => ({
        receiptNo: e.receiptNo,
        amount: e.amountPaise / 100,
        paidOn: e.paidOn ? e.paidOn.toISOString().slice(0, 10) : '',
        mode: e.payMode,
      })),
    },
  });
}

// -----------------------------------------------------------------------------
// 9. LOAN CALCULATOR & REQUISITION
// -----------------------------------------------------------------------------

export async function calculateLoanEmi(req, res) {
  const amount = Number(req.body?.amount) || 10000;
  const rateAnnual = Number(req.body?.interestRate) || 24;
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
    installment,
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

export async function createLoanRequisition(req, res) {
  const code = req.user?.employeeCode;
  const b = req.body || {};
  const emp = await Employee.findOne({ employeeCode: code });
  const branchId = b.branch || emp?.branch;
  if (!branchId) throw new HttpError(400, 'Branch is required');

  const count = await LoanRequisition.countDocuments({});
  const formId = `REQ${String(count + 1001).padStart(6, '0')}`;

  const amount = Number(b.amount) || 10000;
  const term = Number(b.term) || 52;
  const mode = b.mode || 'weekly';
  const rate = Number(b.annualRate) || 24;
  const totalInterest = Math.round((amount * rate * (term / 52)) / 100);
  const installment = Math.round((amount + totalInterest) / term);

  const reqDoc = await LoanRequisition.create({
    formId,
    kind: b.kind || 'personal',
    branch: branchId,
    loanDate: new Date(),
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
    borrower: b.borrower || {
      name: b.borrowerName,
      mobile: b.borrowerMobile,
      code: b.borrowerCode,
    },
    groupInfo: b.kind === 'group' ? b.groupInfo : undefined,
    status: 'pending',
  });

  await audit(req, { action: 'requisition.createFromApp', entity: 'LoanRequisition', entityId: reqDoc._id, after: { formId, kind: reqDoc.kind } });
  res.status(201).json({ item: reqDoc, message: `Loan Requisition ${formId} created successfully` });
}

export async function listEmployeeRequisitions(req, res) {
  const code = req.user?.employeeCode;
  const items = await LoanRequisition.find({ employeeCode: code, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ items });
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
      status: balancePaise <= 0 ? 'closed' : 'active',
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
  const mode = cleanStr(req.query.mode || 'daily').toLowerCase();
  const dateStr = cleanStr(req.query.date) || todayDateString();

  const loans = await LoanPayment.find({
    status: 'paid',
    'group.code': { $exists: true, $ne: '' },
    $or: [{ mode: new RegExp(`^${mode}$`, 'i') }, { modeLabel: new RegExp(`^${mode}$`, 'i') }],
  }).lean();

  const groupMap = new Map();
  for (const l of loans) {
    const code = l.group?.code;
    if (!code) continue;
    if (!groupMap.has(code)) {
      groupMap.set(code, {
        groupCode: code,
        groupName: l.group.name || code,
        mode: l.mode || mode,
        loans: [],
        membersCount: 0,
        totalDueAmount: 0,
        totalCollectedToday: 0,
      });
    }
    const g = groupMap.get(code);
    g.loans.push(l._id);
    g.membersCount += l.lines?.length || 1;
    for (const line of (l.lines || [])) {
      const emi = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
      g.totalDueAmount += emi / 100;
    }
  }

  const startDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endDay = new Date(`${dateStr}T23:59:59.999Z`);

  const groups = [];
  for (const [, g] of groupMap.entries()) {
    const collections = await EmiPayment.aggregate([
      { $match: { loanPayment: { $in: g.loans }, status: 'paid', paidOn: { $gte: startDay, $lte: endDay } } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);
    const collectedPaise = collections[0]?.total || 0;
    g.totalCollectedToday = collectedPaise / 100;
    const progress = g.totalDueAmount > 0 ? Math.min(100, Math.round((g.totalCollectedToday / g.totalDueAmount) * 100)) : 100;
    groups.push({
      groupCode: g.groupCode,
      groupName: g.groupName,
      mode: g.mode,
      membersCount: g.membersCount,
      totalDueAmount: g.totalDueAmount,
      totalCollectedToday: g.totalCollectedToday,
      collectionProgressPercent: progress,
      isCompleted: progress >= 100,
    });
  }

  res.json({ mode, date: dateStr, groups });
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

  const members = [];
  const groupName = loans[0].group?.name || groupCode;

  for (const l of loans) {
    for (const line of (l.lines || [])) {
      const pastPayments = await EmiPayment.find({
        loanPayment: l._id,
        memberCode: line.code,
        status: 'paid',
      }).lean();

      const totalPaidPaise = pastPayments.reduce((acc, p) => acc + (p.amountPaise || 0), 0);
      const todayPaidPaise = pastPayments.filter((p) => p.paidOn >= startDay && p.paidOn <= endDay)
        .reduce((acc, p) => acc + (p.amountPaise || 0), 0);

      const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
      const totalLoanPaise = line.amountPaise || l.totalAmountPaise || 0;

      const dueSchedule = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= new Date(dateStr));
      const expectedDuePaise = dueSchedule.length * emiPaise;
      const advancePaise = Math.max(0, totalPaidPaise - expectedDuePaise);
      const duesPaise = Math.max(0, expectedDuePaise - totalPaidPaise);

      // Note: "and जिस मेंबर का Advance payment है उसका EMI update नहीं होगा"
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
  const loanType = cleanStr(req.query.loanType || 'personal').toLowerCase();
  const mode = cleanStr(req.query.mode || 'daily').toLowerCase();
  const dateStr = cleanStr(req.query.date) || todayDateString();

  const typeFilter = loanType === 'business' || loanType === 'msme' || loanType === 'business_msme'
    ? { $in: ['business', 'msme', 'business_msme'] }
    : loanType;

  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [
      { loanType: typeFilter },
      { kind: typeFilter },
    ],
    mode: new RegExp(`^${mode}$`, 'i'),
  }).lean();

  const startDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endDay = new Date(`${dateStr}T23:59:59.999Z`);

  const items = [];
  for (const l of loans) {
    for (const line of (l.lines || [])) {
      const pastPayments = await EmiPayment.find({
        loanPayment: l._id,
        memberCode: line.code,
        status: 'paid',
      }).lean();

      const totalPaidPaise = pastPayments.reduce((acc, p) => acc + (p.amountPaise || 0), 0);
      const todayPaidPaise = pastPayments.filter((p) => p.paidOn >= startDay && p.paidOn <= endDay)
        .reduce((acc, p) => acc + (p.amountPaise || 0), 0);

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
        mode: l.mode,
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
    amountPaise: Math.round(payAmount * 100),
    paidOn: new Date(),
    payMode,
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
    message: `Advance payment of ₹${payAmount} successfully credited to Loan ${loan.loanId}`,
  });
}

// -----------------------------------------------------------------------------
// 17. NPA RECOVERY (NPA MEMBERS & OVERDUE RECOVERY)
// -----------------------------------------------------------------------------
export async function getNpaLoans(req, res) {
  const loans = await LoanPayment.find({ status: 'paid' }).populate('branch', 'name code').lean();
  const npaList = [];
  const today = new Date();

  for (const l of loans) {
    for (const line of (l.lines || [])) {
      const pastPayments = await EmiPayment.find({
        loanPayment: l._id,
        memberCode: line.code,
        status: 'paid',
      }).lean();

      const totalPaidPaise = pastPayments.reduce((acc, p) => acc + (p.amountPaise || 0), 0);
      const totalLoanPaise = line.amountPaise || l.totalAmountPaise || 0;
      const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);

      const overdueSchedules = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) < today);
      const expectedDuePaise = overdueSchedules.length * emiPaise;
      const overduePaise = Math.max(0, expectedDuePaise - totalPaidPaise);

      if (overduePaise <= 0) continue;

      const unpaidDue = overdueSchedules[0]?.dueDate;
      const dpd = unpaidDue ? Math.max(0, Math.floor((today - new Date(unpaidDue)) / (1000 * 60 * 60 * 24))) : 0;

      if (dpd >= 90 || (l.emiEndDate && new Date(l.emiEndDate) < today)) {
        const memberDoc = await Member.findById(line.member).select('mobile').lean();
        npaList.push({
          loanPaymentId: l._id,
          loanId: l.loanId || l.receiptNo,
          memberId: line.member,
          memberCode: line.code,
          memberName: line.name,
          phone: memberDoc?.mobile || 'N/A',
          branchName: l.branch?.name || '',
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

  let totalDepositedPaise = 0;
  const deposits = [];
  for (const l of loans) {
    const line = l.lines?.find((x) => String(x.member) === String(member._id));
    if (line && line.securityPaise > 0) {
      totalDepositedPaise += line.securityPaise;
      deposits.push({
        loanId: l.loanId || l.receiptNo,
        date: l.paidOn,
        amount: line.securityPaise / 100,
      });
    }
  }

  const withdrawals = await SecurityWithdrawal.find({ member: member._id }).sort({ createdAt: -1 }).lean();
  const approvedWithdrawals = withdrawals.filter((w) => w.status === 'approved');
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');
  const withdrawnPaise = approvedWithdrawals.reduce((sum, w) => sum + (w.amountPaise || 0), 0);
  const pendingPaise = pendingWithdrawals.reduce((sum, w) => sum + (w.amountPaise || 0), 0);
  const availablePaise = Math.max(0, totalDepositedPaise - withdrawnPaise - pendingPaise);

  res.json({
    member: {
      id: member._id,
      code: member.code,
      name: member.name,
      mobile: member.mobile,
      branch: member.branch,
    },
    totalDeposited: totalDepositedPaise / 100,
    totalWithdrawn: withdrawnPaise / 100,
    pendingWithdrawal: pendingPaise / 100,
    availableBalance: availablePaise / 100,
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

  const receiptNo = await generateCode('securityReceipt').catch(() => `SEC${Date.now().toString().slice(-8)}`);
  const doc = await SecurityWithdrawal.create({
    receiptNo,
    member: member._id,
    memberCode: member.code,
    memberName: member.name,
    branch: member.branch,
    kind,
    amountPaise: Math.round(payAmount * 100),
    remark,
    status: 'pending',
    requestedByCode: req.user?.employeeCode || '',
    createdBy: req.user._id,
  });

  res.status(201).json({
    success: true,
    receiptNo: doc.receiptNo,
    amount: payAmount,
    message: `Withdrawal request of ₹${payAmount} submitted for admin approval`,
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
    },
    disbursements: disbursements.map((d) => ({
      loanId: d.loanId || d.receiptNo,
      borrower: d.lines?.[0]?.name,
      amount: (d.totalAmountPaise || d.amountPaise || 0) / 100,
      mode: d.mode,
      date: d.paidOn ? new Date(d.paidOn).toLocaleDateString() : 'N/A',
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

  const meetingRecord = await FirstMeetingAttendance.findOneAndUpdate(
    { employeeCode: code, date: today },
    {
      employeeCode: code,
      employeeName: emp.name,
      branch: emp.branch,
      date: today,
      photo,
      location,
      status: 'present',
    },
    { upsert: true, new: true }
  );

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
  const slips = await Salary.find({ employeeCode: code })
    .sort({ month: -1 })
    .lean();

  res.json({
    items: slips.map((s) => ({
      id: s._id,
      month: s.month,
      name: s.name,
      designation: s.designation,
      branch: s.branchName,
      basicSalary: (s.basicPaise || 0) / 100,
      allowances: (s.allowancesPaise || 0) / 100,
      deductions: (s.deductionsPaise || 0) / 100,
      netSalary: (s.netSalaryPaise || 0) / 100,
      paidDays: s.paidDays || 30,
      status: s.status,
      paidOn: s.paidOn,
    })),
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
  res.json({ items });
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
  const approvedEarned = leaves.filter((l) => l.type === 'earned' && l.status === 'approved').reduce((s, l) => s + (l.days || 1), 0);

  res.json({
    balances: {
      clTotal: 12,
      clUsed: approvedCasual,
      clBalance: Math.max(0, 12 - approvedCasual),
      elTotal: 15,
      elUsed: approvedEarned,
      elBalance: Math.max(0, 15 - approvedEarned),
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
  const { targetBranchId, reason } = req.body || {};

  if (!targetBranchId) throw new HttpError(400, 'Please select the target branch');

  const targetBranch = await Branch.findById(targetBranchId);
  if (!targetBranch) throw new HttpError(404, 'Target branch not found');

  const count = await EmployeeChange.countDocuments({});
  const letterNo = `TRF${String(count + 1001).padStart(6, '0')}`;

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
  res.json({ items });
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
  const tasks = await Task.find({ assignedToCode: code }).sort({ dueDate: 1 }).lean();
  res.json({ items: tasks });
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




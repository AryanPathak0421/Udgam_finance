import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { EmployeeMpin, GuarantorChangeRequest } from './employeeAppModel.js';
import { Employee, Department, Designation, Attendance } from '../../models/Hr.js';
import { User } from '../../models/User.js';
import { Branch } from '../../models/Branch.js';
import { Member } from '../../models/Member.js';
import { LoanPayment } from '../../models/LoanPayment.js';
import { EmiPayment } from '../../models/EmiPayment.js';
import { LoanRequisition } from '../../models/LoanRequisition.js';
import { LoanScheme } from '../../models/LoanScheme.js';
import { Group } from '../../models/Group.js';
import { Task } from '../../models/HrExtra.js';
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

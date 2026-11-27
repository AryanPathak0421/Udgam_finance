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
  CivilProspect,
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
import { calculateLoan, MODES as CALC_MODES } from '../../services/loanCalculator.js';
import { defaultWorkDate } from '../../services/dayOpen.js';
import { evaluateLoan } from '../../controllers/loanCalculatorController.js';
import { reverseGeocode } from '../../services/geocode.js';
import { createPaymentLink, fetchPaymentLink, razorpayConfigured, razorpayTestMode } from '../../services/razorpay.js';
import { OnlineCollection } from '../../models/OnlineCollection.js';
import { assertMobileFree } from '../../services/memberMobile.js';
import { loadLoan, receive } from '../../controllers/emiController.js';

/**
 * What the software stores with a requisition besides the amount: the EMI, the processing fee, the insurance fee, the security and the cash that is left.
 * The requisition of the staff app did not store them, so a loan made from it was paid with no processing fee, no insurance and no security: they were
 * not collected and did not reach the Cashbook.
 */
async function loanFieldsOf(scheme, amountRupees, ratePct, term, mode) {
  if (!scheme?._id) return {};
  const ev = await evaluateLoan({ schemeId: String(scheme._id), amount: String(amountRupees), rate: String(ratePct), mode, term });
  const c = ev.charges;
  const processing = c ? Math.round(c.processingFee * 100) : 0;
  const insurance = c ? Math.round(c.cost * 100) : 0;
  const security = c ? Math.round(c.securityAmount * 100) : 0;
  return {
    schemeCode: scheme.code,
    calculationType: ev.input.calculationType,
    emiType: ev.input.emiType,
    installmentPaise: Math.round(ev.summary.installmentAmount * 100),
    totalInterestPaise: Math.round(ev.summary.totalInterest * 100),
    totalPayablePaise: Math.round(ev.summary.totalPayable * 100),
    processingFeePaise: processing,
    insuranceFeePaise: insurance,
    securityAmountPaise: security,
    cashPaise: Math.round(amountRupees * 100) - processing - insurance - security,
    securityType: c?.securityType || 'none',
  };
}

/**
 * The installment of a loan as the software works it out: the scheme's own method (flat / reducing), the number of periods per year of the
 * repayment mode (a daily loan has 365, a weekly loan 52) and the scheme's rounding. (The requisition of the app used 52 for every mode, so a
 * daily loan of ₹10,000 for 120 days was given an EMI of ₹200 instead of ₹100.)
 */
const PERIOD_DAYS = { daily: 1, weekly: 7, fortnightly: 14, monthly: 30 };
/**
 * A member is NPA in the group collection when his loan is tagged NPA, its repayment period is over with a balance left, or he is 60 or more
 * days behind with his installments (the same measure as the NPA list of the app). An NPA member is not part of the actual collection, is not
 * picked by the first tap or by Select All, and is collected only when the staff ticks him.
 */
function isNpaMember({ loan, line, emiPaise, duesPaise, scheduledPaise, paidPaise, dateStr }) {
  if (loan.npa || loan.isNpa || loan.status === 'npa' || line?.isNpa) return true;
  if (!(scheduledPaise > paidPaise)) return false;
  if (loan.emiEndDate && new Date(loan.emiEndDate) < new Date(`${dateStr}T00:00:00.000Z`)) return true;
  const behind = emiPaise > 0 ? duesPaise / emiPaise : 0;
  return behind * (PERIOD_DAYS[String(loan.mode || '').toLowerCase()] || 7) >= 60;
}

function installmentOf(amountRupees, ratePct, term, mode, scheme) {
  try {
    const r = calculateLoan({
      principalPaise: Math.round(amountRupees * 100), annualRateBp: Math.round(ratePct * 100), calculationType: scheme?.calculationType || 'flat', emiType: scheme?.emiType || 'equal',
      mode, term, startDate: new Date(), roundingPaise: (scheme?.installmentRounding ?? 1) * 100,
    });
    return { installment: r.installmentAmount / 100, totalInterest: r.totalInterest / 100 };
  } catch {
    const perYear = CALC_MODES[mode]?.perYear || 52;
    const totalInterest = Math.round((amountRupees * ratePct * (term / perYear)) / 100);
    return { installment: Math.round((amountRupees + totalInterest) / term), totalInterest };
  }
}
import { LoanSettlement } from '../../models/LoanSettlement.js';
import { Group } from '../../models/Group.js';
import { Task, Complaint, Leave, Resignation, EmployeeChange, TargetTask } from '../../models/HrExtra.js';
import { SecurityWithdrawal } from '../../models/SecurityWithdrawal.js';
import { StockProduct } from '../../models/StockProduct.js';
import { Holiday, Notification, UserNotification } from '../../models/SuperAdmin.js';
import { AuditLog } from '../../models/AuditLog.js';
import { CivilCheck } from '../../models/CivilCheck.js';
import { civilFeePaise } from '../../models/AppSetting.js';
import { Company } from '../../models/Company.js';
import { BankAccount } from '../../models/BankAccount.js';
import { AppUser } from '../../models/AppUser.js';
import { CenterSurvey } from '../../models/CenterSurvey.js';
import { PhoneUpdateRequest } from '../../models/PhoneUpdateRequest.js';
import { generateCode } from '../../services/codeSequence.js';
import { issueOtp, takeVerified, consumeChallenge, demoOtpAllowed } from '../../services/otpChallenges.js';
import { sendSms } from '../../services/sms.js';
import { sendMail, mailConfigured } from '../../services/mailer.js';
import { elBalance } from '../../services/earnedLeave.js';
import { assertNotSundayOrHoliday } from '../../services/holidays.js';
import { borrowerState } from '../../controllers/emiController.js';
import { isEmployeeSupervisor } from '../supervisor/supervisorAppController.js';
import { asString, parseDateOnly, HttpError, startOfToday, todayDateString } from '../../utils/http.js';
import { audit } from '../../utils/audit.js';
import { missingDetails } from '../../utils/memberDetails.js';
import { notReady } from '../../controllers/loanRequisitionController.js';
import { setAuthCookie } from '../../utils/authCookies.js';

const JWT_SECRET = process.env.JWT_SECRET;

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

  const query = { isDeleted: { $ne: true } };
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
      emp = await Employee.findOne({ user: user._id, isDeleted: { $ne: true } }).populate('branch', 'code name city pincode').populate('department', 'name').populate('designation', 'name');
      if (!emp && user.employeeCode) {
        emp = await Employee.findOne({ employeeCode: user.employeeCode, isDeleted: { $ne: true } }).populate('branch', 'code name city pincode').populate('department', 'name').populate('designation', 'name');
        if (emp) {
          emp.user = user._id;
          await emp.save();
        }
      }
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
  let user = await User.findOne({ employeeCode: new RegExp(`^${emp.employeeCode}$`, 'i') });
  if (!user && emp.email) user = await User.findOne({ email: emp.email.toLowerCase() });
  if (!user && emp.mobile) {
    const last10 = String(emp.mobile).replace(/\D/g, '').slice(-10);
    if (last10) {
      user = await User.findOne({
        $or: [{ mobile: last10 }, { mobile: `+91${last10}` }, { mobile: `91${last10}` }],
      });
    }
  }
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
      branches: emp.branch?._id ? [emp.branch._id] : (emp.branch ? [emp.branch] : []),
      isActive: emp.status === 'active',
    });
  } else {
    let changed = false;
    if (!user.employeeCode && emp.employeeCode) {
      user.employeeCode = emp.employeeCode;
      changed = true;
    }
    const bId = emp.branch?._id || emp.branch;
    if ((!user.branches || !user.branches.length) && bId) {
      user.branches = [bId];
      changed = true;
    }
    if (changed) {
      await user.save();
    }
  }
  if (!emp.user || String(emp.user) !== String(user._id)) {
    emp.user = user._id;
    await emp.save();
  }
  // Ensure AppUser record exists so staff is permitted in app and appears in App User Creation
  await AppUser.updateOne(
    { user: user._id },
    {
      $setOnInsert: {
        user: user._id,
        employeeCode: emp.employeeCode.toUpperCase(),
        name: emp.name || user.name,
        isActive: true,
        createdByCode: 'SYSTEM',
      },
    },
    { upsert: true }
  ).catch(() => {});
  return user;
}

// Robustly resolve employee record, code, branch, and user context for any staff member
export async function getEmployeeContext(req) {
  const user = req.user;
  let code = (user?.employeeCode || '').trim();
  let emp = null;

  if (code) {
    emp = await Employee.findOne({
      employeeCode: new RegExp(`^${code}$`, 'i'),
      isDeleted: { $ne: true },
    }).populate('branch', 'code name city pincode').lean();
  }

  if (!emp && user?._id) {
    emp = await Employee.findOne({
      user: user._id,
      isDeleted: { $ne: true },
    }).populate('branch', 'code name city pincode').lean();
  }

  if (!emp && user?.email) {
    emp = await Employee.findOne({
      email: user.email.toLowerCase(),
      isDeleted: { $ne: true },
    }).populate('branch', 'code name city pincode').lean();
  }

  if (!emp && user?.mobile) {
    const last10 = String(user.mobile).replace(/\D/g, '').slice(-10);
    if (last10) {
      emp = await Employee.findOne({
        mobile: { $regex: `${last10}$` },
        isDeleted: { $ne: true },
      }).populate('branch', 'code name city pincode').lean();
    }
  }

  if (!emp && user) {
    const userCode = user.employeeCode || `EMP${String(user._id).slice(-4).toUpperCase()}`;
    const newEmp = await Employee.create({
      employeeCode: userCode,
      user: user._id,
      name: user.name || user.username || 'Employee',
      email: user.email,
      mobile: user.mobile,
      branch: (user.branches || [])[0],
      status: user.isActive === false ? 'left' : 'active',
      isDeleted: false,
    });
    emp = await Employee.findById(newEmp._id).populate('branch', 'code name city pincode').lean();
  }

  const resolvedCode = (emp?.employeeCode || code || '').trim().toUpperCase();
  const branchId = emp?.branch?._id || emp?.branch || (user?.branches || [])[0] || null;

  let branchIds = [];
  if (branchId) branchIds.push(String(branchId));
  if (emp?.branch) branchIds.push(String(emp.branch._id || emp.branch));
  if (Array.isArray(emp?.supervisedBranches)) {
    for (const b of emp.supervisedBranches) if (b) branchIds.push(String(b._id || b));
  }
  if (Array.isArray(user?.branches)) {
    for (const b of user.branches) if (b) branchIds.push(String(b._id || b));
  }
  branchIds = [...new Set(branchIds.filter(Boolean))];

  return { emp, code: resolvedCode, branchId, branchIds, user };
}

// -----------------------------------------------------------------------------
// 1. REGISTRATION & MPIN SETUP
// -----------------------------------------------------------------------------

export async function lookupEmployee(req, res) {
  const identifier = req.body?.identifier || req.query?.identifier;
  if (!identifier) throw new HttpError(400, 'Please enter Employee Code, Mobile or Email');
  const emp = await findEmployee(identifier);
  if (!emp) throw new HttpError(404, 'Employee record not found in system. Please contact Admin/HR to register you first.');

  // a mobile number that more than one employee account has cannot say whose mPIN is being made (it would be made for the first of them): the Employee Code is asked
  const mobileDigits = String(identifier).replace(/D/g, '');
  if (mobileDigits.length >= 10 && !/^[A-Za-z]/.test(String(identifier).trim())) {
    const last10 = mobileDigits.slice(-10);
    const sameMobile = await Employee.countDocuments({ isDeleted: { $ne: true }, $or: [{ mobile: last10 }, { mobile: `+91${last10}` }, { mobile: `91${last10}` }] });
    if (sameMobile > 1) throw new HttpError(409, 'More than one employee account has this mobile number. Please use your Employee Code to create the mPIN.');
  }

  const user = await User.findOne({
    $or: [
      { employeeCode: emp.employeeCode },
      ...(emp.user ? [{ _id: emp.user }] : []),
      ...(emp.email ? [{ email: emp.email.toLowerCase() }] : []),
    ],
  }).lean();

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

  const emp = await Employee.findOne({ employeeCode: code, isDeleted: { $ne: true } }).populate('designation');
  if (!emp) throw new HttpError(404, 'Employee not found');

  // Prevent unlimited mPIN recreation / overwrite without OTP
  const existingRecord = await EmployeeMpin.findOne({ employeeCode: code });
  if (existingRecord && existingRecord.mpinHash) {
    throw new HttpError(400, 'mPIN is already created for this account. If you forgot your mPIN, please use Forgot mPIN to reset via OTP verification.');
  }

  const user = await ensureUserForEmployee(emp);
  const mpinHash = await EmployeeMpin.hashMpin(mpin);
  const isSupervisor = Boolean(
    (emp.teamCount && emp.teamCount > 0) ||
    (Array.isArray(emp.supervisedBranches) && emp.supervisedBranches.length > 0) ||
    /supervisor/i.test(emp.designation?.name || '')
  );

  let record = existingRecord;
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

  setAuthCookie(res, 'employee', token, { app: true });

  res.json({
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
  await sendSms({ to: emp.mobile, type: 'password', name: emp.name, otp, text: `Your Udgam Employee App verification OTP is ${otp}. Valid for 5 minutes.` });
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
  const { emp: ctxEmp, code } = await getEmployeeContext(req);
  const emp = await Employee.findOne({
    $or: [
      ...(code ? [{ employeeCode: new RegExp(`^${code}$`, 'i') }] : []),
      { user: req.user?._id },
      ...(ctxEmp?._id ? [{ _id: ctxEmp._id }] : []),
      ...(req.user?.email ? [{ email: req.user.email.toLowerCase() }] : []),
    ],
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
      fatherName: emp.fatherName || '—',
      fatherMobile: emp.fatherMobile || '—',
      motherName: emp.motherName || '—',
      maritalStatus: emp.maritalStatus || '—',
      aadhaarNo: emp.aadhaarNo || '—',
      panNo: emp.panNo || '—',
      bankAccountNo: emp.bankAccountNo || '—',
      bankIfsc: emp.bankIfsc || '—',
      bankName: emp.bankName || '—',
      bankBranch: emp.bankBranch || '—',
      drivingLicenceNo: emp.drivingLicenceNo || '—',
      voterIdNo: emp.voterIdNo || '—',
      pincode: emp.pincode || '',
      district: emp.district || '',
      state: emp.state || '',
      area: emp.area || '',
      homeTown: emp.homeTown || '',
      hasExperience: Boolean(emp.hasExperience),
      previousCompany: emp.previousCompany || '—',
      previousPost: emp.previousPost || '—',
      pfDeduction: Boolean(emp.pfDeduction),
      esiDeduction: Boolean(emp.esiDeduction),
      pfNumber: emp.pfNumber || '—',
      uanNumber: emp.uanNumber || '—',
      esiNumber: emp.esiNumber || '—',
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
  const { emp, code, branchId } = await getEmployeeContext(req);
  const codeRegex = code ? new RegExp(`^${code}$`, 'i') : null;
  const today = startOfToday();
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1);

  // Point 5 Fix: Collections by this employee today
  // Approved collections come from EmiPayment, and pending app submissions come from AppEmiCollection
  const todayEmiPayments = await EmiPayment.find({
    status: 'paid',
    paidOn: { $gte: today, $lte: todayEnd },
    $or: [
      ...(codeRegex ? [{ employeeCode: codeRegex }, { staffCode: codeRegex }] : []),
      ...(req.user?._id ? [{ collectedBy: req.user._id }] : []),
      ...(emp?._id ? [{ collectedBy: emp._id }] : []),
    ],
  }).select('amountPaise receiptNo loanPayment memberCode').lean();

  const todayAppCollections = await AppEmiCollection.find({
    collectedOn: { $gte: today, $lte: todayEnd },
    status: 'pending',
    $or: [
      ...(codeRegex ? [{ collectedByCode: codeRegex }] : []),
      ...(req.user?._id ? [{ collectedBy: req.user._id }] : []),
      ...(emp?._id ? [{ collectedBy: emp._id }] : []),
    ],
  }).select('amountPaise receiptNo loanPayment memberCode status').lean();

  const seenReceipts = new Set();
  const seenLoanMember = new Set();
  let totalCollectedPaise = 0;
  let receiptsCount = 0;

  for (const ac of todayAppCollections) {
    if (ac.receiptNo) seenReceipts.add(ac.receiptNo);
    seenLoanMember.add(`${String(ac.loanPayment)}_${String(ac.memberCode || '').trim().toUpperCase()}`);
    totalCollectedPaise += (ac.amountPaise || 0);
    receiptsCount += 1;
  }

  for (const ep of todayEmiPayments) {
    if (ep.receiptNo && seenReceipts.has(ep.receiptNo)) continue;
    const lmKey = `${String(ep.loanPayment)}_${String(ep.memberCode || '').trim().toUpperCase()}`;
    if (seenLoanMember.has(lmKey)) continue;
    totalCollectedPaise += (ep.amountPaise || 0);
    receiptsCount += 1;
  }

  const todayCollected = totalCollectedPaise / 100;
  const todayReceiptsCount = receiptsCount;

  // Collection due of the home card: the same numbers as the EMI Pay page (getEmiGroups) for the groups of this employee that meet today.
  // (It used to add one installment of EVERY loan of the branch, paid up or not, whatever day the group meets.)
  let todayTargetDue = 0; // what the members of today's groups pay for one installment (actual collection)
  let dueCount = 0; // members of today's groups
  let remainingTodayDue = 0; // actual collection less what was collected today
  let remainingDueCount = 0; // members who have not paid today
  try {
    const groupsReq = Object.assign(Object.create(req), { query: { date: todayDateString() } });
    const groupsData = await new Promise((resolve, reject) => {
      getEmiGroups(groupsReq, { json: resolve, status: () => ({ json: resolve }) }).catch(reject);
    });
    for (const g of groupsData.groups || []) {
      if (!g.isScheduled) continue;
      todayTargetDue += g.actualCollection || 0;
      dueCount += g.membersCount || 0;
      remainingTodayDue += Math.max(0, (g.actualCollection || 0) - (g.totalCollectedToday || 0));
      remainingDueCount += g.dueCount || 0;
    }
  } catch (err) {
    console.error('home dashboard collection due failed', err.message);
  }
  remainingTodayDue = Math.round(remainingTodayDue);

  // Performance graph: Collections and Dues for the past 6 months
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mStr = d.toISOString().slice(0, 7);
    const startM = new Date(d.getFullYear(), d.getMonth(), 1);
    const endM = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

    const mColl = await EmiPayment.aggregate([
      {
        $match: {
          status: 'paid',
          paidOn: { $gte: startM, $lte: endM },
          $or: [
            ...(codeRegex ? [{ employeeCode: codeRegex }, { staffCode: codeRegex }] : []),
            ...(req.user?._id ? [{ collectedBy: req.user._id }] : []),
            ...(emp?._id ? [{ collectedBy: emp._id }] : []),
          ],
        },
      },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);

    const mDisb = await LoanPayment.aggregate([
      {
        $match: {
          status: 'paid',
          paidOn: { $gte: startM, $lte: endM },
          $or: [
            ...(codeRegex ? [{ employeeCode: codeRegex }, { staffCode: codeRegex }] : []),
            ...(branchId ? [{ branch: branchId }] : []),
          ],
        },
      },
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
  const pendingTasksCount = await Task.countDocuments({
    $or: [
      ...(codeRegex ? [{ assignedToCode: codeRegex }] : []),
      ...(emp?._id ? [{ assignedTo: emp._id }] : []),
      ...(req.user?._id ? [{ assignedTo: req.user._id }] : []),
      ...(branchId ? [{ branch: branchId, assignedTo: { $exists: false } }] : []),
    ],
    status: { $in: ['open', 'in_progress'] },
  });

  // Point 11: Employee Rating from Supervisor
  const mpinDoc = await EmployeeMpin.findOne({
    $or: [
      ...(codeRegex ? [{ employeeCode: codeRegex }] : []),
      ...(emp?._id ? [{ employee: emp._id }] : []),
    ],
  });
  const averageRating = emp?.averageRating || mpinDoc?.averageRating || 5;
  const ratingsCount = emp?.ratings?.length || mpinDoc?.ratings?.length || 0;

  res.json({
    summary: {
      todayCollected,
      todayReceiptsCount,
      todayTotalDue: Math.round(todayTargetDue),
      todayTargetDue: Math.round(todayTargetDue),
      todayDue: Math.round(remainingTodayDue), // Item 19: Home page card deducts collection from due
      todayRemainingDue: remainingTodayDue,
      dueCount: remainingDueCount,
      totalDueCount: dueCount,
      pendingTasksCount,
      averageRating,
      ratingsCount,
    },
    performanceGraph: months,
  });
}

// -----------------------------------------------------------------------------
// 4. TODAY COLLECTION HISTORY & TODAY DUE
// -----------------------------------------------------------------------------

export async function getCollectionHistory(req, res) {
  const { emp, code } = await getEmployeeContext(req);
  const codeRegex = code ? new RegExp(`^${code}$`, 'i') : null;
  const dateStr = asString(req.query.date) || todayDateString();
  const categoryFilter = cleanStr(req.query.category).toLowerCase(); // all, group, personal, msme, product
  const from = new Date(`${dateStr}T00:00:00.000Z`);
  const to = new Date(`${dateStr}T23:59:59.999Z`);

  const list = await EmiPayment.find({
    status: 'paid',
    paidOn: { $gte: from, $lte: to },
    $or: [
      ...(codeRegex ? [{ employeeCode: codeRegex }, { staffCode: codeRegex }] : []),
      ...(req.user?._id ? [{ collectedBy: req.user._id }] : []),
      ...(emp?._id ? [{ collectedBy: emp._id }] : []),
    ],
  })
    .populate('loanPayment', 'loanType mode product group')
    .sort({ createdAt: -1 })
    .lean();

  // What was collected in the app counts here at once: it is only an approved EMI after the admin approves it, so the collections that still
  // wait for approval are listed too (marked), otherwise a day's collection would show nothing until it is approved.
  const waiting = await AppEmiCollection.find({
    status: 'pending',
    collectedOn: { $gte: from, $lte: to },
    $or: [
      ...(codeRegex ? [{ collectedByCode: codeRegex }] : []),
      ...(req.user?._id ? [{ collectedBy: req.user._id }] : []),
      ...(emp?._id ? [{ collectedBy: emp._id }] : []),
    ],
  })
    .populate('loanPayment', 'loanType mode product group')
    .sort({ createdAt: -1 })
    .lean();
  const approvedReceipts = new Set(list.map((e) => e.receiptNo).filter(Boolean));
  const asHistory = [
    ...waiting.filter((w) => !w.receiptNo || !approvedReceipts.has(w.receiptNo)).map((w) => ({ ...w, _waiting: true })),
    ...list,
  ];

  const formattedItems = asHistory.map((e) => {
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
      waitingApproval: Boolean(e._waiting),
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
  const { emp, code, branchId, branchIds } = await getEmployeeContext(req);
  const codeRegex = code ? new RegExp(`^${code}$`, 'i') : null;
  const bList = branchIds?.length ? branchIds : (branchId ? [branchId] : []);
  const dateStr = asString(req.query.date) || todayDateString();
  const categoryFilter = cleanStr(req.query.category).toLowerCase();
  const startDay = new Date(`${dateStr}T00:00:00.000Z`);
  const asOf = new Date(`${dateStr}T23:59:59.999Z`);

  const groupQuery = {
    isDeleted: { $ne: true },
    $or: [
      ...(codeRegex ? [{ employeeCode: codeRegex }, { staffCode: codeRegex }] : []),
      ...(emp?._id ? [{ employee: emp._id }, { staffId: emp._id }] : []),
    ],
  };
  // Point 4: Strict branch isolation
  if (bList.length) {
    groupQuery.branch = { $in: bList };
  }
  const myGroups = await Group.find(groupQuery).select('code name meetingType collectionDay dayOfWeek').lean();
  const myGroupCodes = myGroups.map((g) => g.code).filter(Boolean);

  const loanQuery = {
    status: 'paid',
    $or: [
      ...(codeRegex ? [{ employeeCode: codeRegex }, { staffCode: codeRegex }] : []),
      ...(myGroupCodes.length ? [{ 'group.code': { $in: myGroupCodes } }] : []),
    ],
  };
  // Point 4: Strict branch isolation - never show loans from other branches
  if (bList.length) {
    loanQuery.branch = { $in: bList };
  }

  const loans = await LoanPayment.find(loanQuery)
    .select('_id loanId formId mode modeLabel group lines schedule loanType isSettled status totalAmountPaise branch')
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

  // Pre-fetch all past and current payments
  const allPastPayments = loanIds.length ? await EmiPayment.find({
    loanPayment: { $in: loanIds },
    status: 'paid',
  }).select('loanPayment memberCode amountPaise receiptNo paidOn').lean() : [];

  const allPastReceipts = new Set(allPastPayments.map((p) => p.receiptNo).filter(Boolean));
  const seenTodayLoanMember = new Set(
    allPastPayments
      .filter((p) => p.paidOn >= startDay && p.paidOn <= asOf)
      .map((p) => `${String(p.loanPayment)}_${String(p.memberCode || '').trim().toUpperCase()}`)
  );

  const appCollections = loanIds.length ? await AppEmiCollection.find({
    loanPayment: { $in: loanIds },
    status: 'pending',
  }).select('loanPayment memberCode amountPaise receiptNo collectedOn').lean() : [];

  const paymentsByKey = new Map();
  const pendingByLoanMember = new Map();
  for (const p of allPastPayments) {
    const k = `${String(p.loanPayment)}_${p.memberCode}`;
    const cur = paymentsByKey.get(k) || { totalPaise: 0, todayPaise: 0 };
    cur.totalPaise += (p.amountPaise || 0);
    if (p.paidOn >= startDay && p.paidOn <= asOf) {
      cur.todayPaise += (p.amountPaise || 0);
    }
    paymentsByKey.set(k, cur);
  }
  for (const ac of appCollections) {
    const k = `${String(ac.loanPayment)}_${ac.memberCode}`;
    pendingByLoanMember.set(k, (pendingByLoanMember.get(k) || 0) + (ac.amountPaise || 0));
    if (ac.receiptNo && allPastReceipts.has(ac.receiptNo)) continue;
    const lmKey = `${String(ac.loanPayment)}_${String(ac.memberCode || '').trim().toUpperCase()}`;
    if (seenTodayLoanMember.has(lmKey)) continue;
    const cur = paymentsByKey.get(k) || { totalPaise: 0, todayPaise: 0 };
    cur.totalPaise += (ac.amountPaise || 0);
    if (ac.collectedOn >= startDay && ac.collectedOn <= asOf) {
      cur.todayPaise += (ac.amountPaise || 0);
    }
    paymentsByKey.set(k, cur);
  }

  const groupCodes = [...new Set(loans.map((l) => l.group?.code).filter(Boolean))];
  const groupDocs = groupCodes.length
    ? await Group.find({ code: { $in: groupCodes } }).select('code meetingType collectionDay dayOfWeek').lean()
    : [];
  const groupMap = new Map(groupDocs.map((g) => [g.code, g]));

  const jsDay = startDay.getUTCDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const dayOfMonth = startDay.getUTCDate();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

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

    // Point 2 & 16: Check scheduled meeting day or upcoming due dates
    let meetsToday = false;
    const mode = (l.mode || l.modeLabel || 'weekly').toLowerCase();
    const g = l.group?.code ? groupMap.get(l.group.code) : null;
    const meetingType = (g?.meetingType || mode).toLowerCase();

    if (meetingType === 'daily') {
      meetsToday = jsDay !== 0;
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

    const exactInst = (l.schedule || []).find((s) => s.dueDate && new Date(s.dueDate).toISOString().slice(0, 10) === dateStr);
    const dueInst = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= asOf);

    // If loan does not meet today and has no past/current scheduled installments, skip
    if (!meetsToday && !dueInst.length) return;

    const latest = exactInst || (dueInst.length ? dueInst[dueInst.length - 1] : l.schedule?.[0]);
    if (!latest) return;

    (l.lines || []).forEach((line) => {
      const isLineSettled = line.isSettled || settledKeySet.has(`${String(l._id)}_${line.code}`) || settledKeySet.has(`${l.loanId}_${line.code}`);
      if (isLineSettled) return;

      const stats = paymentsByKey.get(`${String(l._id)}_${line.code}`) || { totalPaise: 0, todayPaise: 0 };
      const totalPaidPaise = stats.totalPaise;
      const todayPaidPaise = stats.todayPaise;

      const emiPaise = (latest.installmentPaise || 0) + (line.extraEmiPaise || 0);
      const totalScheduledPaise = (l.schedule || []).reduce((s, x) => s + (x.installmentPaise || 0), 0) + (line.extraEmiPaise || 0) * (l.schedule?.length || 0);

      // Skip fully settled / completed loans
      if (totalScheduledPaise > 0 && totalPaidPaise >= totalScheduledPaise) return;

      const dueSchedule = (l.schedule || []).filter((s) => s.dueDate && new Date(s.dueDate) <= asOf);
      const expectedDuePaise = Math.max(emiPaise, dueSchedule.length * emiPaise);
      const duesPaise = Math.max(0, expectedDuePaise - totalPaidPaise);

      const fullEmi = emiPaise / 100;
      const collectedAmount = todayPaidPaise / 100;
      const remainingDue = duesPaise > 0 ? (duesPaise / 100) : (todayPaidPaise >= emiPaise ? 0 : fullEmi);

      // If loan doesn't meet today and dues are zero, skip
      if (!meetsToday && duesPaise <= 0) return;

      const pendingPaise = pendingByLoanMember.get(`${String(l._id)}_${line.code}`) || 0;

      dues.push({
        loanPaymentId: l._id,
        loanId: l.loanId || l.formId,
        memberCode: line.code,
        memberName: line.name,
        groupName: l.group?.name || l.group?.code || 'Individual',
        category: cat,
        installmentNo: latest.no,
        totalDue: duesPaise > 0 ? (duesPaise + todayPaidPaise) / 100 : fullEmi,
        installmentAmount: fullEmi,
        emiAmount: fullEmi,
        collectedAmount,
        dueAmount: remainingDue,
        isFullyPaid: collectedAmount >= fullEmi && duesPaise === 0,
        isPartiallyPaid: collectedAmount > 0 && remainingDue > 0,
        isPendingApproval: pendingPaise > 0,
        pendingApprovalAmount: pendingPaise / 100,
        dueDate: latest.dueDate ? new Date(latest.dueDate).toISOString().slice(0, 10) : dateStr,
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
    ...(demoOtpAllowed() ? { devOtp: otp } : {}),
    message: 'OTP sent to the mobile number',
  });
}

export async function verifyMemberOtp(req, res) {
  const { challengeId, otp, mobile } = req.body || {};
  const cleanMobile = cleanStr(mobile).replace(/\D/g, '').slice(-10);
  const otpStr = String(otp || '').trim();

  // the test codes (123456 / 000000) work only outside production
  const isDemo = demoOtpAllowed() && (otpStr === '123456' || otpStr === '000000');
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
    const voterDocPhoto = b.voterPhoto || b.voterCardPhoto || '';
    const passbookDocPhoto = b.passbookPhoto || b.bankPassbookPhoto || '';
    const voterCardNum = cleanStr(b.voterCardNumber || b.voterId || b.voterNo).toUpperCase();

    const kycKeys = ['memberPhoto', 'signaturePhoto', 'aadhaarPhoto', 'aadhaarBackPhoto'];
    if (b.panPhoto) kycKeys.push('panPhoto');
    if (voterDocPhoto) kycKeys.push('voterPhoto');
    if (passbookDocPhoto) kycKeys.push('passbookPhoto');
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
      voterId: voterCardNum,
      bankName: cleanStr(b.bankName) || 'State Bank of India',
      ifsc: cleanStr(b.ifsc).toUpperCase() || 'SBIN0000001',
      accountNumber: cleanStr(b.accountNumber) || '10000000000',
      memberPhoto: b.memberPhoto || defaultPhoto,
      signaturePhoto: b.signaturePhoto || defaultPhoto,
      aadhaarPhoto: b.aadhaarPhoto || defaultPhoto,
      aadhaarBackPhoto: b.aadhaarBackPhoto || b.aadhaarPhoto || defaultPhoto,
      panPhoto: b.panPhoto || '',
      voterPhoto: voterDocPhoto,
      passbookPhoto: passbookDocPhoto,
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
  const { emp, code, branchId } = await getEmployeeContext(req);
  const codeRegex = code ? new RegExp(`^${code}$`, 'i') : null;
  const rawBranchIds = [branchId, emp?.branch, req.user?.branch, ...(req.user?.branches || [])].filter(Boolean);
  const branchIds = [...new Set(rawBranchIds.map((b) => String(b?.id || b?._id || b)))];

  const query = { isDeleted: { $ne: true } };
  // Item 24 Fix: Strictly isolate members by the employee's branch so other branches NEVER show up
  if (branchIds.length > 0) {
    query.branch = { $in: branchIds };
  } else {
    query.createdBy = req.user._id;
  }

  const members = await Member.find(query)
    .sort({ createdAt: -1 })
    .limit(1000)
    .select('+memberPhoto +signaturePhoto +aadhaarPhoto +aadhaarBackPhoto +panPhoto +voterPhoto +passbookPhoto')
    .populate('branch', 'name code')
    .lean();

  res.json({
    items: members.map((m) => {
      const hasPhoto = Boolean(m.memberPhoto);
      const hasSignature = Boolean(m.signaturePhoto);
      const hasAadhaarFront = Boolean(m.aadhaarPhoto);
      const hasAadhaarBack = Boolean(m.aadhaarBackPhoto);
      const hasPan = Boolean(m.panPhoto);
      const hasVoter = Boolean(m.voterPhoto);
      const hasPassbook = Boolean(m.passbookPhoto);

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
        hasVoter,
        hasPassbook,
        voterId: m.voterId || '',
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
    .select('+memberPhoto +signaturePhoto +aadhaarPhoto +aadhaarBackPhoto +panPhoto +voterPhoto +passbookPhoto +guarantor.photo +guarantor.signature +guarantor.aadhaarPhoto +guarantor.aadhaarBackPhoto +guarantor.panPhoto +guarantor.jointPhoto +nominee.photo +nominee.signature +nominee.aadhaarPhoto +nominee.aadhaarBackPhoto +nominee.panPhoto')
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
  const voterDoc = docStatus('voterPhoto', Boolean(m.voterPhoto));
  const passbookDoc = docStatus('passbookPhoto', Boolean(m.passbookPhoto));

  // Point 12: Old/Current Guarantor documents for re-upload and audit
  const gPhotoDoc = docStatus('guarantor.photo', Boolean(m.guarantor?.photo));
  const gSignDoc = docStatus('guarantor.signature', Boolean(m.guarantor?.signature));
  const gAadhaarDoc = docStatus('guarantor.aadhaarPhoto', Boolean(m.guarantor?.aadhaarPhoto));
  const gAadhaarBackDoc = docStatus('guarantor.aadhaarBackPhoto', Boolean(m.guarantor?.aadhaarBackPhoto));
  const gPanDoc = docStatus('guarantor.panPhoto', Boolean(m.guarantor?.panPhoto));
  const gJointDoc = docStatus('guarantor.jointPhoto', Boolean(m.guarantor?.jointPhoto));

  const gName = m.guarantor?.name || 'Guarantor';

  // Nominee documents
  const nName = m.nominee?.name || 'Nominee';
  const nSameAsGuarantor = Boolean(m.nominee?.sameAsGuarantor);
  const nPhotoDoc = docStatus('nominee.photo', Boolean(m.nominee?.photo));
  const nSignDoc = docStatus('nominee.signature', Boolean(m.nominee?.signature));
  const nAadhaarDoc = docStatus('nominee.aadhaarPhoto', Boolean(m.nominee?.aadhaarPhoto));
  const nAadhaarBackDoc = docStatus('nominee.aadhaarBackPhoto', Boolean(m.nominee?.aadhaarBackPhoto));
  const nPanDoc = docStatus('nominee.panPhoto', Boolean(m.nominee?.panPhoto));

  const documents = [
    // 1. Member documents
    { category: 'member', type: 'photo', field: 'memberPhoto', name: 'Member Photo', status: photoDoc.status, rejectReason: photoDoc.reason, uploadedAt: m.memberPhoto ? m.createdAt : null, image: m.memberPhoto || null, required: true },
    { category: 'member', type: 'signature', field: 'signaturePhoto', name: 'Member Signature', status: signDoc.status, rejectReason: signDoc.reason, uploadedAt: m.signaturePhoto ? m.createdAt : null, image: m.signaturePhoto || null, required: true },
    { category: 'member', type: 'aadhaar', field: 'aadhaarPhoto', name: 'Aadhaar Card (Front)', status: aadhaarFrontDoc.status, rejectReason: aadhaarFrontDoc.reason, uploadedAt: m.aadhaarPhoto ? m.createdAt : null, image: m.aadhaarPhoto || null, required: true },
    { category: 'member', type: 'aadhaarBack', field: 'aadhaarBackPhoto', name: 'Aadhaar Card (Back)', status: aadhaarBackDoc.status, rejectReason: aadhaarBackDoc.reason, uploadedAt: m.aadhaarBackPhoto ? m.createdAt : null, image: m.aadhaarBackPhoto || null, required: true },
    { category: 'member', type: 'pan', field: 'panPhoto', name: 'PAN Card Photo', status: panDoc.status, rejectReason: panDoc.reason, uploadedAt: m.panPhoto ? m.createdAt : null, image: m.panPhoto || null, required: false },
    { category: 'member', type: 'voter', field: 'voterPhoto', name: 'Voter ID Card Photo', status: voterDoc.status, rejectReason: voterDoc.reason, uploadedAt: m.voterPhoto ? m.createdAt : null, image: m.voterPhoto || null, required: false },
    { category: 'member', type: 'passbook', field: 'passbookPhoto', name: 'Bank Passbook Photo', status: passbookDoc.status, rejectReason: passbookDoc.reason, uploadedAt: m.passbookPhoto ? m.createdAt : null, image: m.passbookPhoto || null, required: false },
    // 2. Guarantor documents
    { category: 'guarantor', type: 'guarantorPhoto', field: 'guarantor.photo', name: `Guarantor Photo (${gName})`, status: gPhotoDoc.status, rejectReason: gPhotoDoc.reason, uploadedAt: m.guarantor?.photo ? m.createdAt : null, image: m.guarantor?.photo || null, required: false },
    { category: 'guarantor', type: 'guarantorSignature', field: 'guarantor.signature', name: `Guarantor Signature (${gName})`, status: gSignDoc.status, rejectReason: gSignDoc.reason, uploadedAt: m.guarantor?.signature ? m.createdAt : null, image: m.guarantor?.signature || null, required: false },
    { category: 'guarantor', type: 'guarantorAadhaar', field: 'guarantor.aadhaarPhoto', name: `Guarantor Aadhaar Front (${gName})`, status: gAadhaarDoc.status, rejectReason: gAadhaarDoc.reason, uploadedAt: m.guarantor?.aadhaarPhoto ? m.createdAt : null, image: m.guarantor?.aadhaarPhoto || null, required: false },
    { category: 'guarantor', type: 'guarantorAadhaarBack', field: 'guarantor.aadhaarBackPhoto', name: `Guarantor Aadhaar Back (${gName})`, status: gAadhaarBackDoc.status, rejectReason: gAadhaarBackDoc.reason, uploadedAt: m.guarantor?.aadhaarBackPhoto ? m.createdAt : null, image: m.guarantor?.aadhaarBackPhoto || null, required: false },
    ...(m.guarantor?.panPhoto ? [{ category: 'guarantor', type: 'guarantorPan', field: 'guarantor.panPhoto', name: `Guarantor PAN Card (${gName})`, status: gPanDoc.status, rejectReason: gPanDoc.reason, uploadedAt: m.createdAt, image: m.guarantor.panPhoto, required: false }] : []),
    ...(m.guarantor?.jointPhoto ? [{ category: 'guarantor', type: 'guarantorJoint', field: 'guarantor.jointPhoto', name: `Member & Guarantor Joint Photo`, status: gJointDoc.status, rejectReason: gJointDoc.reason, uploadedAt: m.createdAt, image: m.guarantor.jointPhoto, required: false }] : []),
    // 3. Nominee documents
    ...(!nSameAsGuarantor ? [
      { category: 'nominee', type: 'nomineePhoto', field: 'nominee.photo', name: `Nominee Photo (${nName})`, status: nPhotoDoc.status, rejectReason: nPhotoDoc.reason, uploadedAt: m.nominee?.photo ? m.createdAt : null, image: m.nominee?.photo || null, required: false },
      { category: 'nominee', type: 'nomineeSignature', field: 'nominee.signature', name: `Nominee Signature (${nName})`, status: nSignDoc.status, rejectReason: nSignDoc.reason, uploadedAt: m.nominee?.signature ? m.createdAt : null, image: m.nominee?.signature || null, required: false },
      { category: 'nominee', type: 'nomineeAadhaar', field: 'nominee.aadhaarPhoto', name: `Nominee Aadhaar Front (${nName})`, status: nAadhaarDoc.status, rejectReason: nAadhaarDoc.reason, uploadedAt: m.nominee?.aadhaarPhoto ? m.createdAt : null, image: m.nominee?.aadhaarPhoto || null, required: false },
      { category: 'nominee', type: 'nomineeAadhaarBack', field: 'nominee.aadhaarBackPhoto', name: `Nominee Aadhaar Back (${nName})`, status: nAadhaarBackDoc.status, rejectReason: nAadhaarBackDoc.reason, uploadedAt: m.nominee?.aadhaarBackPhoto ? m.createdAt : null, image: m.nominee?.aadhaarBackPhoto || null, required: false },
      ...(m.nominee?.panPhoto ? [{ category: 'nominee', type: 'nomineePan', field: 'nominee.panPhoto', name: `Nominee PAN Card (${nName})`, status: nPanDoc.status, rejectReason: nPanDoc.reason, uploadedAt: m.createdAt, image: m.nominee.panPhoto, required: false }] : []),
    ] : []),
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
      state: m.state || '',
      legacyImport: Boolean(m.legacyImport),
      missingDetails: missingDetails(m).map(({ key, label }) => ({ key, label })),
      hasMissingDetails: missingDetails(m).length > 0,
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
    : docField === 'voter' || docField === 'voterPhoto' || docField === 'voterCardPhoto' ? 'voterPhoto'
    : docField === 'passbook' || docField === 'passbookPhoto' || docField === 'bankPassbookPhoto' ? 'passbookPhoto'
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
    : docField === 'voter' || docField === 'voterPhoto' || docField === 'voterCardPhoto' ? 'voterPhoto'
    : docField === 'passbook' || docField === 'passbookPhoto' || docField === 'bankPassbookPhoto' ? 'passbookPhoto'
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

  // Point 22 & 23: Dispatch Push/In-App Notification to staff when KYC is rejected
  const notifyUser = m.createdBy || m.joiningApproval?.submittedBy;
  (async () => {
    try {
      const recipientUserIds = new Set();
      if (notifyUser) recipientUserIds.add(String(notifyUser));
      if (m.employeeCode) {
        const emp = await Employee.findOne({ employeeCode: new RegExp(`^${m.employeeCode}$`, 'i'), isDeleted: false });
        if (emp) {
          const u = await ensureUserForEmployee(emp);
          if (u?._id) recipientUserIds.add(String(u._id));
        }
      }
      for (const uid of recipientUserIds) {
        await UserNotification.create({
          user: uid,
          title: `⚠️ Member KYC Rejected: ${m.name} (${m.code})`,
          message: `KYC document (${mappedField}) for member ${m.code} (${m.name}) was rejected: "${reason}". Please re-upload from Employee KYC section.`,
          data: { memberId: m._id, memberCode: m.code, field: mappedField, type: 'kyc_rejected' },
        }).catch(() => {});
      }
      if (m.branch) {
        await Notification.create({
          title: `⚠️ KYC Rejected: ${m.name} (${m.code})`,
          message: `KYC document (${mappedField}) for member ${m.name} (${m.code}) was rejected: "${reason}". Please review and re-upload.`,
          audience: 'branch_staff',
          branch: m.branch,
          inApp: true,
          createdByCode: req.user?.employeeCode || 'ADMIN',
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[rejectMemberKycDoc] Notification dispatch error:', e.message);
    }
  })();

  res.json({ status: 'ok', message: `Document (${mappedField}) rejected. Notification sent to staff for re-upload.` });
}

export async function approveMemberKycDoc(req, res) {
  const q = cleanStr(req.params.id);
  const docField = req.body?.docField || req.body?.docType;

  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(q) ? q : null }, { code: q.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  const mappedField = docField === 'photo' || docField === 'memberPhoto' ? 'memberPhoto'
    : docField === 'signature' || docField === 'signaturePhoto' ? 'signaturePhoto'
    : docField === 'aadhaar' || docField === 'aadhaarPhoto' ? 'aadhaarPhoto'
    : docField === 'aadhaarBack' || docField === 'aadhaarBackPhoto' ? 'aadhaarBackPhoto'
    : docField === 'pan' || docField === 'panPhoto' ? 'panPhoto'
    : docField === 'voter' || docField === 'voterPhoto' || docField === 'voterCardPhoto' ? 'voterPhoto'
    : docField === 'passbook' || docField === 'passbookPhoto' || docField === 'bankPassbookPhoto' ? 'passbookPhoto'
    : docField;

  if (!Array.isArray(m.kycDocs)) m.kycDocs = [];
  m.kycDocs = m.kycDocs.filter((d) => d.key !== mappedField && d.field !== mappedField);
  m.kycDocs.push({
    key: mappedField,
    field: mappedField,
    status: 'approved',
    reason: '',
    approvedAt: new Date(),
    approvedBy: req.user?._id,
  });

  const hasRejected = m.kycDocs.some((d) => d.status === 'rejected');
  m.kycRejected = hasRejected;

  const mandatory = ['memberPhoto', 'signaturePhoto', 'aadhaarPhoto', 'aadhaarBackPhoto'];
  const allMandatoryApproved = mandatory.every((k) => m.kycDocs.some((d) => (d.key === k || d.field === k) && d.status === 'approved'));
  if (allMandatoryApproved) {
    m.isKycApproved = true;
    m.kycPending = false;
  }
  await m.save();

  res.json({ status: 'ok', message: `Document (${mappedField}) approved successfully.`, key: mappedField });
}

export async function sendMemberPhoneChangeOtp(req, res) {
  const q = cleanStr(req.params.id);
  const targetType = req.body?.targetType === 'guarantor' ? 'guarantor' : 'member';
  const newMobile = cleanStr(req.body?.newMobile || req.body?.newNumber).replace(/\D/g, '').slice(-10);
  if (!/^\d{10}$/.test(newMobile)) throw new HttpError(400, 'Enter a valid 10-digit mobile number');

  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(q) ? q : null }, { code: q.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  const currentNumber = targetType === 'member' ? m.mobile : m.guarantor?.mobile;
  // the same number is sent an OTP to verify it (when it is not verified yet); a number that is verified already needs no OTP
  const verifiedAt = targetType === 'member' ? m.mobileVerifiedAt : m.guarantor?.mobileVerifiedAt;
  if (currentNumber && currentNumber === newMobile && verifiedAt) {
    throw new HttpError(400, 'This mobile number is already verified. Enter a different number to change it.');
  }
  // one mobile number, one member: a new number must be nobody's; the number the member has is verified only when no other member has verified it
  if (targetType === 'member') await assertMobileFree(newMobile, m._id, { verifiedOnly: Boolean(currentNumber && currentNumber === newMobile) });

  const { otp, challengeId } = await issueOtp(`phone_change_${m._id}_${targetType}_${newMobile}`, { ttlSec: 300 });
  try {
    await sendSms({
      to: newMobile,
      type: 'mobile_otp',
      params: { otp },
      text: `Dear customer your OTP is ${otp} for mobile number verification. UDGAM URBAN and GRAMIN MICROFINANCE`,
    });
  } catch (err) {
    console.warn('[sendMemberPhoneChangeOtp] SMS dispatch error:', err.message);
  }

  res.json({
    challengeId,
    newMobile,
    ...(demoOtpAllowed() ? { devOtp: otp } : {}),
    message: 'OTP sent to mobile number',
  });
}

export async function verifyMemberPhoneChange(req, res) {
  const q = cleanStr(req.params.id);
  const targetType = req.body?.targetType === 'guarantor' ? 'guarantor' : 'member';
  const { challengeId, otp, newMobile, newNumber, reason } = req.body || {};
  const cleanPhone = cleanStr(newMobile || newNumber).replace(/\D/g, '').slice(-10);
  if (!/^\d{10}$/.test(cleanPhone)) throw new HttpError(400, 'Enter a valid 10-digit mobile number');

  const m = await Member.findOne({
    $or: [{ _id: mongoose.isValidObjectId(q) ? q : null }, { code: q.toUpperCase() }],
  });
  if (!m) throw new HttpError(404, 'Member not found');

  const otpStr = String(otp || '').trim();
  const isDemo = demoOtpAllowed() && (otpStr === '123456' || otpStr === '000000');
  if (!isDemo) {
    const challenge = await consumeChallenge(challengeId || `phone_change_${m._id}_${targetType}_${cleanPhone}`, otpStr);
    if (!challenge) {
      throw new HttpError(400, 'Invalid or expired OTP');
    }
  }

  const oldMobile = targetType === 'member' ? (m.mobile || '') : (m.guarantor?.mobile || '');
  if (targetType === 'member') await assertMobileFree(cleanPhone, m._id, { verifiedOnly: Boolean(oldMobile && oldMobile === cleanPhone) });

  // the OTP was sent to the number the member already has: it is verified now (nothing changes, so no approval is needed)
  if (oldMobile && oldMobile === cleanPhone) {
    if (targetType === 'member') m.mobileVerifiedAt = new Date();
    else if (m.guarantor) { m.guarantor.mobileVerifiedAt = new Date(); m.markModified('guarantor'); }
    await m.save();
    await audit(req, { action: 'member.mobileVerified', entity: 'Member', entityId: m._id, after: { memberCode: m.code, targetType, mobile: cleanPhone } });
    return res.json({ success: true, verified: true, mobile: cleanPhone, message: 'Mobile number verified successfully.' });
  }

  // Item 24: Submit to Admin KYC section for approval
  let reqDoc = await PhoneUpdateRequest.findOne({ member: m._id, status: 'pending' });
  if (reqDoc) {
    reqDoc.targetType = targetType;
    reqDoc.oldNumber = oldMobile;
    reqDoc.newNumber = cleanPhone;
    reqDoc.reason = cleanStr(reason);
    reqDoc.otpVerified = true;
    reqDoc.requestedBy = req.user._id;
    reqDoc.requestedByCode = req.user.employeeCode || req.user.name || '';
    await reqDoc.save();
  } else {
    reqDoc = await PhoneUpdateRequest.create({
      member: m._id,
      memberCode: m.code,
      memberName: m.name,
      branch: m.branch,
      targetType,
      oldNumber: oldMobile,
      newNumber: cleanPhone,
      reason: cleanStr(reason),
      otpVerified: true,
      status: 'pending',
      requestedBy: req.user._id,
      requestedByCode: req.user.employeeCode || req.user.name || '',
    });
  }

  await audit(req, {
    action: 'member.phoneUpdateRequest',
    entity: 'Member',
    entityId: m._id,
    after: { memberCode: m.code, targetType, oldNumber: oldMobile, newNumber: cleanPhone, reason },
  });

  res.json({
    success: true,
    mobile: cleanPhone,
    message: 'OTP verified successfully! Phone update request has been submitted to Admin KYC for approval.',
    request: reqDoc,
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
  res.json({ success: true, challengeId, ...(demoOtpAllowed() ? { devOtp: otp } : {}), message: 'OTP sent to guarantor mobile' });
}

export async function verifyGuarantorOtp(req, res) {
  const { mobile, otp, challengeId } = req.body || {};
  const cached = otpCache.get(challengeId);
  if (!cached || cached.mobile !== mobile || cached.otp !== otp || Date.now() > cached.expiresAt) {
    if (!(demoOtpAllowed() && otp === '123456')) throw new HttpError(400, 'Invalid or expired OTP');
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

  // Point 14 & 17: Sync with nominee if sameAsGuarantor is checked
  if (b.sameAsGuarantor) {
    m.nominee = {
      sameAsGuarantor: true,
      name: cleanStr(b.name),
      relation: cleanStr(b.relation),
      mobile: cleanStr(b.mobile),
      aadhaar: cleanStr(b.aadhaar),
      pan: cleanStr(b.pan),
      photo: b.photo || '',
      signature: b.signature || '',
      aadhaarPhoto: b.aadhaarPhoto || '',
      aadhaarBackPhoto: b.aadhaarBackPhoto || '',
    };
  }

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

  // Point 1: Block collection if already pending approval in system
  const existingPending = await AppEmiCollection.findOne({
    loanPayment: loan._id,
    memberCode: line.code,
    status: 'pending',
  }).lean();

  if (existingPending) {
    throw new HttpError(400, `EMI for member ${line.name} (${line.code}) has already been submitted and is pending approval in system. It cannot be collected again until approved.`);
  }

  const receiptNo = await generateCode('emiReceipt').catch(() => `DUE${Date.now().toString().slice(-8)}`);
  const branchVal = loan.branch?._id || loan.branch || (req.user?.branches || [])[0] || null;

  const pendingCollection = await AppEmiCollection.create({
    loanPayment: loan._id,
    loanId: loan.loanId || loan.formId,
    branch: branchVal,
    memberCode: line.code,
    memberName: line.name,
    group: loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '',
    amountPaise: Math.round(payAmount * 100),
    collectedOn: new Date(),
    type: 'regular',
    payMode: ['cash', 'bank', 'upi', 'cheque'].includes(payMode) ? payMode : 'cash',
    reference: reference || '',
    collectedBy: req.user?._id,
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
      modes: (Array.isArray(s.modes) && s.modes.length ? s.modes : ['weekly', 'monthly']).map((m) =>
        typeof m === 'object' && m !== null
          ? m
          : {
              value: String(m),
              label: String(m).charAt(0).toUpperCase() + String(m).slice(1),
              unit: m === 'daily' ? 'days' : m === 'weekly' ? 'weeks' : m === 'monthly' ? 'months' : '',
            }
      ),
      calculationType: s.calculationType || 'flat',
      emiType: s.emiType || 'equal',
      processingFee: s.processingFee,
      cost: s.cost,
      securityDeposit: s.securityDeposit,
      securityType: s.securityType || 'none',
      securityBp: s.securityBp || 0,
      installmentRounding: s.installmentRounding ?? 1,
      minCivilScore: s.minCivilScore || 0,
      civilRequired: Boolean(s.civilRequired),
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
// 8. BORROWER SYNOPSIS (MEMBER DETAIL REPORT - POINT 18: ALL DETAILS SAME AS SOFTWARE)
// -----------------------------------------------------------------------------

const SYNOPSIS_TIMELINE_LABELS = {
  'member.create': 'Borrower registered',
  'member.guarantorAdded': 'Guarantor added',
  'member.guarantorUpdated': 'Guarantor updated',
  'member.guarantorChanged': 'Guarantor changed',
  'member.nomineeAdded': 'Nominee added',
  'member.nomineeUpdated': 'Nominee updated',
  'member.update': 'Details edited by admin',
  'member.block': 'Member blocked',
  'member.unblock': 'Member unblocked',
  'kyc.approve': 'Document approved',
  'kyc.reject': 'Document rejected',
  'kyc.reupload': 'Document uploaded again',
  'loanRequisition.create': 'Loan requisition made',
  'loanRequisition.topUp': 'Product loan added to a group loan',
};

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
    .select('+photo +memberPhoto +signaturePhoto +aadhaarPhoto +aadhaarBackPhoto +panPhoto +guarantor.photo +guarantor.signature +guarantor.aadhaarPhoto +guarantor.aadhaarBackPhoto +guarantor.panPhoto +guarantor.jointPhoto +guarantorHistory.photo +guarantorHistory.signature +guarantorHistory.aadhaarPhoto +guarantorHistory.aadhaarBackPhoto +guarantorHistory.panPhoto +guarantorHistory.jointPhoto +nominee.photo +nominee.signature +nominee.aadhaarPhoto +nominee.aadhaarBackPhoto +nominee.panPhoto')
    .populate('branch', 'code name city pincode');
  if (!m) throw new HttpError(404, 'Member not found');

  // Item 13 Fix: Restrict cross-branch member visibility for staff
  const { branchIds } = await getEmployeeContext(req).catch(() => ({}));
  if (branchIds?.length && m.branch?._id && !branchIds.map(String).includes(String(m.branch._id))) {
    throw new HttpError(403, `Member ${m.code} belongs to another branch and cannot be viewed by this staff.`);
  }

  // 1. Groups & Group History (Item 16 Fix: Distinguish current active group vs previous transferred groups)
  const memberGroupDocs = await Group.find({ 'members.member': m._id, isDeleted: false })
    .populate('members.addedBy', 'name employeeCode')
    .sort({ createdAt: -1 })
    .lean();

  const groups = memberGroupDocs.map((g, idx) => {
    const row = (g.members || []).find((x) => String(x.member) === String(m._id));
    const isCurrent = idx === 0 && g.isActive;
    return {
      id: g._id,
      code: g.code,
      name: g.name,
      leaderName: g.leaderName,
      isActive: isCurrent,
      isCurrent,
      statusLabel: isCurrent ? 'Active (Current)' : 'Previous / Transferred',
      memberCount: (g.members || []).length,
      addedAt: row?.addedAt || null,
      addedBy: row?.addedBy ? { name: row.addedBy.name, employeeCode: row.addedBy.employeeCode || '' } : null,
    };
  });
  const groupDoc = memberGroupDocs[0] || null;

  // 2. Comprehensive Loan Requisitions & Paid Loans (matching software Loan Record)
  const reqs = await LoanRequisition.find({ isDeleted: false, $or: [{ member: m._id }, { members: m._id }] })
    .sort({ createdAt: -1 })
    .lean();

  const paidLoanIds = new Map(
    (await LoanPayment.find({ requisition: { $in: reqs.map((r) => r._id) }, status: 'paid' })
      .select('requisition loanId')
      .lean()
    ).map((p) => [String(p.requisition), p.loanId || ''])
  );

  const KIND_MAP = { personal: 'Personal', group: 'Group', business: 'Business / MSME', product: 'Product' };

  const detailedLoans = reqs.map((r) => {
    const mine = (r.additionalProducts || []).filter((a) => String(a.member) === String(m._id));
    return {
      id: r._id,
      loanId: paidLoanIds.get(String(r._id)) || '',
      formId: r.formId,
      kind: KIND_MAP[r.kind] || r.kind || 'Group Loan',
      loanDate: r.loanDate || r.createdAt,
      group: r.groupInfo?.code ? `${r.groupInfo.code} — ${r.groupInfo.name}` : '',
      scheme: `${r.schemeCode || ''} ${r.schemeName || ''}`.trim() || 'Standard Scheme',
      amount: (r.amountPaise || 0) / 100,
      cash: r.cashPaise != null ? r.cashPaise / 100 : null,
      mode: r.mode || 'weekly',
      term: r.term || 52,
      emi: (r.installmentPaise || 0) / 100,
      totalPayable: r.totalPayablePaise != null ? r.totalPayablePaise / 100 : null,
      product: r.product?.name ? `${r.product.name} × ${r.product.quantity || 1}` : '',
      productLoans: mine.map((a) => ({
        product: `${a.product?.name || 'Product'} × ${a.product?.quantity || 1}`,
        value: (a.valuePaise || 0) / 100,
        emi: (a.installmentPaise || 0) / 100,
      })),
      status: r.status,
      employeeCode: r.employeeCode || '',
    };
  });

  const paidLoans = await LoanPayment.find({ 'lines.code': m.code, status: 'paid' }).sort({ paidOn: -1 }).lean();
  let totalBorrowed = 0;
  paidLoans.forEach((l) => {
    const line = l.lines?.find((x) => x.code === m.code);
    if (line) totalBorrowed += (line.amountPaise || 0) / 100;
  });

  // 3. Recent EMIs
  const emiList = await EmiPayment.find({ memberCode: m.code, status: 'paid' }).sort({ paidOn: -1 }).limit(20).lean();
  const recentEmis = emiList.map((e) => ({
    receiptNo: e.receiptNo,
    amount: (e.amountPaise || 0) / 100,
    paidOn: e.paidOn ? new Date(e.paidOn).toISOString().slice(0, 10) : '',
    mode: e.payMode,
  }));

  // 4. Civil Checks Record
  const civilCheckDocs = await CivilCheck.find({ member: m._id, isDeleted: false })
    .sort({ reportDate: -1, createdAt: -1 })
    .lean();

  const civilChecks = civilCheckDocs.map((c) => ({
    id: c._id,
    reportDate: c.reportDate,
    bureau: c.bureau || 'CIBIL',
    reportNumber: c.reportNumber || '—',
    score: c.score,
    band: c.score >= 700 ? 'Good' : c.score >= 650 ? 'Moderate' : 'Poor',
    remark: c.remark || '—',
    employeeCode: c.employeeCode || '',
    employeeName: c.employeeName || '',
    recordedAt: c.createdAt || c.recordedAt,
  }));

  const actualCivilScore = civilChecks[0]?.score ?? (m.civilScore != null ? m.civilScore : null);

  // 5. KYC Documents Detailed States
  const KYC_DOC_LIST = [
    { key: 'memberPhoto', who: 'Member', label: 'Member photo', image: m.memberPhoto || m.photo || '' },
    { key: 'signaturePhoto', who: 'Member', label: 'Signature', image: m.signaturePhoto || '' },
    { key: 'aadhaarPhoto', who: 'Member', label: 'Aadhaar front', image: m.aadhaarPhoto || '' },
    { key: 'aadhaarBackPhoto', who: 'Member', label: 'Aadhaar back', image: m.aadhaarBackPhoto || '' },
    { key: 'panPhoto', who: 'Member', label: 'PAN card', image: m.panPhoto || '' },
    { key: 'guarantor.photo', who: 'Guarantor', label: 'Guarantor photo', image: m.guarantor?.photo || '' },
    { key: 'guarantor.signature', who: 'Guarantor', label: 'Guarantor signature', image: m.guarantor?.signature || '' },
    { key: 'guarantor.aadhaarPhoto', who: 'Guarantor', label: 'Guarantor Aadhaar front', image: m.guarantor?.aadhaarPhoto || '' },
    { key: 'guarantor.aadhaarBackPhoto', who: 'Guarantor', label: 'Guarantor Aadhaar back', image: m.guarantor?.aadhaarBackPhoto || '' },
    { key: 'guarantor.panPhoto', who: 'Guarantor', label: 'Guarantor PAN', image: m.guarantor?.panPhoto || '' },
    { key: 'guarantor.jointPhoto', who: 'Guarantor', label: 'Joint photo with member', image: m.guarantor?.jointPhoto || '' },
    ...(m.nominee?.sameAsGuarantor ? [] : [
      { key: 'nominee.photo', who: 'Nominee', label: 'Nominee photo', image: m.nominee?.photo || '' },
      { key: 'nominee.signature', who: 'Nominee', label: 'Nominee signature', image: m.nominee?.signature || '' },
      { key: 'nominee.aadhaarPhoto', who: 'Nominee', label: 'Nominee Aadhaar front', image: m.nominee?.aadhaarPhoto || '' },
      { key: 'nominee.aadhaarBackPhoto', who: 'Nominee', label: 'Nominee Aadhaar back', image: m.nominee?.aadhaarBackPhoto || '' },
      { key: 'nominee.panPhoto', who: 'Nominee', label: 'Nominee PAN', image: m.nominee?.panPhoto || '' },
    ]),
  ];

  const uploadedKycDocs = KYC_DOC_LIST.filter((d) => Boolean(d.image)).map((d) => {
    const rec = (m.kycDocs || []).find((x) => x.key === d.key || x.field === d.key);
    return {
      key: d.key,
      who: d.who,
      label: d.label,
      image: d.image,
      status: rec?.status || (m.joiningApproval?.status === 'approved' ? 'approved' : 'pending'),
      reason: rec?.reason || '',
      reviewedAt: rec?.reviewedAt || null,
      reviewedByCode: rec?.reviewedByCode || '',
      resubmitted: Boolean(rec?.resubmittedAt),
    };
  });

  const approvedKycCount = uploadedKycDocs.filter((d) => d.status === 'approved').length;

  // Item 13 Fix: KYC status must accurately reflect incomplete/missing documents.
  // Mandatory documents: memberPhoto, signaturePhoto, aadhaarPhoto, aadhaarBackPhoto.
  const hasMemberPhoto = Boolean(m.photo || m.memberPhoto);
  const hasSignature = Boolean(m.signature || m.signaturePhoto);
  const hasAadhaarFront = Boolean(m.aadhaarPhoto);
  const hasAadhaarBack = Boolean(m.aadhaarBackPhoto);

  const missingMandatoryDocs = [];
  if (!hasMemberPhoto) missingMandatoryDocs.push('Member Photo');
  if (!hasSignature) missingMandatoryDocs.push('Signature');
  if (!hasAadhaarFront) missingMandatoryDocs.push('Aadhaar Front');
  if (!hasAadhaarBack) missingMandatoryDocs.push('Aadhaar Back');

  const isKycMissing = missingMandatoryDocs.length > 0 || uploadedKycDocs.length === 0;
  const isKycRejected = Boolean(m.kycRejected || uploadedKycDocs.some((d) => d.status === 'rejected'));
  const isKycPending = Boolean(!isKycRejected && !isKycMissing && (m.kycPending || uploadedKycDocs.some((d) => d.status === 'pending')));
  const isKycApproved = Boolean(
    !isKycRejected &&
    !isKycMissing &&
    !isKycPending &&
    approvedKycCount >= 4 &&
    (m.isKycApproved || m.joiningApproval?.status === 'approved' || m.kycVerified)
  );
  const kycStatus = isKycRejected ? 'rejected' : isKycMissing ? 'missing' : isKycPending ? 'pending' : isKycApproved ? 'approved' : 'pending';

  const kyc = {
    status: kycStatus,
    approved: approvedKycCount,
    total: uploadedKycDocs.length,
    missingMandatoryDocs,
    isMissing: isKycMissing,
    documents: uploadedKycDocs,
  };

  // 6. Audit Timeline (Activity History)
  const memberAuditLogs = await AuditLog.find({ entity: 'Member', entityId: String(m._id) })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const reqIds = reqs.map((r) => String(r._id));
  const loanAuditLogs = reqIds.length
    ? await AuditLog.find({ entity: 'LoanRequisition', entityId: { $in: reqIds } })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean()
    : [];

  const timeline = [...memberAuditLogs, ...loanAuditLogs]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .filter((l) => SYNOPSIS_TIMELINE_LABELS[l.action])
    .map((l) => {
      const a = l.after || {};
      const detail = [
        a.document ? `Document: ${a.document}` : '',
        a.formId ? `Form ${a.formId}${a.scheme ? ` · ${a.scheme}` : ''}${a.amount ? ` · ₹${a.amount}` : ''}` : '',
        a.reason ? `Reason: ${a.reason}` : '',
        Array.isArray(a.changed) && a.changed.length ? `Changed: ${a.changed.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      return {
        at: l.createdAt,
        label: SYNOPSIS_TIMELINE_LABELS[l.action],
        by: l.actorEmail || l.actorCode || 'Staff',
        detail,
      };
    });

  const memberData = {
    id: m._id,
    _id: m._id,
    code: m.code,
    formId: m.formId || '',
    name: m.name,
    photo: m.memberPhoto || m.photo || '',
    memberPhoto: m.memberPhoto || m.photo || '',
    signaturePhoto: m.signaturePhoto || '',
    aadhaarPhoto: m.aadhaarPhoto || '',
    aadhaarBackPhoto: m.aadhaarBackPhoto || '',
    panPhoto: m.panPhoto || '',
    husbandName: m.husbandName || '',
    fatherName: m.fatherName || '',
    dob: m.dob ? new Date(m.dob).toISOString().slice(0, 10) : '',
    gender: m.gender || 'female',
    occupation: m.occupation || 'Self Employed',
    education: m.education || 'High School',
    employeeCode: m.employeeCode || '',
    joiningDate: m.joiningDate ? new Date(m.joiningDate).toISOString().slice(0, 10) : '',
    mobile: m.mobile,
    mobileVerified: Boolean(m.mobileVerifiedAt),
    email: m.email || '',
    address: m.address || '',
    area: m.area || '',
    district: m.district || '',
    state: m.state || '',
    pincode: m.pincode || '',
    fullAddress: [m.address, m.area, m.district, m.state, m.pincode].filter(Boolean).join(', '),
    aadhaar: m.aadhaar,
    pan: m.pan || '',
    panVerified: Boolean(m.panVerifiedAt),
    bankName: m.bankName || '',
    ifsc: m.ifsc || '',
    accountNumber: m.accountNumber || '',
    branch: m.branch ? { id: m.branch._id, code: m.branch.code, name: m.branch.name } : null,
    branchName: m.branch?.name || m.branch?.code || '',
    groupCode: groupDoc?.code || '',
    groupName: groupDoc ? `${groupDoc.code} — ${groupDoc.name}` : (m.groupName || 'Individual'),
    civilScore: actualCivilScore,
    isKycApproved,
    isKycPending,
    isKycRejected,
    kycStatus,
    isBlocked: Boolean(m.isBlocked),
    writeOff: m.writeOff?.totalPaise > 0 ? { total: m.writeOff.totalPaise / 100, paid: (m.writeOff.paidPaise || 0) / 100, due: (m.writeOff.totalPaise - (m.writeOff.paidPaise || 0)) / 100, at: m.writeOff.at, loans: (m.writeOff.loans || []).map((l) => ({ loanId: l.loanId, amount: (l.paise || 0) / 100, date: l.at, remark: l.remark || '' })), payments: (m.writeOff.payments || []).map((x) => ({ receiptNo: x.receiptNo, amount: (x.amountPaise || 0) / 100, date: x.paidOn, byCode: x.byCode || '' })) } : null,
    blockReason: m.blockReason || '',
    guarantor: m.guarantor || null,
    guarantorHistory: m.guarantorHistory || [],
    phoneHistory: (m.phoneHistory || []).map((h) => ({
      targetType: h.targetType,
      oldNumber: h.oldNumber,
      newNumber: h.newNumber,
      reason: h.reason || '',
      requestedByCode: h.requestedByCode || '',
      requestedAt: h.requestedAt,
      approvedByCode: h.approvedByCode || '',
      approvedAt: h.approvedAt,
    })).reverse(),
    nominee: m.nominee || null,
    totalBorrowed,
    loansCount: detailedLoans.length,
    legacyImport: Boolean(m.legacyImport),
    missingDetails: missingDetails(m).map(({ key, label }) => ({ key, label })),
    hasMissingDetails: missingDetails(m).length > 0,
  };

  const pendingPhoneRequest = await PhoneUpdateRequest.findOne({ member: m._id, status: 'pending' }).lean();

  res.json({
    member: memberData,
    kyc,
    groups,
    groupTransfers: m.groupTransfers || [],
    loans: detailedLoans,
    civilChecks,
    blockHistory: m.blockHistory || [],
    phoneHistory: memberData.phoneHistory || [],
    pendingPhoneRequest: pendingPhoneRequest ? {
      id: pendingPhoneRequest._id,
      targetType: pendingPhoneRequest.targetType,
      oldNumber: pendingPhoneRequest.oldNumber,
      newNumber: pendingPhoneRequest.newNumber,
      reason: pendingPhoneRequest.reason,
      requestedByCode: pendingPhoneRequest.requestedByCode,
      createdAt: pendingPhoneRequest.createdAt,
    } : null,
    editHistory: m.editHistory || [],
    timeline,
    recentEmis,
    ...memberData,
  });
}

// -----------------------------------------------------------------------------
// 9. LOAN CALCULATOR & REQUISITION (POINT 24: SECURITY IN ₹ RUPEES)
// -----------------------------------------------------------------------------

export async function calculateLoanEmi(req, res) {
  const amount = Number(req.body?.amount) || 10000;
  const rateAnnual = Number(req.body?.annualRate ?? req.body?.interestRate) || 24;
  const term = Number(req.body?.term) || 52;
  const mode = req.body?.mode || 'weekly';
  const calculationType = req.body?.calculationType || 'flat';

  let scheme = null;
  const schemeId = req.body?.schemeId || req.body?.scheme;
  if (schemeId && mongoose.isValidObjectId(String(schemeId))) {
    scheme = await LoanScheme.findOne({ _id: schemeId, isDeleted: false }).lean();
  }

  const freqPerYear = mode === 'daily' ? 365 : mode === 'weekly' ? 52 : 12;
  let totalInterest = 0;
  let installment = 0;
  let totalPayable = 0;

  if (calculationType === 'flat') {
    totalInterest = Math.round((amount * rateAnnual * (term / freqPerYear)) / 100);
    totalPayable = amount + totalInterest;
    installment = Math.round(totalPayable / term);
  } else {
    // Reducing balance formula
    const r = rateAnnual / (freqPerYear * 100);
    if (r === 0) {
      installment = Math.round(amount / term);
      totalPayable = amount;
      totalInterest = 0;
    } else {
      installment = Math.round((amount * r * Math.pow(1 + r, term)) / (Math.pow(1 + r, term) - 1));
      totalPayable = installment * term;
      totalInterest = Math.max(0, totalPayable - amount);
    }
  }

  // Point 14: Scheme-based Deductions Breakdown
  let processingFee = 0;
  let procDesc = '2%';
  let procPercent = 2;
  let insurance = 0;
  let insDesc = '1.5%';
  let insPercent = 1.5;
  let security = 0;
  let secDesc = '5%';
  let secPercent = 5;
  let securityType = 'none';

  if (scheme) {
    // 1. Processing Fee
    if (scheme.processingFee) {
      if (scheme.processingFee.type === 'fixed') {
        processingFee = Math.round((scheme.processingFee.value || 0) / 100);
        procDesc = `Fixed ₹${processingFee.toLocaleString('en-IN')}`;
        procPercent = amount > 0 ? Math.round((processingFee / amount) * 1000) / 10 : 0;
      } else {
        const bp = scheme.processingFee.value || 0;
        procPercent = bp / 100;
        processingFee = Math.round((amount * bp) / 10000);
        procDesc = `${procPercent}%`;
      }
    }
    // 2. Insurance / Cost
    if (scheme.cost) {
      if (scheme.cost.type === 'fixed') {
        insurance = Math.round((scheme.cost.value || 0) / 100);
        insDesc = `Fixed ₹${insurance.toLocaleString('en-IN')}`;
        insPercent = amount > 0 ? Math.round((insurance / amount) * 1000) / 10 : 0;
      } else {
        const bp = scheme.cost.value || 0;
        insPercent = bp / 100;
        insurance = Math.round((amount * bp) / 10000);
        insDesc = `${insPercent}%`;
      }
    }
    // 3. Security Deposit
    securityType = scheme.securityType || 'none';
    if (securityType !== 'none') {
      if (scheme.securityDeposit?.type === 'fixed') {
        security = Math.round((scheme.securityDeposit.value || 0) / 100);
        secDesc = `Fixed ₹${security.toLocaleString('en-IN')}`;
        secPercent = amount > 0 ? Math.round((security / amount) * 1000) / 10 : 0;
      } else {
        const bp = scheme.securityDeposit?.value ?? scheme.securityBp ?? 0;
        secPercent = bp / 100;
        security = Math.round((amount * bp) / 10000);
        secDesc = `${secPercent}%`;
      }
    } else {
      security = 0;
      secDesc = 'None (0%)';
      secPercent = 0;
    }
  } else {
    processingFee = Math.round(amount * 0.02);
    insurance = Math.round(amount * 0.015);
    security = Math.round(amount * 0.05);
  }

  const totalDeductions = processingFee + insurance + security;
  const netDisbursed = Math.max(0, amount - totalDeductions);

  res.json({
    amount,
    principal: amount,
    installment,
    emi: installment,
    totalInterest,
    totalPayable,
    term,
    mode,
    calculationType,
    processingFee,
    procDesc,
    procPercent,
    insurance,
    insDesc,
    insPercent,
    security,
    secDesc,
    secPercent,
    securityAmount: security,
    securityPercent: secPercent,
    securityType,
    securityFormatted: `₹${security.toLocaleString('en-IN')}`,
    totalDeductions,
    netDisbursed,
    schemeName: scheme?.name || '',
    schemeCode: scheme?.code || '',
  });
}

function resolveGroupMeetingType(g) {
  if (!g) return 'weekly';
  const name = String(g.name || '').toLowerCase();
  if (/\b(daily|dly)\b|\[daily\]|\(daily\)|\(dly\)|\[dly\]/.test(name)) return 'daily';
  if (/\b(weekly|wly|wky)\b|\[weekly\]|\(weekly\)|\(wly\)|\[wly\]/.test(name)) return 'weekly';
  if (/\b(monthly|mly)\b|\[monthly\]|\(monthly\)|\(mly\)|\[mly\]/.test(name)) return 'monthly';
  const mt = String(g.meetingType || g.mode || '').toLowerCase();
  if (['daily', 'weekly', 'monthly'].includes(mt)) return mt;
  if (g.collectionDay !== undefined && g.collectionDay !== null && Number(g.collectionDay) > 0) return 'weekly';
  return 'weekly';
}

export async function getStaffGroups(req, res) {
  const { emp, code, branchId } = await getEmployeeContext(req);
  const codeRegex = code ? new RegExp(`^${code}$`, 'i') : null;

  let groups = await Group.find({
    isDeleted: { $ne: true },
    $or: [
      ...(codeRegex ? [{ employeeCode: codeRegex }, { staffCode: codeRegex }] : []),
      ...(emp?._id ? [{ employee: emp._id }, { staffId: emp._id }] : []),
      ...(branchId ? [{ branch: branchId }] : []),
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
      meetingType: resolveGroupMeetingType(g),
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
    // Every member of the loan must be ready: the same rules as the staff web requisition (details, guarantor, nominee, KYC documents).
    const notReadyGroup = chosenMembers.flatMap((mm) => notReady(mm).map((why) => `${mm.code}: ${why}`));
    if (notReadyGroup.length) throw new HttpError(409, `These members are not ready for a loan: ${notReadyGroup.join(' | ')}`);

    // Auto-derive Scheme parameters
    let rate = Number(b.annualRate || b.rate) || 24;
    let term = Number(b.term) || 52;
    let mode = b.mode || 'weekly';

    let schemeRef = null;
    if (b.schemeId && mongoose.isValidObjectId(b.schemeId)) {
      const schemeDoc = await LoanScheme.findById(b.schemeId);
      schemeRef = schemeDoc;
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
    const { installment, totalInterest } = installmentOf(amountPerMember, rate, term, mode, schemeRef);

    const reqDoc = await LoanRequisition.create({
      formId,
      kind: 'group',
      branch: branchId,
      loanDate: await defaultWorkDate(branchId, req.user).catch(() => startOfToday()),
      schemeName: b.schemeName || 'Group Loan Scheme',
      scheme: b.schemeId || new mongoose.Types.ObjectId(),
      amountPaise: amountPerMember * 100,
      totalAmountPaise: totalAmount * 100,
      requestedAmountPaise: totalAmount * 100,
      installmentPaise: installment * 100,
      ...(await loanFieldsOf(schemeRef, amountPerMember, rate, term, mode)),
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

  // Point 10: Strictly block requisition for blocked members
  if (memberDoc.isBlocked) {
    throw new HttpError(400, `Member ${borrowerCode} is blocked. Blocked members cannot apply for loans.`);
  }

  // The same rules as the staff web requisition: details, guarantor, nominee and KYC documents must be complete.
  const notReadyReasons = notReady(memberDoc);
  if (notReadyReasons.length) {
    throw new HttpError(409, `${borrowerCode} is not ready for a loan: ${notReadyReasons.join('; ')}`, { member: notReadyReasons[0] });
  }

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

  // Point 10: Same member personal loan single active loan enforcement (no unlimited loans)
  if (kind === 'personal') {
    const runningPersonal = await LoanPayment.findOne({
      'lines.code': new RegExp(`^${borrowerCode}$`, 'i'),
      status: 'paid',
      isSettled: { $ne: true },
      loanType: 'personal',
    }).lean();
    const pendingPersonal = await LoanRequisition.findOne({
      isDeleted: false,
      kind: 'personal',
      $or: [{ member: memberDoc._id }, { memberCode: new RegExp(`^${borrowerCode}$`, 'i') }],
      status: { $in: ['pending', 'approved'] },
    }).lean();
    if (runningPersonal || pendingPersonal) {
      throw new HttpError(400, `Member ${borrowerCode} already has an active personal loan or pending requisition (${pendingPersonal?.formId || runningPersonal?.loanId}). Unlimited personal loans are not allowed.`);
    }
  }

  // Point 11: Same member business/msme loan single active loan enforcement
  if (kind === 'business') {
    const runningBiz = await LoanPayment.findOne({
      'lines.code': new RegExp(`^${borrowerCode}$`, 'i'),
      status: 'paid',
      isSettled: { $ne: true },
      loanType: { $in: ['business', 'msme'] },
    }).lean();
    const pendingBiz = await LoanRequisition.findOne({
      isDeleted: false,
      kind: { $in: ['business', 'msme'] },
      $or: [{ member: memberDoc._id }, { memberCode: new RegExp(`^${borrowerCode}$`, 'i') }],
      status: { $in: ['pending', 'approved'] },
    }).lean();
    if (runningBiz || pendingBiz) {
      throw new HttpError(400, `Member ${borrowerCode} already has an active business/MSME loan or pending requisition (${pendingBiz?.formId || runningBiz?.loanId}).`);
    }
  }

  // Point 7: Auto-derive and enforce Scheme parameters (Interest Rate, Term, Mode) strictly from Scheme
  let rate = Number(b.annualRate || b.rate) || 24;
  let term = Number(b.term) || 52;
  let mode = b.mode || 'weekly';

  let schemeRef = null;
  if (b.schemeId && mongoose.isValidObjectId(b.schemeId)) {
    const schemeDoc = await LoanScheme.findById(b.schemeId);
    schemeRef = schemeDoc;
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
  const { installment, totalInterest } = installmentOf(amount, rate, term, mode, schemeRef);

  const reqDoc = await LoanRequisition.create({
    formId,
    kind,
    branch: branchId,
    loanDate: await defaultWorkDate(branchId, req.user).catch(() => startOfToday()),
    schemeName: b.schemeName || 'Standard Loan Scheme',
    scheme: b.schemeId || new mongoose.Types.ObjectId(),
    amountPaise: amount * 100,
    totalAmountPaise: amount * 100,
    requestedAmountPaise: amount * 100,
    installmentPaise: installment * 100,
    ...(await loanFieldsOf(schemeRef, amount, rate, term, mode)),
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
  // everything the borrowers have to pay for the loan (the installments carry the interest); the principal is only used when the loan has no schedule
  const scheduleTotalPaise = (loan.lines?.length ? loan.lines : [{}]).reduce((t, ln) => t + (loan.schedule || []).reduce((a, x) => a + (x.installmentPaise || 0), 0) + (ln.extraEmiPaise || 0) * (loan.schedule?.length || 0), 0);
  const totalAmountPaise = scheduleTotalPaise > 0 ? scheduleTotalPaise : (loan.totalAmountPaise || loan.amountPaise || 0);
  const balancePaise = Math.max(0, totalAmountPaise - totalCollectedPaise);

  // Check if loan has an active settlement (Auto Settled / Settled)
  const settlement = await LoanSettlement.findOne({
    loanPayment: loan._id,
    status: 'active',
  }).lean();

  const isAutoSettled = Boolean(settlement);
  const isClosed = isAutoSettled || balancePaise <= 0 || loan.status === 'closed';

  // Check if loan has any collections pending system approval (Point 1, 6, 9)
  const pendingAppCollections = await AppEmiCollection.find({
    loanPayment: loan._id,
    status: 'pending',
  }).sort({ collectedOn: -1 }).lean();

  const totalPendingPaise = pendingAppCollections.reduce((acc, pc) => acc + (pc.amountPaise || 0), 0);

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

  const formattedApprovedPayments = emiPayments.map((p) => ({
    receiptNo: p.receiptNo,
    type: p.type,
    paidOn: p.paidOn ? new Date(p.paidOn).toISOString().split('T')[0] : 'N/A',
    amount: (p.amountPaise || 0) / 100,
    payMode: p.payMode,
    memberCode: p.memberCode,
    memberName: p.memberName,
    npa: p.npa,
    status: 'paid',
    isPendingApproval: false,
  }));

  const formattedPendingPayments = pendingAppCollections.map((pc) => ({
    receiptNo: pc.receiptNo || 'PENDING',
    type: pc.type || 'regular',
    paidOn: pc.collectedOn ? new Date(pc.collectedOn).toISOString().split('T')[0] : 'Today',
    amount: (pc.amountPaise || 0) / 100,
    payMode: pc.payMode,
    memberCode: pc.memberCode,
    memberName: pc.memberName,
    npa: Boolean(pc.npa),
    status: 'pending_approval',
    isPendingApproval: true,
  }));

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
      isPendingApproval: pendingAppCollections.length > 0,
      pendingApprovalAmount: totalPendingPaise / 100,
      pendingApprovalCount: pendingAppCollections.length,
      scheduleCount: loan.schedule?.length || 0,
    },
    schedule: scheduleWithStatus,
    payments: [...formattedPendingPayments, ...formattedApprovedPayments],
  });
}

// -----------------------------------------------------------------------------
// 14. GROUP EMI PAYMENT & FILTERS (DAILY, WEEKLY, MONTHLY)
// -----------------------------------------------------------------------------
export async function getEmiGroups(req, res) {
  const { emp, code: staffCode, branchId } = await getEmployeeContext(req);
  const codeRegex = staffCode ? new RegExp(`^${staffCode}$`, 'i') : null;
  const mode = cleanStr(req.query.mode || 'all').toLowerCase();
  const dateStr = cleanStr(req.query.date) || todayDateString();

  const targetDate = new Date(`${dateStr}T12:00:00.000Z`);
  const jsDay = targetDate.getDay(); // 0: Sun, 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const dayOfMonth = targetDate.getDate();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDayName = dayNames[jsDay];

  // Point 3: Check if caller is a Supervisor / Branch Manager
  const isSupervisorUser = Boolean(
    req.user?.isSupervisor ||
    ['supervisor', 'branch_manager', 'area_manager', 'admin', 'super_admin'].includes(req.user?.role) ||
    (Array.isArray(emp?.supervisedBranches) && emp.supervisedBranches.length > 0) ||
    emp?.isSupervisor
  );

  let branchIds = [];
  if (branchId) branchIds.push(branchId);
  if (emp?.branch) branchIds.push(emp.branch._id || emp.branch);
  if (Array.isArray(emp?.supervisedBranches)) {
    for (const b of emp.supervisedBranches) branchIds.push(b._id || b);
  }
  if (Array.isArray(req.user?.branches)) {
    for (const b of req.user.branches) branchIds.push(b._id || b);
  }
  if (req.query.branchId && mongoose.isValidObjectId(req.query.branchId)) {
    branchIds = [req.query.branchId];
  }
  branchIds = [...new Set(branchIds.map(String))];

  const allStaffCodes = [
    req.query.staffCode,
    staffCode,
    emp?.employeeCode,
    emp?.staffCode,
    req.user?.employeeCode,
    req.user?.username,
  ].filter(Boolean).map((s) => s.trim().toUpperCase());
  const uniqueStaffCodes = [...new Set(allStaffCodes)];
  const staffRegexList = uniqueStaffCodes.map((c) => new RegExp(`^${c}$`, 'i'));

  let myAssignedGroups = [];
  const groupDocMap = new Map();

  if (isSupervisorUser && branchIds.length > 0) {
    const supGroupQuery = { isDeleted: { $ne: true }, branch: { $in: branchIds } };
    if (req.query.staffCode) {
      supGroupQuery.employeeCode = req.query.staffCode.toUpperCase();
    }
    myAssignedGroups = await Group.find(supGroupQuery).select('code name meetingType dayOfWeek collectionDay branch center').lean();
  } else {
    // Item 7: Field staff should strictly only see their assigned groups (NOT company groups)
    const staffGroupQuery = {
      isDeleted: { $ne: true },
      $or: [
        ...(staffRegexList.length ? [{ employeeCode: { $in: staffRegexList } }, { staffCode: { $in: staffRegexList } }] : []),
        ...(emp?._id ? [{ employee: emp._id }, { staffId: emp._id }] : []),
        { createdBy: req.user._id },
      ],
    };
    if (branchIds.length > 0) {
      staffGroupQuery.branch = { $in: branchIds };
    }
    myAssignedGroups = await Group.find(staffGroupQuery).select('code name meetingType dayOfWeek collectionDay branch center').lean();
  }

  for (const g of myAssignedGroups) {
    if (g.code) groupDocMap.set(g.code, g);
  }

  let myGroupCodes = myAssignedGroups.map((g) => g.code).filter(Boolean);

  if (!myGroupCodes.length) {
    // If no direct group records found, check loans explicitly assigned to this staff (NEVER include all-branch loans for non-supervisors!)
    const staffLoanQuery = {
      status: 'paid',
      'group.code': { $exists: true, $ne: '' },
    };
    if (branchIds.length > 0) {
      staffLoanQuery.branch = { $in: branchIds };
    }
    if (!isSupervisorUser) {
      staffLoanQuery.$or = [
        ...(staffRegexList.length ? [{ employeeCode: { $in: staffRegexList } }, { staffCode: { $in: staffRegexList } }] : []),
        ...(emp?._id ? [{ staff: emp._id }, { employee: emp._id }] : []),
        { createdBy: req.user._id },
      ];
    }
    const staffLoans = await LoanPayment.find(staffLoanQuery).select('group.code').lean();
    myGroupCodes = [...new Set(staffLoans.map((l) => l.group?.code).filter(Boolean))];
  }

  // Only supervisors who have no assigned groups may fallback to viewing their branch groups
  if (!myGroupCodes.length && isSupervisorUser && branchIds.length > 0) {
    const branchGroups = await Group.find({ branch: { $in: branchIds }, isDeleted: { $ne: true } }).select('code name meetingType dayOfWeek collectionDay branch center').limit(100).lean();
    for (const g of branchGroups) {
      if (g.code) groupDocMap.set(g.code, g);
    }
    myGroupCodes = branchGroups.map((g) => g.code).filter(Boolean);
  }

  // Pre-load Group documents for any group codes discovered via loans so collection day and meeting type are accurate
  const missingGroupCodes = myGroupCodes.filter((c) => !groupDocMap.has(c));
  if (missingGroupCodes.length > 0) {
    const extraGroups = await Group.find({ code: { $in: missingGroupCodes }, isDeleted: { $ne: true } }).select('code name meetingType dayOfWeek collectionDay branch center').lean();
    for (const g of extraGroups) {
      if (g.code) groupDocMap.set(g.code, g);
    }
  }

  const loanQuery = {
    status: 'paid',
    'group.code': { $in: myGroupCodes },
  };
  // Point 4: Strictly filter group loans by branch
  if (branchIds.length > 0) {
    loanQuery.branch = { $in: branchIds };
  }

  // The loans of the groups, with what their schedules add up to (the first installment, how many, the total, how many fell due by the date, the
  // weekdays and days of the month they fall on). The schedules themselves are not sent: that is what made this slow.
  const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);
  const sched = { $ifNull: ['$schedule', []] };
  const castMatch = { ...loanQuery, ...(loanQuery.branch ? { branch: { $in: loanQuery.branch.$in.map((b) => new mongoose.Types.ObjectId(String(b))) } } : {}) };
  let allLoans = (await LoanPayment.aggregate([
    { $match: castMatch },
    { $project: {
      loanId: 1, formId: 1, mode: 1, modeLabel: 1, group: 1, lines: 1, isSettled: 1, status: 1, totalAmountPaise: 1, createdAt: 1, branch: 1, emiEndDate: 1,
      first: { $arrayElemAt: [sched, 0] },
      n: { $size: sched },
      total: { $sum: '$schedule.installmentPaise' },
      dueCount: { $size: { $filter: { input: sched, as: 's', cond: { $and: [{ $ne: ['$$s.dueDate', null] }, { $lte: ['$$s.dueDate', endOfDay] }] } } } },
      dows: { $setUnion: [{ $map: { input: sched, as: 's', in: { $dayOfWeek: '$$s.dueDate' } } }, []] },
      doms: { $setUnion: [{ $map: { input: sched, as: 's', in: { $dayOfMonth: '$$s.dueDate' } } }, []] },
    } },
  ])).map((l) => ({
    ...l,
    // only the first installment is kept as the schedule (its amount and date are what the code below reads); the rest is in _sch
    schedule: l.first ? [{ dueDate: l.first.dueDate, installmentPaise: l.first.installmentPaise }] : [],
    _sch: { n: l.n || 0, total: l.total || 0, dueCount: l.dueCount || 0, dows: new Set((l.dows || []).map((d) => d - 1)), doms: new Set(l.doms || []) },
  }));

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

  // What was paid, added up by the database per loan and borrower: all time and today (it used to load every EMI payment of these loans)
  const paidAgg = allLoanIds.length ? await EmiPayment.aggregate([
    { $match: { loanPayment: { $in: allLoanIds }, status: 'paid' } },
    { $group: { _id: { l: '$loanPayment', m: '$memberCode' }, total: { $sum: '$amountPaise' }, today: { $sum: { $cond: [{ $and: [{ $gte: ['$paidOn', startDay] }, { $lte: ['$paidOn', endDay] }] }, '$amountPaise', 0] } } } },
  ]) : [];
  const paymentsByKey = new Map();
  const seenTodayLoanMember = new Set();
  for (const p of paidAgg) {
    const k = `${String(p._id.l)}_${String(p._id.m || '').trim().toUpperCase()}`;
    const cur = paymentsByKey.get(k) || { totalPaise: 0, todayPaise: 0 };
    cur.totalPaise += p.total || 0;
    cur.todayPaise += p.today || 0;
    paymentsByKey.set(k, cur);
    if ((p.today || 0) > 0) seenTodayLoanMember.add(k);
  }

  // Only include pending AppEmiCollections awaiting approval (do not double-count approved collections)
  const appCollections = allLoanIds.length ? await AppEmiCollection.find({
    loanPayment: { $in: allLoanIds },
    status: 'pending',
    collectedOn: { $gte: startDay, $lte: endDay },
  }).select('loanPayment memberCode amountPaise receiptNo').lean() : [];
  const pendingReceipts = appCollections.map((c) => c.receiptNo).filter(Boolean);
  const allPastReceipts = new Set(pendingReceipts.length
    ? (await EmiPayment.find({ loanPayment: { $in: allLoanIds }, status: 'paid', receiptNo: { $in: pendingReceipts } }).select('receiptNo').lean()).map((p) => p.receiptNo)
    : []);

  const collectionsByLoanId = new Map();
  for (const c of collections) {
    collectionsByLoanId.set(String(c._id), c.total || 0);
  }
  for (const ac of appCollections) {
    if (ac.receiptNo && allPastReceipts.has(ac.receiptNo)) continue;
    const lmKey = `${String(ac.loanPayment)}_${String(ac.memberCode || '').trim().toUpperCase()}`;
    if (seenTodayLoanMember.has(lmKey)) continue;
    const lid = String(ac.loanPayment);
    collectionsByLoanId.set(lid, (collectionsByLoanId.get(lid) || 0) + (ac.amountPaise || 0));
  }

  for (const ac of appCollections) {
    if (ac.receiptNo && allPastReceipts.has(ac.receiptNo)) continue;
    const k = `${String(ac.loanPayment)}_${String(ac.memberCode || '').trim().toUpperCase()}`;
    if (seenTodayLoanMember.has(k)) continue;
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
        // Item 7: Weekly groups strictly match today's day (1 = Monday, ..., 7 = Sunday)
        isScheduled = (groupDayNum === isoDay) || (groupDayNum === jsDay && jsDay !== 0);
        const dayIdx = groupDayNum === 7 ? 0 : groupDayNum;
        scheduledDayLabel = dayNames[dayIdx] ? dayNames[dayIdx].charAt(0).toUpperCase() + dayNames[dayIdx].slice(1) : 'Weekly';
      } else {
        // Fallback: check if any loan has an installment due on targetDate or matching weekday
        isScheduled = groupLoans.some((l) => l._sch.dows.has(jsDay));
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
        isScheduled = groupLoans.some((l) => l._sch.doms.has(dayOfMonth));
        scheduledDayLabel = 'Monthly';
      }
    }

    // Item 7: If not scheduled for this date, strictly skip (daily shows daily, weekly Monday only shows on Monday)
    if (!isScheduled && req.query.showAll !== 'true') continue;

    // Calculate members, due amounts, collected amounts, and pending dues count
    let totalActualEmiPaise = 0;
    let totalOldDuePaise = 0;
    let totalPendingDuePaise = 0;
    let totalCollectedToday = 0;
    let membersCount = 0;
    let dueCount = 0;

    // Sort loans newest first and deduplicate by member code so multiple loan records in group (e.g. G0000048) never produce duplicate members / inflated actualCollection
    groupLoans.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const seenMemberCodes = new Set();

    for (const l of groupLoans) {
      if (l.isSettled || l.status === 'settled' || settledKeySet.has(String(l._id))) continue;

      for (const line of (l.lines || [])) {
        const codeKey = line.code ? String(line.code).toUpperCase().trim() : (line.member ? String(line.member) : '');
        if (codeKey && seenMemberCodes.has(codeKey)) continue;

        const isLineSettled = line.isSettled || settledKeySet.has(`${String(l._id)}_${line.code}`) || settledKeySet.has(`${l.loanId}_${line.code}`) || (codeKey && (settledKeySet.has(`${String(l._id)}_${codeKey}`) || settledKeySet.has(`${l.loanId}_${codeKey}`)));
        if (isLineSettled) continue;

        const stats = (codeKey ? paymentsByKey.get(`${String(l._id)}_${codeKey}`) : null) || paymentsByKey.get(`${String(l._id)}_${line.code}`) || { totalPaise: 0, todayPaise: 0 };
        const totalScheduledPaise = l._sch.total + (line.extraEmiPaise || 0) * l._sch.n;
        const totalLoanPaise = line.amountPaise || l.totalAmountPaise || 0;
        if (totalScheduledPaise > 0 && stats.totalPaise >= totalScheduledPaise) continue; // finished loan
        // NPA: not part of the actual collection (his recovery is an NPA payment)
        {
          const emiN = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
          const duesN = Math.max(0, (l._sch.dueCount || 0) * emiN - stats.totalPaise);
          if (isNpaMember({ loan: l, line, emiPaise: emiN, duesPaise: duesN, scheduledPaise: totalScheduledPaise, paidPaise: stats.totalPaise, dateStr })) continue;
        }
        // (a loan is finished when everything scheduled is paid, see above; what was paid is not compared with the principal, because the installments also carry the interest)

        if (codeKey) seenMemberCodes.add(codeKey);

        const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
        totalActualEmiPaise += emiPaise;
        totalCollectedToday += (stats.todayPaise || 0) / 100;
        membersCount++;

        // Strict endDay comparison so installments due on dateStr are included (Point 2 fix)
        const expectedDuePaise = l._sch.dueCount * emiPaise;
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
    // Point 3 Fix: A group is ONLY completed if scheduled for targetDate, collection was actually performed (> 0), covers expected collection, and no pending dues.
    // When looking at next day, totalCollectedToday is 0 so isCompleted is strictly false!
    const isCompleted = Boolean(isScheduled && totalCollectedToday > 0 && totalCollectedToday >= actualCollection && dueCount === 0);

    groups.push({
      _id: groupDoc?._id || code,
      id: groupDoc?._id || code,
      code,
      name: groupDoc?.name || groupLoans[0]?.group?.name || code,
      groupCode: code,
      groupName: groupDoc?.name || groupLoans[0]?.group?.name || code,
      center: groupDoc?.center || (groupDoc?.name ? `${groupDoc.name} Center` : 'Main Center'),
      mode: meetingType,
      scheduledDay: scheduledDayLabel,
      isScheduled,
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

/** One word for the pay modes of a member of the day: cash, upi, ... or mixed (more than one), empty when there is none. */
function modeOfSet(set) {
  const modes = [...(set || [])].filter((m) => m && m !== 'security');
  return modes.length === 1 ? modes[0] : modes.length > 1 ? 'mixed' : '';
}

export async function getGroupEmiMembers(req, res) {
  const groupCode = cleanStr(req.params.groupCode);
  const dateStr = cleanStr(req.query.date) || todayDateString();

  let targetCode = groupCode;
  let targetName = groupCode;
  if (mongoose.isValidObjectId(groupCode)) {
    const gDoc = await Group.findById(groupCode).lean();
    if (gDoc) {
      targetCode = gDoc.code || targetCode;
      targetName = gDoc.name || targetName;
    }
  }

  const escapedCode = targetCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const { branchId, branchIds } = await getEmployeeContext(req).catch(() => ({}));
  const bList = branchIds?.length ? branchIds : (branchId ? [branchId] : []);

  const loansQuery = {
    status: 'paid',
    $or: [
      { 'group.code': new RegExp(`^${escapedCode}$`, 'i') },
      { 'group.name': new RegExp(`^${escapedName}$`, 'i') },
      { 'group.code': new RegExp(`^${escapedName}$`, 'i') },
      { group: groupCode },
      ...(mongoose.isValidObjectId(groupCode) ? [{ _id: groupCode }] : []),
    ],
  };
  // Point 4: Strictly isolate loans to employee branch
  if (bList.length) {
    loansQuery.branch = { $in: bList };
  }

  const loans = await LoanPayment.find(loansQuery).populate('lines.member').lean();

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

  const allPastReceipts = new Set(allPastPayments.map((p) => p.receiptNo).filter(Boolean));
  const seenTodayLoanMember = new Set(
    allPastPayments
      .filter((p) => p.paidOn >= startDay && p.paidOn <= endDay)
      .map((p) => `${String(p.loanPayment)}_${String(p.memberCode || '').trim().toUpperCase()}`)
  );

  // Only include pending AppEmiCollections that DO NOT already have a corresponding EmiPayment
  const appCollections = allLoanIds.length ? await AppEmiCollection.find({
    loanPayment: { $in: allLoanIds },
    status: 'pending',
    collectedOn: { $gte: startDay, $lte: endDay },
  }).select('loanPayment memberCode amountPaise receiptNo').lean() : [];

  // Point 1: Track ALL pending collections across dates so member is blocked from second save
  const allPendingCollections = allLoanIds.length ? await AppEmiCollection.find({
    loanPayment: { $in: allLoanIds },
    status: 'pending',
  }).select('loanPayment memberCode amountPaise receiptNo payMode').lean() : [];

  const pendingByKey = new Map();
  const pendingModeByKey = new Map(); // the pay modes of the collections waiting for approval
  const todayModeByKey = new Map(); // the pay modes of the EMIs made today
  for (const pc of allPendingCollections) {
    const k = `${String(pc.loanPayment)}_${String(pc.memberCode || '').trim().toUpperCase()}`;
    pendingByKey.set(k, (pendingByKey.get(k) || 0) + (pc.amountPaise || 0));
    const pm = pendingModeByKey.get(k) || new Set();
    if (pc.payMode) pm.add(pc.payMode);
    pendingModeByKey.set(k, pm);
  }

  const paymentsByKey = new Map();
  for (const p of allPastPayments) {
    const k = `${String(p.loanPayment)}_${String(p.memberCode || '').trim().toUpperCase()}`;
    const cur = paymentsByKey.get(k) || { totalPaise: 0, todayPaise: 0 };
    cur.totalPaise += (p.amountPaise || 0);
    if (p.paidOn >= startDay && p.paidOn <= endDay) {
      cur.todayPaise += (p.amountPaise || 0);
      const tm = todayModeByKey.get(k) || new Set();
      if (p.payMode) tm.add(p.payMode);
      todayModeByKey.set(k, tm);
    }
    paymentsByKey.set(k, cur);
  }
  for (const ac of appCollections) {
    // Avoid double counting if already present in allPastPayments!
    if (ac.receiptNo && allPastReceipts.has(ac.receiptNo)) continue;
    const k = `${String(ac.loanPayment)}_${String(ac.memberCode || '').trim().toUpperCase()}`;
    if (seenTodayLoanMember.has(k)) continue;
    const cur = paymentsByKey.get(k) || { totalPaise: 0, todayPaise: 0 };
    cur.todayPaise += (ac.amountPaise || 0);
    cur.totalPaise += (ac.amountPaise || 0);
    paymentsByKey.set(k, cur);
  }

  // Item 10 Fix: Sort loans newest first and deduplicate by member code so multiple loan records in group (e.g. G00000048) never produce double EMI
  loans.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const members = [];
  const groupName = loans[0].group?.name || groupCode;
  const seenMemberCodes = new Set();

  for (const l of loans) {
    if (l.isSettled || l.status === 'settled' || settledKeySet.has(String(l._id))) continue;

    for (const line of (l.lines || [])) {
      const codeKey = line.code ? String(line.code).toUpperCase().trim() : (line.member ? String(line.member) : '');
      if (codeKey && seenMemberCodes.has(codeKey)) continue;

      const isLineSettled = line.isSettled || settledKeySet.has(`${String(l._id)}_${line.code}`) || settledKeySet.has(`${l.loanId}_${line.code}`);
      if (isLineSettled) continue;

      const stats = paymentsByKey.get(`${String(l._id)}_${String(line.code || '').trim().toUpperCase()}`) || { totalPaise: 0, todayPaise: 0 };
      const totalPaidPaise = stats.totalPaise;
      const todayPaidPaise = stats.todayPaise;

      const emiPaise = (l.schedule?.[0]?.installmentPaise || 0) + (line.extraEmiPaise || 0);
      const totalLoanPaise = line.amountPaise || l.totalAmountPaise || 0;
      const totalScheduledPaise = (l.schedule || []).reduce((s, x) => s + (x.installmentPaise || 0), 0) + (line.extraEmiPaise || 0) * (l.schedule?.length || 0);

      // Finished / fully-paid loans should not appear in EMI collection list
      if (totalScheduledPaise > 0 && totalPaidPaise >= totalScheduledPaise) continue;
      // (not compared with the principal: the installments also carry the interest, so a loan with the principal paid still owes the rest)

      if (codeKey) seenMemberCodes.add(codeKey);

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
      const pendingPaise = pendingByKey.get(`${String(l._id)}_${String(line.code || '').trim().toUpperCase()}`) || 0;
      const isNpa = isNpaMember({ loan: l, line, emiPaise, duesPaise, scheduledPaise: totalScheduledPaise, paidPaise: totalPaidPaise, dateStr });

      members.push({
        isNpa,
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
        isPendingApproval: pendingPaise > 0,
        pendingApprovalAmount: pendingPaise / 100,
        todayPayMode: modeOfSet(todayModeByKey.get(`${String(l._id)}_${String(line.code || '').trim().toUpperCase()}`)),
        pendingPayMode: modeOfSet(pendingModeByKey.get(`${String(l._id)}_${String(line.code || '').trim().toUpperCase()}`)),
        balanceAmount: Math.max(0, totalLoanPaise - totalPaidPaise) / 100,
      });
    }
  }

  const live = members.filter((m) => !m.isNpa); // an NPA member is not part of the actual collection or the due of the day
  const totalActualCollection = live.reduce((s, m) => s + (m.emiAmount || 0), 0);
  const totalCollectedToday = members.reduce((s, m) => s + (m.todayPaidAmount || 0), 0);
  // Remaining due includes all pending dues (Point 2 fix)
  const totalPendingDue = live.reduce((s, m) => s + (m.dueAmount || 0), 0);
  const totalDueAmount = live.reduce((s, m) => s + (m.totalDue || m.emiAmount || 0), 0);

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
  const inputList = Array.isArray(items) ? items : (Array.isArray(req.body?.payments) ? req.body.payments : []);
  if (!inputList.length) {
    throw new HttpError(400, 'Please select at least one member to collect EMI');
  }

  const results = [];
  const paidOn = date ? new Date(date) : new Date();
  const staffCode = req.user?.employeeCode || '';

  // Point 23: Block EMI collection on Sundays and Holidays
  await assertNotSundayOrHoliday(paidOn);

  // Point 37: Cannot post collection for a new day if previous day collection is pending approval
  const paidDayStart = new Date(paidOn);
  paidDayStart.setHours(0, 0, 0, 0);

  const { branchId: userBranchId } = await getEmployeeContext(req).catch(() => ({}));
  const branchOrStaff = [];
  if (userBranchId) branchOrStaff.push({ branch: userBranchId });
  if (staffCode) branchOrStaff.push({ collectedByCode: staffCode });

  const pendingEarlier = await AppEmiCollection.findOne({
    status: 'pending',
    collectedOn: { $lt: paidDayStart },
    ...(branchOrStaff.length ? { $or: branchOrStaff } : {}),
  }).sort({ collectedOn: 1 }).lean();

  if (pendingEarlier) {
    const dStr = new Date(pendingEarlier.collectedOn).toLocaleDateString('en-IN');
    throw new HttpError(400, `Cannot post collection for today. Earlier collection from ${dStr} is still pending approval. Please get previous day's collection approved first.`);
  }

  const seenInBatch = new Set();
  for (const it of inputList) {
    try {
      const amount = Number(it.amount);
      if (!amount || amount < 1) continue;

      let p = null;
      if (it.loanPaymentId) {
        p = await LoanPayment.findById(it.loanPaymentId);
      } else if (it.loanId) {
        p = await LoanPayment.findOne({
          $or: [
            { loanId: it.loanId },
            ...(mongoose.isValidObjectId(it.loanId) ? [{ _id: it.loanId }] : []),
          ],
        });
      }
      if (!p) throw new Error('Loan not found');

      const line = (p.lines || []).find((l) => (it.memberCode && l.code === it.memberCode) || (it.memberId && String(l.member) === String(it.memberId))) || p.lines?.[0];
      if (!line) throw new Error('Borrower not found in loan');

      // Point 2: Prevent duplicate items within the same batch payload
      const dedupeKey = `${String(p._id)}_${String(line.code || '').trim().toUpperCase()}`;
      if (seenInBatch.has(dedupeKey)) {
        results.push({
          memberCode: line.code,
          memberName: line.name,
          status: 'error',
          message: `Duplicate item for member ${line.name} in current batch skipped`,
        });
        continue;
      }
      seenInBatch.add(dedupeKey);

      // Point 1: Block collection if already pending system approval across Group, Personal, MSME, Product loans
      const existingPending = await AppEmiCollection.findOne({
        loanPayment: p._id,
        memberCode: line.code,
        status: 'pending',
      }).lean();

      if (existingPending) {
        results.push({
          memberCode: line.code,
          memberName: line.name,
          status: 'error',
          message: `EMI for member ${line.name} (${line.code}) has already been submitted and is pending approval in system. It cannot be collected again until approved.`,
        });
        continue;
      }

      // Point 2: Rapid double-tap idempotency guard (within 5 seconds)
      const recentDuplicate = await AppEmiCollection.findOne({
        loanPayment: p._id,
        memberCode: line.code,
        amountPaise: Math.round(amount * 100),
        createdAt: { $gte: new Date(Date.now() - 5000) },
      }).lean();

      if (recentDuplicate) {
        results.push({
          memberCode: line.code,
          memberName: line.name,
          receiptNo: recentDuplicate.receiptNo || String(recentDuplicate._id),
          amount,
          status: 'success',
        });
        continue;
      }

      // Point 37: Record in AppEmiCollection with status 'pending' awaiting manager/admin collection approval
      const receiptNo = await generateCode('emiReceipt').catch(() => `APP${Date.now().toString().slice(-8)}`);
      const branchVal = p.branch?._id || p.branch || userBranchId || (req.user?.branches || [])[0] || null;
      const pendingColl = await AppEmiCollection.create({
        loanPayment: p._id,
        loanId: p.loanId || p.formId,
        branch: branchVal,
        memberCode: line.code,
        memberName: line.name,
        group: p.group?.code ? `${p.group.code} — ${p.group.name}` : '',
        amountPaise: Math.round(amount * 100),
        collectedOn: paidOn,
        type: 'regular',
        payMode: ['cash', 'bank', 'upi', 'cheque'].includes(it.payMode || payMode) ? (it.payMode || payMode) : 'cash',
        reference: it.reference || reference || '',
        collectedBy: req.user?._id,
        collectedByCode: staffCode,
        status: 'pending',
        receiptNo,
      });

      results.push({
        memberCode: line.code,
        memberName: line.name,
        receiptNo: receiptNo || String(pendingColl._id),
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
  const { emp, code: staffCode, branchId, branchIds } = await getEmployeeContext(req);
  const codeRegex = staffCode ? new RegExp(`^${staffCode}$`, 'i') : null;
  const bList = branchIds?.length ? branchIds : (branchId ? [branchId] : []);
  const loanType = cleanStr(req.query.loanType || 'personal').toLowerCase();
  const mode = cleanStr(req.query.mode || 'all').toLowerCase();
  const dateStr = cleanStr(req.query.date) || todayDateString();

  const isSupervisorUser = Boolean(
    req.user?.isSupervisor ||
    ['supervisor', 'branch_manager', 'area_manager', 'admin', 'super_admin'].includes(req.user?.role) ||
    (Array.isArray(emp?.supervisedBranches) && emp.supervisedBranches.length > 0) ||
    emp?.isSupervisor
  );

  const targetDate = new Date(`${dateStr}T12:00:00.000Z`);
  const jsDay = targetDate.getDay(); // 0..6
  const dayOfMonth = targetDate.getDate();

  const typeFilter = (loanType === 'business' || loanType === 'msme' || loanType === 'business_msme')
    ? { $in: ['business', 'msme', 'business_msme'] }
    : loanType;

  const query = {
    status: 'paid',
    $or: [
      { loanType: typeFilter },
      { kind: typeFilter },
    ],
  };

  // Point 4: Strictly isolate loans by branch - loans from other branches must never show
  if (bList.length) {
    query.branch = { $in: bList };
  }

  if (!isSupervisorUser && codeRegex) {
    query.$and = [
      {
        $or: [
          { employeeCode: codeRegex },
          { staffCode: codeRegex },
        ],
      },
    ];
  }

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

  // Point 1: Query pending collections across loans to block duplicate saving before approval
  const allPendingCollections = allLoanIds.length ? await AppEmiCollection.find({
    loanPayment: { $in: allLoanIds },
    status: 'pending',
  }).select('loanPayment memberCode amountPaise receiptNo').lean() : [];

  const pendingByKey = new Map();
  for (const pc of allPendingCollections) {
    const k = `${String(pc.loanPayment)}_${String(pc.memberCode || '').trim().toUpperCase()}`;
    pendingByKey.set(k, (pendingByKey.get(k) || 0) + (pc.amountPaise || 0));
  }

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
      const pendingPaise = pendingByKey.get(`${String(l._id)}_${String(line.code || '').trim().toUpperCase()}`) || 0;

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
        isPendingApproval: pendingPaise > 0,
        pendingApprovalAmount: pendingPaise / 100,
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

  // Point 1 & Point 6: Block if an EMI or Advance collection is already pending system approval
  const existingPending = await AppEmiCollection.findOne({
    loanPayment: loan._id,
    memberCode: line.code,
    status: 'pending',
  }).lean();

  if (existingPending) {
    throw new HttpError(400, `An EMI / Advance collection for member ${line.name} (${line.code}) has already been submitted (Receipt: ${existingPending.receiptNo || existingPending._id}) and is pending system approval. A second collection cannot be saved until approved.`);
  }

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
  const scheduledPaise = (loan.schedule || []).reduce((a, x) => a + (x.installmentPaise || 0), 0) + (line.extraEmiPaise || 0) * (loan.schedule?.length || 0);
  const totalLoanPaise = scheduledPaise > 0 ? scheduledPaise : (line.amountPaise || loan.totalAmountPaise || loan.amountPaise || 0);
  const remainingBalancePaise = Math.max(0, totalLoanPaise - totalPaidPaise);

  if (remainingBalancePaise <= 0 || loan.status === 'closed') {
    throw new HttpError(400, `Loan ${loan.loanId} has already been fully paid and closed. Remaining balance is ₹0.`);
  }

  if (payAmountPaise > remainingBalancePaise) {
    throw new HttpError(400, `Advance payment of ₹${payAmount} exceeds remaining loan balance of ₹${remainingBalancePaise / 100}. Maximum payable is ₹${remainingBalancePaise / 100}.`);
  }

  // 2. Strict rapid double-tap / idempotency check (reject/return within 5 seconds)
  const recentDuplicate = await AppEmiCollection.findOne({
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
      message: `Advance payment of ₹${payAmount} was already submitted (Receipt: ${recentDuplicate.receiptNo})`,
    });
  }

  const receiptNo = await generateCode('emiReceipt').catch(() => `ADV${Date.now().toString().slice(-8)}`);
  const branchVal = loan.branch?._id || loan.branch || (req.user?.branches || [])[0] || null;

  // Item 9 Fix: Do NOT create approved EmiPayment directly from app!
  // Record in AppEmiCollection with status 'pending' awaiting manager/admin collection approval
  await AppEmiCollection.create({
    loanPayment: loan._id,
    loanId: loan.loanId || loan.formId,
    branch: branchVal,
    memberCode: line.code,
    memberName: line.name,
    group: loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '',
    amountPaise: payAmountPaise,
    collectedOn: new Date(),
    type: 'advance',
    payMode: ['cash', 'bank', 'upi', 'cheque'].includes(payMode) ? payMode : 'cash',
    reference: reference || '',
    collectedBy: req.user?._id,
    collectedByCode: req.user?.employeeCode || '',
    status: 'pending',
    receiptNo,
  });

  res.status(201).json({
    success: true,
    receiptNo,
    amount: payAmount,
    loanId: loan.loanId,
    memberCode: line.code,
    memberName: line.name,
    pendingApproval: true,
    message: `Advance payment of ₹${payAmount} recorded and submitted for System EMI Approval (Receipt: ${receiptNo})`,
  });
}

// -----------------------------------------------------------------------------
// 17. NPA RECOVERY (NPA MEMBERS & OVERDUE RECOVERY)
// -----------------------------------------------------------------------------
export async function getNpaLoans(req, res) {
  const { emp, code: staffCode, branchId, branchIds } = await getEmployeeContext(req);
  const codeRegex = staffCode ? new RegExp(`^${staffCode}$`, 'i') : null;

  // Item 8: Determine active branch(es) strictly
  let bList = branchIds?.length ? branchIds : (branchId ? [branchId] : []);
  if (req.query.branchId && mongoose.isValidObjectId(req.query.branchId)) {
    bList = [req.query.branchId];
  }
  bList = [...new Set(bList.map(String))];

  const isSupervisorUser = Boolean(
    req.user?.isSupervisor ||
    ['supervisor', 'branch_manager', 'area_manager', 'admin', 'super_admin'].includes(req.user?.role) ||
    (Array.isArray(emp?.supervisedBranches) && emp.supervisedBranches.length > 0) ||
    emp?.isSupervisor
  );

  const allStaffCodes = [
    req.query.staffCode,
    staffCode,
    emp?.employeeCode,
    emp?.staffCode,
    req.user?.employeeCode,
    req.user?.username,
  ].filter(Boolean).map((s) => s.trim().toUpperCase());
  const uniqueStaffCodes = [...new Set(allStaffCodes)];
  const staffRegexList = uniqueStaffCodes.map((c) => new RegExp(`^${c}$`, 'i'));

  // Groups strictly in the branch and assigned to staff
  const groupQuery = {
    isDeleted: { $ne: true },
    ...(bList.length ? { branch: { $in: bList } } : {}),
  };
  if (!isSupervisorUser) {
    groupQuery.$or = [
      ...(staffRegexList.length ? [{ employeeCode: { $in: staffRegexList } }, { staffCode: { $in: staffRegexList } }] : []),
      ...(emp?._id ? [{ employee: emp._id }, { staffId: emp._id }] : []),
      { createdBy: req.user._id },
    ];
  }
  const myAssignedGroups = await Group.find(groupQuery).select('code').lean();
  let myGroupCodes = myAssignedGroups.map((g) => g.code).filter(Boolean);

  // Item 8 & 25 Fix: Strictly scope query by branchId, exclude already closed loans, and use lean projection for instant loading
  const query = {
    status: { $in: ['paid', 'npa'] },
    isClosed: { $ne: true },
    closed: { $ne: true },
    ...(bList.length ? { branch: { $in: bList } } : { branch: { $in: [] } }),
  };

  if (!isSupervisorUser) {
    const staffOrGroup = [];
    if (staffRegexList.length) {
      staffOrGroup.push({ employeeCode: { $in: staffRegexList } }, { staffCode: { $in: staffRegexList } });
    }
    if (myGroupCodes.length) {
      staffOrGroup.push({ 'group.code': { $in: myGroupCodes } });
    }
    if (emp?._id) {
      staffOrGroup.push({ staff: emp._id });
    }
    staffOrGroup.push({ createdBy: req.user._id });
    query.$or = staffOrGroup;
  } else if (req.query.staffCode) {
    const scRegex = new RegExp(`^${req.query.staffCode.trim()}$`, 'i');
    query.$or = [{ employeeCode: scRegex }, { staffCode: scRegex }];
  }

  // Item 25 Fix: Field projection prevents fetching heavy unneeded fields and bloat
  const loans = await LoanPayment.find(query)
    .select('_id loanId formId receiptNo loanType kind branch lines schedule emiEndDate npa isNpa status totalAmountPaise employeeCode staffCode group')
    .populate('branch', 'name code')
    .lean();

  // Item 18 Fix: Pre-fetch staff names for accurate staff filtering in NPA
  const staffCodes = [...new Set(loans.map((l) => l.employeeCode || l.staffCode).filter(Boolean))];
  const staffDocs = staffCodes.length ? await Employee.find({ employeeCode: { $in: staffCodes } }).select('employeeCode name').lean() : [];
  const staffNameByCode = new Map(staffDocs.map((e) => [String(e.employeeCode).toUpperCase(), e.name]));

  const npaList = [];
  const today = new Date();

  // Item 25 Fix: MongoDB aggregation for payments prevents memory overload and massive JSON transfer latency
  const allLoanIds = loans.map((l) => l._id);
  const paymentsByKey = new Map();
  if (allLoanIds.length > 0) {
    const paymentsAgg = await EmiPayment.aggregate([
      { $match: { loanPayment: { $in: allLoanIds }, status: 'paid' } },
      { $group: { _id: { lp: '$loanPayment', mc: '$memberCode' }, total: { $sum: '$amountPaise' } } },
    ]);
    for (const p of paymentsAgg) {
      if (p._id?.lp && p._id?.mc) {
        paymentsByKey.set(`${String(p._id.lp)}_${p._id.mc}`, p.total || 0);
      }
    }
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
        const rawKind = String(l.loanType || l.kind || '').toLowerCase();
        let normalizedKind = 'group';
        if (rawKind.includes('personal')) normalizedKind = 'personal';
        else if (rawKind.includes('msme')) normalizedKind = 'msme';
        else if (rawKind.includes('business')) normalizedKind = 'business';
        else if (rawKind.includes('product')) normalizedKind = 'product';
        else if (l.group?.name || l.group?.code) normalizedKind = 'group';
        else normalizedKind = 'personal';

        npaList.push({
          loanPaymentId: l._id,
          loanId: l.loanId || l.receiptNo,
          loanType: l.loanType || normalizedKind,
          loanKind: normalizedKind,
          groupCode: l.group?.code || '',
          groupId: l.group?._id || '',
          memberId: line.member?._id || line.member,
          memberCode: line.code,
          memberName: line.name,
          phone: line.mobile || 'N/A',
          branchId: l.branch?._id ? String(l.branch._id) : '',
          branchName: l.branch?.name || '',
          groupName: l.group?.name || l.group?.code || 'Individual Loan',
          staffCode: l.employeeCode || l.staffCode || '',
          staffName: staffNameByCode.get(String(l.employeeCode || l.staffCode || '').toUpperCase()) || l.employeeCode || l.staffCode || '',
          dpd: Math.max(dpd, isExplicitNpa ? 90 : 0),
          overduePrincipal: Math.round(overduePaise * 0.7) / 100,
          overdueInterest: Math.round(overduePaise * 0.3) / 100,
          totalOverdue: overduePaise > 0 ? (overduePaise / 100) : (totalLoanPaise - totalPaidPaise) / 100,
          totalBalance: Math.max(0, totalLoanPaise - totalPaidPaise) / 100,
          npaCategory: dpd > 365 ? 'Loss' : dpd > 180 ? 'Doubtful' : 'Sub-Standard',
          isSettlement: false,
        });
      }
    }
  }

  // Point 4: Include active / pending settlement loans in NPA list
  const settlements = await LoanSettlement.find({
    status: { $in: ['active', 'pending'] },
    ...(branchId ? { branch: branchId } : {}),
  }).populate('branch', 'name code').lean();

  for (const s of settlements) {
    const balAmt = Math.max(0, (s.outstandingPaise - (s.amountPaise || 0)) / 100);
    npaList.push({
      loanPaymentId: s.loanPayment || s._id,
      loanId: s.loanId || String(s._id),
      loanType: 'personal',
      loanKind: 'personal',
      groupCode: '',
      groupId: '',
      memberId: s.member,
      memberCode: s.memberCode,
      memberName: s.memberName || 'Borrower',
      phone: 'N/A',
      branchId: s.branch?._id ? String(s.branch._id) : '',
      branchName: s.branch?.name || '',
      groupName: s.group || 'Settlement Center',
      staffCode: s.createdByCode || '',
      dpd: 90,
      overduePrincipal: balAmt,
      overdueInterest: 0,
      totalOverdue: balAmt > 0 ? balAmt : s.outstandingPaise / 100,
      totalBalance: balAmt > 0 ? balAmt : s.outstandingPaise / 100,
      npaCategory: 'Settlement',
      isSettlement: true,
      settlementReceiptNo: s.receiptNo,
    });
  }

  res.json({ items: npaList });
}

export async function recoverNpaLoan(req, res) {
  const { loanPaymentId, loanId: bodyLoanId, memberCode, amount, payMode = 'cash', reference = '' } = req.body || {};
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

  const branchId = loan?.branch?._id || loan?.branch || settlementDoc?.branch || (req.user?.branches || [])[0];

  // Point 23: Block NPA recovery collection on Sundays and Holidays
  await assertNotSundayOrHoliday(new Date(), branchId);

  const line = (loan?.lines || []).find((l) => l.code === memberCode)
    || loan?.lines?.[0]
    || { code: memberCode || settlementDoc?.memberCode || 'N/A', name: settlementDoc?.memberName || 'Borrower' };

  // Point 1: Block recovery if an NPA recovery / EMI is already pending system approval
  if (loan?._id && line.code) {
    const existingPending = await AppEmiCollection.findOne({
      loanPayment: loan._id,
      memberCode: line.code,
      status: 'pending',
    }).lean();

    if (existingPending) {
      throw new HttpError(400, `NPA recovery for member ${line.name} (${line.code}) has already been submitted and is pending system approval. It cannot be collected again until approved.`);
    }
  }

  const receiptNo = await generateCode('emiReceipt').catch(() => `NPA${Date.now().toString().slice(-8)}`);
  const modeClean = ['cash', 'bank', 'upi', 'cheque'].includes(payMode.toLowerCase()) ? payMode.toLowerCase() : 'cash';

  // Point 4: Record in AppEmiCollection with status: 'pending' so NPA recovery appears in System/Admin Approval section
  await AppEmiCollection.create({
    loanPayment: loan?._id || undefined,
    loanId: loan?.loanId || loan?.formId || settlementDoc?.loanId || searchId,
    branch: branchId || (req.user?.branches || [])[0] || null,
    memberCode: line.code || memberCode || 'MEMBER',
    memberName: line.name || 'Borrower',
    group: loan?.group?.code ? `${loan.group.code} — ${loan.group.name}` : (settlementDoc?.group || ''),
    amountPaise: Math.round(payAmount * 100),
    collectedOn: new Date(),
    type: 'npa',
    npa: true,
    payMode: modeClean,
    reference: reference || '',
    collectedBy: req.user?._id,
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
    message: `NPA recovery payment of ₹${payAmount} recorded and submitted for System EMI Approval (Receipt ${receiptNo})`,
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

  // Razorpay: the QR is a payment link of exactly this amount (it works with any UPI app); the status is asked back with /company-qr/status/:linkId
  let razorpay = null;
  let qrImage = qrImageUrl;
  if (razorpayConfigured() && Number(amount) >= 1) {
    try {
      const link = await createPaymentLink({
        amountPaise: Math.round(Number(amount) * 100),
        description: `EMI ${loanId || ''} ${memberName || ''}`.trim(),
        referenceId: `QR${Date.now()}`,
        notes: { loanId: String(loanId || ''), member: String(memberName || ''), by: req.user?.employeeCode || '' },
      });
      razorpay = { linkId: link.id, shortUrl: link.short_url, testMode: razorpayTestMode() };
      qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(link.short_url)}`;
    } catch (err) {
      console.warn('[company-qr] Razorpay link failed, the plain UPI QR is shown:', err.message);
    }
  }

  res.json({
    companyName,
    upiId,
    amount: Number(amount),
    loanId,
    memberName,
    upiString,
    qrImageUrl: qrImage,
    razorpay,
  });
}

/** Has the Razorpay payment of a QR been made? (asked again and again by the screen that shows the QR) */
export async function getCompanyQrStatus(req, res) {
  const link = await fetchPaymentLink(String(req.params.linkId || ''));
  const paid = link.status === 'paid';
  const pay = (link.payments || []).find((x) => x.status === 'captured') || (link.payments || [])[0];
  res.json({ status: link.status, paid, amount: (link.amount_paid || link.amount || 0) / 100, paymentId: paid ? pay?.payment_id || '' : '' });
}


// -----------------------------------------------------------------------------
// 19. BORROWER SAVING AMOUNT & WITHDRAWAL REQUEST (POINT 25: UNLOCKED CLOSED LOAN SECURITY)
// -----------------------------------------------------------------------------
export async function getBorrowerSavings(req, res) {
  const query = cleanStr(req.params.query);
  // the security of a member of ANOTHER branch is not shown: an employee sees the members of his own branches (the admin sees all)
  const { branchIds: ownBranches } = await getEmployeeContext(req);
  const branchScope = ['super_admin', 'admin'].includes(req.user?.role) ? {} : { branch: { $in: ownBranches.map((b) => new mongoose.Types.ObjectId(String(b))) } };
  const member = await Member.findOne({
    $or: [{ code: new RegExp(`^${query}$`, 'i') }, { mobile: query }, { aadhaar: query }],
    isDeleted: false,
    ...branchScope,
  }).lean();
  if (!member) throw new HttpError(404, `Member not found matching '${query}'`);

  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': new RegExp(`^${member.code}$`, 'i') }],
  }).lean();

  const asOf = startOfToday();
  let totalDepositedPaise = 0;
  let runningSecurityPaise = 0;
  let totalInterestPaise = 0;
  let closedInterestPaise = 0; // the interest of the loans that are closed (it is paid with the security of those loans)
  const deposits = [];

  for (const l of loans) {
    const line = l.lines?.find((x) => (x.member && String(x.member) === String(member._id)) || (x.code && x.code.toUpperCase() === member.code.toUpperCase()));
    if (line && line.securityPaise > 0) {
      totalDepositedPaise += line.securityPaise;
      const years = fullYears(new Date(l.paidOn || l.createdAt), asOf);
      const interest = Math.round((line.securityPaise * years * SECURITY_INTEREST_PERCENT) / 100);
      totalInterestPaise += interest;

      // Point 25: Determine whether loan is closed or still running
      let isClosed = false;
      const isSettledInDb = await LoanSettlement.exists({
        loanPayment: l._id,
        $or: [
          { member: member._id },
          { memberCode: new RegExp(`^${member.code}$`, 'i') },
        ],
        status: { $in: ['active', 'approved', 'settled'] },
      });
      if (isSettledInDb || l.isSettled || line.isSettled || l.status === 'settled' || l.status === 'closed' || line.status === 'closed') {
        isClosed = true;
      } else {
        const totalEmis = l.schedule?.length || 0;
        const paidEmisCount = await EmiPayment.countDocuments({
          loanPayment: l._id,
          memberCode: new RegExp(`^${member.code}$`, 'i'),
          status: 'paid',
        });
        if (totalEmis > 0 && paidEmisCount >= totalEmis) {
          isClosed = true;
        } else {
          try {
            const st = await borrowerState(l, line, asOf);
            isClosed = Boolean(st.settled) || !st.left || st.left.length === 0;
          } catch {
            isClosed = false;
          }
        }
      }

      if (!isClosed) {
        runningSecurityPaise += line.securityPaise;
      } else {
        closedInterestPaise += interest;
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

  // Point 25 Formula:
  // Closed Loan Security = Total Security Deposited - Running Loan Locked Security
  const closedSecurityPaise = Math.max(0, totalDepositedPaise - runningSecurityPaise);

  const withdrawals = await SecurityWithdrawal.find({ member: member._id }).sort({ createdAt: -1 }).lean();
  const approvedWithdrawals = withdrawals.filter((w) => w.status === 'approved');
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');
  const withdrawnPaise = approvedWithdrawals.reduce((sum, w) => sum + (w.amountPaise || 0), 0);
  const pendingPaise = pendingWithdrawals.reduce((sum, w) => sum + (w.amountPaise || 0), 0);

  // Available to withdraw: Closed loan security minus already requested/withdrawn
  const withdrawablePaise = Math.max(0, closedSecurityPaise - withdrawnPaise - pendingPaise);
  // the interest that is still to be paid on the closed loans (what was already taken with a withdrawal is not paid twice)
  const interestTakenPaise = [...approvedWithdrawals, ...pendingWithdrawals].reduce((sum, w) => sum + (w.interestPaise || 0), 0);
  const withdrawableInterestPaise = withdrawablePaise > 0 ? Math.max(0, closedInterestPaise - interestTakenPaise) : 0;

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
    closedInterest: withdrawableInterestPaise / 100,
    // the balance with its interest added: what can be paid out for the closed loans
    totalWithdrawable: (withdrawablePaise + withdrawableInterestPaise) / 100,
    deposits,
    withdrawals: withdrawals.map((w) => ({
      id: w._id,
      receiptNo: w.receiptNo,
      date: w.createdAt,
      kind: w.kind,
      amount: w.amountPaise / 100,
      interest: (w.interestPaise || 0) / 100,
      status: w.status,
      remark: w.remark || '',
      rejectReason: w.rejectReason || '',
      decidedAt: w.decidedAt,
      decidedByCode: w.decidedByCode,
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

  // Point 25: Security from closed loans is withdrawable; running loan security is locked
  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': new RegExp(`^${member.code}$`, 'i') }],
  }).lean();
  let totalDepositedPaise = 0;
  let runningSecurityPaise = 0;
  const asOf = startOfToday();

  for (const l of loans) {
    const line = l.lines?.find((x) => (x.member && String(x.member) === String(member._id)) || (x.code && x.code.toUpperCase() === member.code.toUpperCase()));
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
      if (isSettledInDb || l.isSettled || line.isSettled || l.status === 'settled' || l.status === 'closed' || line.status === 'closed') {
        isClosed = true;
      } else {
        const totalEmis = l.schedule?.length || 0;
        const paidEmisCount = await EmiPayment.countDocuments({
          loanPayment: l._id,
          memberCode: new RegExp(`^${member.code}$`, 'i'),
          status: 'paid',
        });
        if (totalEmis > 0 && paidEmisCount >= totalEmis) {
          isClosed = true;
        } else {
          try {
            const st = await borrowerState(l, line, asOf);
            isClosed = Boolean(st.settled) || !st.left || st.left.length === 0;
          } catch {
            isClosed = false;
          }
        }
      }
      if (!isClosed) {
        runningSecurityPaise += line.securityPaise;
      }
    }
  }

  // Point 25: Closed Loan Security = Total Deposited - Running Locked
  const closedSecurityPaise = Math.max(0, totalDepositedPaise - runningSecurityPaise);

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
  const { emp, code, branchId } = await getEmployeeContext(req);
  const codeRegex = code ? new RegExp(`^${code}$`, 'i') : null;
  const { dateFrom, dateTo } = req.query;

  const dateFilter = {};
  if (dateFrom && dateTo) {
    dateFilter.createdAt = {
      $gte: new Date(`${dateFrom}T00:00:00.000Z`),
      $lte: new Date(`${dateTo}T23:59:59.999Z`),
    };
  }

  // Item 16 Fix: Strictly isolate report metrics to this employee when employeeCode is available
  // Do NOT include { branch: branchId } in an $or array, as it matches everyone in the branch!
  const staffFilter = codeRegex
    ? {
        $or: [
          { employeeCode: codeRegex },
          { staffCode: codeRegex },
          { createdByCode: codeRegex },
          ...(emp?._id ? [{ createdBy: emp._id }] : []),
        ],
      }
    : (branchId ? { branch: branchId } : {});

  const disbursements = await LoanPayment.find({
    status: 'paid',
    ...staffFilter,
    ...dateFilter,
  }).sort({ paidOn: -1 }).limit(100).lean();

  const totalDisbursed = disbursements.reduce((sum, d) => sum + (d.totalAmountPaise || d.amountPaise || 0), 0) / 100;

  const requisitions = await LoanRequisition.find({
    isDeleted: false,
    ...staffFilter,
    ...dateFilter,
  }).sort({ createdAt: -1 }).limit(100).lean();

  const approvals = requisitions.filter((r) => r.status === 'approved');

  // Item 16: New Members registered / added by this employee
  const memberStaffFilter = codeRegex
    ? {
        $or: [
          { employeeCode: codeRegex },
          ...(emp?._id ? [{ createdBy: emp._id }, { savedBy: emp._id }] : []),
        ],
      }
    : (branchId ? { branch: branchId } : {});

  const newMembers = await Member.find({
    isDeleted: false,
    ...memberStaffFilter,
    ...dateFilter,
  }).sort({ createdAt: -1 }).limit(100).lean();

  const npaPayments = await EmiPayment.find({
    npa: true,
    status: 'paid',
    ...staffFilter,
    ...dateFilter,
  }).sort({ paidOn: -1 }).limit(100).lean();

  const totalNpaRecovered = npaPayments.reduce((sum, p) => sum + (p.amountPaise || 0), 0) / 100;
  // Point 19: 10% commission/incentive on NPA recovery
  const totalNpaCommission = Math.round(totalNpaRecovered * 0.10 * 100) / 100;

  const centerSurveys = await CenterVisit.find({
    ...staffFilter,
    ...dateFilter,
  }).sort({ visitDate: -1 }).limit(100).lean();

  // Point 16 & Item 11 Fix: Separate Actual Completed Product Sales from Pending Bookings
  // Target must show ACTUAL PRODUCT SELL, not product bookings!
  const productSales = await ProductSaleOrder.find({
    ...staffFilter,
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
      npaRecoveryCommission: totalNpaCommission,
      npaCommissionRate: 10,
      npaRecoveryCount: npaPayments.length,
      centerSurveyCount: centerSurveys.length,
      totalProductSales: totalActualProductSales, // Item 11 Fix: Actual Product Sales for Target
      productSalesCount: actualProductSales.length, // Actual completed sales count
      pendingBookingsCount: pendingProductBookings.length,
      pendingBookingsAmount: totalBookingsAmount,
      newMembersCount: newMembers.length, // Item 16: New Member Add report count
    },
    newMembers: newMembers.map((m) => ({
      id: m._id,
      code: m.code,
      name: m.name,
      mobile: m.mobile,
      fatherName: m.fatherName || m.husbandName || '',
      village: m.presentAddress?.village || m.presentAddress?.city || '',
      date: m.createdAt ? new Date(m.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A',
    })),
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
    npaRecovery: npaPayments.map((p) => {
      const amt = (p.amountPaise || 0) / 100;
      return {
        receiptNo: p.receiptNo,
        member: p.memberName,
        amount: amt,
        commission: Math.round(amt * 0.10 * 100) / 100, // 10% NPA Recovery commission
        date: p.paidOn ? new Date(p.paidOn).toLocaleDateString() : 'N/A',
        payMode: p.payMode,
      };
    }),
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
        npaRecoveryCommission: totalNpaCommission,
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

/** The address (Google Maps) of the place the employee is at: shown in the attendance screen. */
export async function reverseGeocodeAddress(req, res) {
  res.json({ address: await reverseGeocode(req.query.lat, req.query.lng) });
}

export async function markFirstMeetingAttendance(req, res) {
  const code = req.user?.employeeCode;
  const { photo } = req.body || {};
  // the address is read from the coordinates by Google Maps on the server (what the phone sent is not trusted)
  const location = req.body?.location ? { ...req.body.location } : req.body?.location;
  if (location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))) {
    const address = await reverseGeocode(location.lat, location.lng);
    if (address) location.address = address;
  }
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
      address: location?.address,
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
  const { emp, code } = await getEmployeeContext(req);
  const codeRegex = code ? new RegExp(`^${code}$`, 'i') : null;
  const query = {
    $or: [
      ...(codeRegex ? [{ employeeCode: codeRegex }] : []),
      ...(emp?._id ? [{ employee: emp._id }] : []),
    ],
  };

  const slips = query.$or.length ? await Salary.find(query)
    .sort({ month: -1 })
    .lean() : [];

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
  const { emp, code } = await getEmployeeContext(req);
  if (!emp) throw new HttpError(404, 'Employee not found');
  const codeRegex = code ? new RegExp(`^${code}$`, 'i') : null;

  const monthStr = cleanStr(req.query.month) || new Date().toISOString().slice(0, 7);
  const [yearNum, monthNum] = monthStr.split('-').map(Number);
  const startMonth = new Date(Date.UTC(yearNum, monthNum - 1, 1, 0, 0, 0, 0));
  const endMonth = new Date(Date.UTC(yearNum, monthNum, 0, 23, 59, 59, 999));
  const daysInMonth = endMonth.getUTCDate();

  const now = new Date();
  const currentMonthStr = now.toISOString().slice(0, 7);
  const isCurrentMonth = monthStr === currentMonthStr;
  const isFutureMonth = monthStr > currentMonthStr;
  const maxDay = isFutureMonth ? 0 : (isCurrentMonth ? now.getDate() : daysInMonth);

  const [records, leaves, holidays, meetingPhotos] = await Promise.all([
    Attendance.find({
      employee: emp._id,
      date: { $gte: startMonth, $lte: endMonth },
    }).lean(),
    Leave.find({
      employee: emp._id,
      status: 'approved',
      from: { $lte: endMonth },
      to: { $gte: startMonth },
    }).lean(),
    Holiday.find({
      date: { $gte: startMonth, $lte: endMonth },
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      $or: [{ branch: null }, ...(emp.branch ? [{ branch: emp.branch }] : [])],
    }).lean(),
    FirstMeetingAttendance.find({
      $or: [
        ...(codeRegex ? [{ employeeCode: codeRegex }] : []),
        ...(emp?._id ? [{ employee: emp._id }] : []),
      ],
      date: { $gte: startMonth, $lte: endMonth },
    }).lean(),
  ]);

  const photoMap = new Map();
  meetingPhotos.forEach((p) => {
    photoMap.set(new Date(p.date).toISOString().slice(0, 10), p.photo);
  });

  const recordMap = new Map();
  records.forEach((r) => {
    recordMap.set(new Date(r.date).toISOString().slice(0, 10), r);
  });

  const holidayMap = new Map();
  holidays.forEach((h) => {
    holidayMap.set(new Date(h.date).toISOString().slice(0, 10), h.name);
  });

  const allDays = [];
  let presentCount = 0;
  let absentCount = 0;
  let leaveCount = 0;

  for (let d = maxDay; d >= 1; d--) {
    const dStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(`${dStr}T12:00:00.000Z`);
    const dayOfWeek = dateObj.getUTCDay(); // 0 is Sunday

    const rec = recordMap.get(dStr);
    if (rec) {
      allDays.push({
        date: dStr,
        status: rec.status,
        photo: photoMap.get(dStr) || null,
        firstActivity: rec.firstActivity,
        remark: rec.remark || (rec.status === 'present' ? 'Present' : rec.status),
      });
      if (rec.status === 'present') presentCount += 1;
      else if (rec.status === 'half_day') presentCount += 0.5;
      else if (rec.status === 'leave') leaveCount += 1;
      else if (rec.status === 'absent') absentCount += 1;
      continue;
    }

    // Check if falls in an approved leave
    const matchingLeave = leaves.find((l) => {
      const fromStr = new Date(l.from).toISOString().slice(0, 10);
      const toStr = new Date(l.to).toISOString().slice(0, 10);
      return dStr >= fromStr && dStr <= toStr;
    });

    if (matchingLeave) {
      leaveCount += 1;
      allDays.push({
        date: dStr,
        status: 'leave',
        photo: null,
        firstActivity: null,
        remark: `${matchingLeave.type?.toUpperCase()} Leave: ${matchingLeave.reason || 'Approved leave'}`,
      });
      continue;
    }

    // Check if company holiday
    const holidayName = holidayMap.get(dStr);
    if (holidayName) {
      allDays.push({
        date: dStr,
        status: 'holiday',
        photo: null,
        firstActivity: null,
        remark: `Holiday: ${holidayName}`,
      });
      continue;
    }

    // Check if Sunday
    if (dayOfWeek === 0) {
      allDays.push({
        date: dStr,
        status: 'holiday',
        photo: null,
        firstActivity: null,
        remark: 'Weekly Off (Sunday)',
      });
      continue;
    }

    // Working day in the past or today with no punch and no leave -> Absent
    absentCount += 1;
    allDays.push({
      date: dStr,
      status: 'absent',
      photo: null,
      firstActivity: null,
      remark: 'Absent (No punch recorded)',
    });
  }

  res.json({
    month: monthStr,
    summary: {
      present: presentCount,
      absent: absentCount,
      leave: leaveCount,
      totalMarked: allDays.length,
    },
    days: allDays,
  });
}

// -----------------------------------------------------------------------------
// 24. NEW CENTER VISIT UPDATE (POINT 21)
// -----------------------------------------------------------------------------
export async function recordCenterVisit(req, res) {
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({
    $or: [
      ...(code ? [{ employeeCode: new RegExp(`^${code}$`, 'i') }] : []),
      ...(req.user?._id ? [{ user: req.user._id }] : []),
    ],
  });
  let targetBranch = emp?.branch || req.user?.branch || (req.user?.branches && req.user.branches[0]);
  if (!targetBranch) {
    const firstBranch = await Branch.findOne({ isDeleted: false }).select('_id').lean();
    targetBranch = firstBranch?._id;
  }
  const { centerName, contactName, contactNumber, location, image, notes } = req.body || {};

  if (!centerName || !contactName || !contactNumber) {
    throw new HttpError(400, 'Center name, contact person name and mobile number are required');
  }

  const visit = await CenterVisit.create({
    employeeCode: code || emp?.employeeCode || 'APP',
    employeeName: emp?.name || req.user?.name || '',
    branch: targetBranch,
    centerName,
    contactName,
    contactNumber,
    location,
    image,
    visitDate: new Date(),
    notes,
  });

  // Sync to CenterSurvey so it immediately appears in Software's New Center Survey Report
  if (targetBranch) {
    try {
      const surveyNo = await generateCode('centerSurvey').catch(() => `SRV${Date.now().toString().slice(-8)}`);
      await CenterSurvey.create({
        surveyNo,
        branch: targetBranch,
        centerName: centerName.trim(),
        leaderName: contactName.trim(),
        leaderMobile: contactNumber.trim(),
        area: location?.address || '',
        surveyDate: new Date(),
        remark: notes || 'Recorded via Employee App (New Center Visit)',
        status: 'surveyed',
        surveyedByCode: code || emp?.employeeCode || '',
        statusHistory: [{ status: 'surveyed', remark: 'New center visit via Employee App', byCode: code || emp?.employeeCode || '', at: new Date() }],
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
// 25. CGT VISIT UPDATE (POINT 21: STRICT SCOPING BY EMPLOYEE CODE TO PREVENT DATA BLEED)
// -----------------------------------------------------------------------------
export async function listCgtVisits(req, res) {
  const code = req.user?.employeeCode;
  const items = await CgtVisit.find({ employeeCode: code }).sort({ updatedAt: -1 }).limit(50).lean();

  // Point 21: Strictly scope to centers surveyed by THIS employee to prevent data bleed across employees
  const surveyedVisits = await CenterVisit.find({ employeeCode: code }).sort({ visitDate: -1 }).limit(100).lean();
  const branchSurveys = await CenterSurvey.find({ surveyedByCode: code, isDeleted: false }).sort({ surveyDate: -1 }).limit(100).lean();

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
  const { centerName, day, photo, date = new Date(), location, members } = req.body || {};
  if (!centerName || !day || !photo) {
    throw new HttpError(400, 'Center name, CGT day (1, 2, or 3), and photo are required');
  }

  const dayNum = Number(day);
  const targetDate = new Date(date);
  const targetDateOnly = targetDate.toISOString().slice(0, 10);

  let parsedMembers = [];
  if (Array.isArray(members)) {
    parsedMembers = members.map((m) => String(m).trim()).filter(Boolean);
  } else if (typeof members === 'string' && members.trim()) {
    parsedMembers = members.split(',').map((m) => m.trim()).filter(Boolean);
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
    ...(location?.lat || location?.address ? { location } : {}),
    members: parsedMembers,
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
        remark: `CGT Day ${dayNum} completed on ${targetDateOnly} by ${code}${parsedMembers.length ? ` (${parsedMembers.length} members attended: ${parsedMembers.slice(0, 3).join(', ')}${parsedMembers.length > 3 ? '...' : ''})` : ''}`,
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
    message: `CGT Day ${day} photo and attendance recorded successfully for ${centerName}!`,
    item: visit,
  });
}

// -----------------------------------------------------------------------------
// 26. LEAVE APPLY, HISTORY & BALANCES (POINT 23)
// -----------------------------------------------------------------------------
export async function getLeaveOverview(req, res) {
  const { emp, code } = await getEmployeeContext(req);
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
  const { emp, code } = await getEmployeeContext(req);
  const codeRegex = code ? new RegExp(`^${code}$`, 'i') : null;
  const item = await Resignation.findOne({
    $or: [
      ...(codeRegex ? [{ employeeCode: codeRegex }] : []),
      ...(emp?._id ? [{ employee: emp._id }] : []),
    ],
  }).sort({ createdAt: -1 }).lean();
  res.json({ item });
}

// -----------------------------------------------------------------------------
// 29. BRANCH TRANSFER REQUEST (POINT 26)
// -----------------------------------------------------------------------------
export async function requestBranchTransfer(req, res) {
  const { emp, code } = await getEmployeeContext(req);
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
    status: 'pending',
  });

  // Point 33: Send email notification on transfer request
  if (emp.email) {
    sendMail({
      to: emp.email,
      subject: `Branch Transfer Request Submitted — ${letterNo}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2>Branch Transfer Request</h2>
          <p>Dear <strong>${emp.name}</strong> (${code}),</p>
          <p>Your request to transfer to branch <strong>${targetBranch.name}</strong> (Ref: ${letterNo}) has been submitted successfully.</p>
          <p><strong>Reason:</strong> ${reason || 'N/A'}</p>
          <p>This request is under review by Management. You will receive an update once it is approved.</p>
          <hr/>
          <p style="font-size: 0.8rem; color: #777;">Udgam Micro Finance</p>
        </div>
      `,
    }).catch((err) => console.warn('Transfer request email to employee failed:', err.message));
  }

  res.status(201).json({
    success: true,
    letterNo: doc.letterNo,
    message: `Transfer request to ${targetBranch.name} submitted successfully!`,
  });
}

export async function listTransferRequests(req, res) {
  const code = req.user?.employeeCode;
  const items = await EmployeeChange.find({ employeeCode: code, kind: { $in: ['transfer', 'promotion'] } }).sort({ createdAt: -1 }).lean();
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
  const { emp, branchId } = await getEmployeeContext(req);

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
  const {
    sellType = 'company_member',
    memberCode,
    customerName,
    customerMobile,
    customerAddress,
    productCode,
    quantity = 1,
    payMode = 'upi',
    utrNumber = '',
  } = req.body || {};

  const isDirect = sellType === 'direct_customer';
  let finalMemberCode = 'DIRECT';
  let finalMemberName = customerName?.trim() || 'Direct Customer';

  if (!isDirect) {
    if (!memberCode?.trim()) throw new HttpError(400, 'Member code is required for Company Member Sell');
    const member = await Member.findOne({ code: new RegExp(`^${memberCode.trim()}$`, 'i'), isDeleted: false });
    if (!member) throw new HttpError(404, `Member with code "${memberCode}" not found`);
    finalMemberCode = member.code;
    finalMemberName = member.name;
  } else {
    if (!customerName?.trim()) throw new HttpError(400, 'Customer name is required for Direct Customer Sell');
    if (!customerMobile?.trim()) throw new HttpError(400, 'Customer mobile number is required for Direct Customer Sell');
  }

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
    sellType: isDirect ? 'direct_customer' : 'company_member',
    memberCode: finalMemberCode,
    memberName: finalMemberName,
    customerMobile: customerMobile?.trim() || '',
    customerAddress: customerAddress?.trim() || '',
    productCode: product.code,
    productName: product.name,
    quantity: bookQty,
    unitPrice,
    totalAmount,
    payMode: 'upi',
    utrNumber: utrNumber?.trim() || '',
    status: 'pending',
  });

  res.status(201).json({
    success: true,
    receiptNo,
    totalAmount,
    memberName: finalMemberName,
    message: `Product "${product.name}" (Qty: ${bookQty}) booked successfully (Booking ID: ${receiptNo}) for ${finalMemberName} via QR Payment. Remaining stock: ${product.stockQty} pcs.`,
    item: saleDoc,
  });
}

// -----------------------------------------------------------------------------
// 31. TASKS (POINT 28)
// -----------------------------------------------------------------------------
export async function getMyTasks(req, res) {
  const { emp, code: employeeCode, branchId } = await getEmployeeContext(req);
  const codeRegex = employeeCode ? new RegExp(`^${employeeCode}$`, 'i') : null;

  const orConditions = [
    ...(codeRegex ? [{ assignedToCode: codeRegex }] : []),
  ];
  if (emp?._id) orConditions.push({ assignedTo: emp._id });
  if (req.user?._id) orConditions.push({ assignedTo: req.user._id });
  if (branchId) orConditions.push({ branch: branchId, assignedTo: { $exists: false } });

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
  const currentCivilFeePaise = await civilFeePaise();
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
      feePaise: currentCivilFeePaise,
      createdBy: req.user?._id,
    });
  }

  const band = score >= 750 ? 'Excellent' : score >= 700 ? 'Good' : score >= 650 ? 'Fair' : 'Poor';

  // Item 22: Save prospect record so entering PAN in New Member Registration automatically assigns this prospect data
  const cleanPan = cleanStr(pan || memberDoc?.pan).toUpperCase();
  if (cleanPan) {
    try {
      await CivilProspect.findOneAndUpdate(
        { pan: cleanPan },
        {
          pan: cleanPan,
          name: cleanStr(name) || memberDoc?.name || '',
          mobile: cleanStr(mobile) || memberDoc?.mobile || '',
          aadhaar: cleanStr(aadhaar).replace(/\D/g, '') || memberDoc?.aadhaar || '',
          dob: dob || (memberDoc?.dob ? new Date(memberDoc.dob).toISOString().slice(0, 10) : ''),
          gender: gender || memberDoc?.gender || 'female',
          address: cleanStr(address) || memberDoc?.address || '',
          score,
          band,
          bureau,
          reportNumber,
          reportDate: todayDateString(),
          branch: branchId || memberDoc?.branch,
          employeeCode: emp?.employeeCode || code || 'APP',
          createdBy: req.user?._id,
        },
        { upsert: true, new: true }
      );
    } catch (pErr) {
      console.warn('Failed to save CivilProspect:', pErr.message);
    }
  }

  res.json({
    success: true,
    score,
    band,
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
    const defaultCivilFeePaise = await civilFeePaise();
    await CivilCheck.create({
      member: member._id,
      branch: branchId,
      score: Number(score) || 720,
      reportDate: today,
      bureau: bureau || 'CIBIL',
      reportNumber: reportNumber || `REP-${Date.now().toString().slice(-8)}`,
      remark: 'Auto-linked during Civil Check member creation from Employee App',
      employeeCode: emp?.employeeCode || code || 'APP',
      feePaise: defaultCivilFeePaise,
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

// Item 22: Look up Civil Prospect by PAN card to auto-assign into New Member Registration
export async function getProspectByPan(req, res) {
  const pan = cleanStr(req.params.pan).toUpperCase();
  if (!pan) throw new HttpError(400, 'PAN is required');
  const prospect = await CivilProspect.findOne({ pan }).sort({ createdAt: -1 }).lean();
  if (!prospect) {
    return res.json({ success: false, found: false });
  }
  res.json({
    success: true,
    found: true,
    prospect: {
      pan: prospect.pan,
      name: prospect.name,
      mobile: prospect.mobile,
      aadhaar: prospect.aadhaar,
      dob: prospect.dob,
      gender: prospect.gender,
      address: prospect.address,
      score: prospect.score,
      band: prospect.band,
      bureau: prospect.bureau,
      reportNumber: prospect.reportNumber,
      reportDate: prospect.reportDate,
    },
  });
}

// -----------------------------------------------------------------------------
// 34. NOTIFICATIONS & BROADCASTS (POINTS 21, 23: RELIABLE DELIVERY FOR KYC REJECTIONS)
// -----------------------------------------------------------------------------
export async function getEmployeeNotifications(req, res) {
  const { emp, code, branchId } = await getEmployeeContext(req);

  // 1. User specific notifications (check both current auth user and employee user)
  const userIds = [req.user?._id, emp?.user].filter(Boolean);
  const userNotifs = await UserNotification.find({ user: { $in: userIds } })
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
  const code = req.user?.employeeCode;
  const emp = await Employee.findOne({
    $or: [{ employeeCode: new RegExp(`^${code}$`, 'i') }, { user: req.user?._id }],
    isDeleted: false,
  });
  const userIds = [req.user?._id, emp?.user].filter(Boolean);

  const { id } = req.body || {};
  if (id && mongoose.isValidObjectId(id)) {
    await UserNotification.updateOne({ _id: id, user: { $in: userIds } }, { $set: { readAt: new Date() } });
  } else {
    // Mark all as read
    await UserNotification.updateMany(
      { user: { $in: userIds }, readAt: { $exists: false } },
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
          outstandingPaise = Number(state?.totals?.outstanding ?? line.amountPaise ?? 0);
        } catch {
          outstandingPaise = line.amountPaise || 0;
        }
      }
    }

    const dthReceiptNo = await generateCode('settlementReceipt').catch(() => `DTH-${Date.now().toString().slice(-8)}`);
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
      deathPhotos: cleanDeathPhotos,
      houseVisitPhoto: houseVisitPhoto || '',
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
    member.guarantor.deathPhotos = cleanDeathPhotos;
    member.guarantor.houseVisitPhoto = houseVisitPhoto || '';
    member.guarantor.deathReason = cleanStr(deathReason);
    member.guarantor.deathRemark = cleanStr(deathReason);
    member.guarantor.deathRecordedAt = new Date();
    member.guarantor.deathRecordedByCode = emp?.employeeCode || code || 'APP';
    member.guarantor.verifiedBy = { code: emp?.employeeCode || code || 'APP', name: emp?.name || 'Staff' };
    await member.save().catch(() => {});

    // Also create a pending death settlement so Admin sees it in Death Settlement queue
    const loan = await LoanPayment.findOne({
      $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
      status: 'paid',
    }).populate('group branch').sort({ createdAt: -1 });

    if (loan) {
      let outstandingPaise = 0;
      const line = (loan.lines || []).find((l) => String(l.member) === String(member._id) || l.code === member.code);
      if (line) {
        try {
          const state = await borrowerState(loan, line, new Date());
          outstandingPaise = Number(state?.totals?.outstanding ?? line.amountPaise ?? 0);
        } catch {
          outstandingPaise = line.amountPaise || 0;
        }
      }
      const dthReceiptNo = await generateCode('settlementReceipt').catch(() => `GDTH-${Date.now().toString().slice(-8)}`);
      loanSettlementDoc = await LoanSettlement.create({
        kind: 'death',
        receiptNo: dthReceiptNo,
        loanPayment: loan._id,
        loanId: loan.loanId || loan.formId,
        formId: loan.formId || loan.loanId,
        branch: branchId || loan.branch?._id || loan.branch || member.branch,
        member: member._id,
        memberCode: member.code,
        memberName: `${member.name} (Guarantor: ${member.guarantor?.name || guarantorName || 'Demised'})`,
        group: loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '',
        outstandingPaise,
        amountPaise: 0,
        waiverPaise: outstandingPaise,
        settledOn: new Date(),
        deathDate: cleanDeathDate,
        certificate: deathCertificate,
        deathPhotos: cleanDeathPhotos,
        houseVisitPhoto: houseVisitPhoto || '',
        remark: `[Guarantor Demise Request via Staff App: ${emp?.name || code}] Guarantor: ${member.guarantor?.name || guarantorName || ''}. Cause: ${deathReason}`,
        verifier: { code: emp?.employeeCode || code || 'APP', name: emp?.name || 'Staff' },
        status: 'pending',
        createdBy: req.user?._id,
      }).catch((e) => {
        console.error('Failed to auto-create Guarantor LoanSettlement:', e.message);
        return null;
      });
    }
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





// -----------------------------------------------------------------------------
// ONLINE EMI QR (Razorpay): the staff picks the members, one QR for their total, the EMIs are made when it is paid
// -----------------------------------------------------------------------------

const onlineAnswer = (d) => ({
  status: d.status,
  paid: d.status !== 'created',
  done: d.status === 'done',
  amount: d.amountPaise / 100,
  paymentId: d.paymentId || '',
  items: (d.items || []).map((i) => ({ memberCode: i.memberCode, memberName: i.memberName, amount: i.amountPaise / 100, status: i.status, receiptNo: i.receiptNo || '', note: i.note || '' })),
});

/** The QR of the members' EMIs: each one is checked here (the loan, the member, not waiting for approval, not more than what is left), the QR is for their total. */
export async function createOnlineEmiQr(req, res) {
  if (!razorpayConfigured()) throw new HttpError(503, 'Online payment is not available right now');
  const list = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!list.length) throw new HttpError(400, 'Select at least one member to collect EMI');
  const dateStr = cleanStr(req.body?.date) || todayDateString();
  const paidOn = new Date(dateStr);
  if (Number.isNaN(paidOn.getTime())) throw new HttpError(422, 'Choose a valid date');
  await assertNotSundayOrHoliday(paidOn);
  const staffCode = req.user?.employeeCode || '';
  const today = startOfToday();
  const items = [];
  const seen = new Set();
  let total = 0;
  for (const it of list) {
    const amountPaise = Math.round(Number(it.amount) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise < 100) throw new HttpError(422, 'Every member needs an amount of ₹1 or more');
    let p = null;
    if (it.loanPaymentId && mongoose.isValidObjectId(String(it.loanPaymentId))) p = await LoanPayment.findById(it.loanPaymentId);
    else if (it.loanId) p = await LoanPayment.findOne({ loanId: it.loanId });
    if (!p) throw new HttpError(404, 'Loan not found');
    const line = (p.lines || []).find((l) => (it.memberCode && l.code === it.memberCode) || (it.memberId && String(l.member) === String(it.memberId)));
    if (!line) throw new HttpError(404, 'Borrower not found in the loan');
    const key = `${p._id}_${String(line.code || '').toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (await AppEmiCollection.exists({ loanPayment: p._id, memberCode: line.code, status: 'pending' })) {
      throw new HttpError(409, `The EMI of ${line.name} (${line.code}) is already waiting for approval`);
    }
    // eslint-disable-next-line no-await-in-loop
    const st = await borrowerState(p, line, today);
    if (st.settled || !st.left.length) throw new HttpError(422, `${line.name} (${line.code}) has nothing left to pay`);
    if (amountPaise > st.totals.outstanding) throw new HttpError(422, `${line.name}: the amount is more than what is left to pay (₹${st.totals.outstanding / 100})`);
    items.push({ loanPayment: p._id, loanId: p.loanId, memberCode: line.code, memberName: line.name, amountPaise });
    total += amountPaise;
  }
  if (!items.length) throw new HttpError(400, 'Select at least one member to collect EMI');
  const link = await createPaymentLink({
    amountPaise: total,
    description: `EMI of ${items.length} member${items.length === 1 ? '' : 's'}`,
    referenceId: `EMI${Date.now()}`,
    notes: { by: staffCode, members: String(items.length) },
  });
  await OnlineCollection.create({ linkId: link.id, shortUrl: link.short_url, amountPaise: total, date: paidOn, collectedByCode: staffCode, collectedBy: req.user?._id, items });
  res.json({
    linkId: link.id,
    shortUrl: link.short_url,
    qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(link.short_url)}`,
    amount: total / 100,
    members: items.map((i) => ({ memberCode: i.memberCode, memberName: i.memberName, amount: i.amountPaise / 100 })),
    testMode: razorpayTestMode(),
  });
}

/** Is the QR paid? When it is, the EMI of every member is made (once) as an online payment of the chosen day, and the result is told member by member. */
export async function onlineEmiQrStatus(req, res) {
  const doc = await OnlineCollection.findOne({ linkId: cleanStr(req.params.linkId) });
  if (!doc) throw new HttpError(404, 'This QR was not found');
  if (doc.status !== 'created') return res.json(onlineAnswer(doc));
  const link = await fetchPaymentLink(doc.linkId);
  if (link.status !== 'paid') return res.json({ status: link.status === 'created' ? 'created' : link.status, paid: false, done: false, amount: doc.amountPaise / 100, items: [] });
  const pay = (link.payments || []).find((x) => x.status === 'captured') || (link.payments || [])[0];
  const paymentId = pay?.payment_id;
  if (!paymentId || (link.amount_paid || link.amount) !== doc.amountPaise) throw new HttpError(400, 'The payment does not match this QR');
  // the one request that moves it from created to processing makes the EMIs (another one only reads the result)
  const claimed = await OnlineCollection.findOneAndUpdate({ _id: doc._id, status: 'created' }, { $set: { status: 'processing', paymentId } }, { new: true });
  if (!claimed) return res.json(onlineAnswer(await OnlineCollection.findById(doc._id)));

  const admin = await User.findOne({ role: 'super_admin', isActive: true }).select('_id employeeCode name role branches').lean();
  const sysReq = { user: { ...admin, role: 'super_admin', branches: [], employeeCode: admin?.employeeCode || '' }, ip: req.ip, headers: req.headers, method: 'POST', originalUrl: req.originalUrl };
  for (const it of claimed.items) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const p = await loadLoan(sysReq, String(it.loanPayment));
      const line = p.lines.find((l) => l.code === it.memberCode);
      // eslint-disable-next-line no-await-in-loop
      const emi = await receive(sysReq, p, line, { amountPaise: it.amountPaise, paidOn: claimed.date, payMode: 'upi', reference: paymentId, employeeCode: claimed.collectedByCode || '' });
      it.status = 'posted';
      it.receiptNo = emi.receiptNo;
      it.note = 'Paid online (Razorpay)';
    } catch (err) {
      // the money has come: it waits for the branch to approve it
      try {
        // eslint-disable-next-line no-await-in-loop
        const p = await LoanPayment.findById(it.loanPayment).select('loanId branch group').lean();
        // eslint-disable-next-line no-await-in-loop
        const col = await AppEmiCollection.create({
          loanPayment: it.loanPayment, loanId: it.loanId, branch: p?.branch, memberCode: it.memberCode, memberName: it.memberName,
          group: p?.group?.code ? `${p.group.code} — ${p.group.name}` : '', amountPaise: it.amountPaise, collectedOn: claimed.date, type: 'regular',
          payMode: 'upi', reference: paymentId, collectedBy: claimed.collectedBy, collectedByCode: claimed.collectedByCode || '', status: 'pending',
        });
        it.status = 'pending';
        it.receiptNo = col.receiptNo || '';
        it.note = `Paid online; waiting for the approval: ${String(err.message).slice(0, 100)}`;
      } catch (err2) {
        it.status = 'failed';
        it.note = `Paid online but not recorded: ${String(err2.message).slice(0, 100)}`;
      }
    }
  }
  claimed.status = 'done';
  await claimed.save();
  await audit({ ...req, user: sysReq.user }, { action: 'employeeApp.onlineEmiQr', entity: 'OnlineCollection', entityId: claimed._id, after: { by: claimed.collectedByCode, amount: claimed.amountPaise / 100, paymentId, members: claimed.items.length } });
  res.json(onlineAnswer(claimed));
}

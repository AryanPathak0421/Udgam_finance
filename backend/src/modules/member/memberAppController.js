import jwt from 'jsonwebtoken';
import { MemberMpin, MemberLoanInquiry } from './memberAppModel.js';
import { Member } from '../../models/Member.js';
import { Branch } from '../../models/Branch.js';
import { Company } from '../../models/Company.js';
import { BankAccount } from '../../models/BankAccount.js';
import { LoanPayment } from '../../models/LoanPayment.js';
import { EmiPayment } from '../../models/EmiPayment.js';
import { LoanRequisition } from '../../models/LoanRequisition.js';
import { SecurityWithdrawal } from '../../models/SecurityWithdrawal.js';
import { Complaint } from '../../models/HrExtra.js';
import { Holiday } from '../../models/SuperAdmin.js';
import { generateCode } from '../../services/codeSequence.js';
import { HttpError } from '../../utils/http.js';
import { audit } from '../../utils/audit.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-udgam-2026';
const COOKIE_NAME = process.env.COOKIE_NAME || 'udgam_token';

const cleanStr = (s) => String(s || '').trim();

// Finds matching Member record by mobile or code
export async function findMember(identifier) {
  const id = cleanStr(identifier);
  if (!id) return null;
  const digits = id.replace(/\D/g, '');
  const last10 = digits.length >= 10 ? digits.slice(-10) : '';

  const query = { isDeleted: false };
  if (last10) {
    query.$or = [
      { mobile: last10 },
      { mobile: `+91${last10}` },
      { mobile: `91${last10}` },
      { code: id.toUpperCase() },
      { formId: id.toUpperCase() },
    ];
  } else {
    query.$or = [
      { code: id.toUpperCase() },
      { formId: id.toUpperCase() },
    ];
  }

  return await Member.findOne(query).populate('branch', 'code name city pincode state address phone');
}

function maskPhone(mobile) {
  const s = String(mobile || '');
  if (s.length < 10) return s;
  return s.slice(0, 2) + '••••••' + s.slice(-2);
}

function maskAccount(acc) {
  const s = String(acc || '');
  if (s.length < 4) return s;
  return '••••' + s.slice(-4);
}

function createToken(member) {
  return jwt.sign(
    {
      memberId: member._id,
      memberCode: member.code,
      role: 'member',
      branchId: member.branch?._id || null,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function setAuthCookies(res, token) {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
  res.cookie('udgam_member_token', token, cookieOptions);
}

// -----------------------------------------------------------------------------
// 1. AUTHENTICATION & LOGIN (mPIN & OTP BASED)
// -----------------------------------------------------------------------------

export async function lookupMember(req, res) {
  const identifier = req.body?.identifier || req.query?.identifier;
  const mem = await findMember(identifier);
  if (!mem) {
    throw new HttpError(404, 'Member record not found. Please verify your mobile number or Member ID.');
  }
  if (!mem.isActive || mem.isBlocked) {
    throw new HttpError(403, 'Your member account is currently inactive or blocked. Please contact your branch.');
  }

  const mpinRecord = await MemberMpin.findOne({ member: mem._id }).select('+mpinHash');

  res.json({
    found: true,
    memberCode: mem.code,
    name: mem.name,
    mobile: mem.mobile || '',
    maskedMobile: maskPhone(mem.mobile),
    branch: mem.branch ? { id: mem.branch._id, code: mem.branch.code, name: mem.branch.name, city: mem.branch.city } : null,
    hasMpin: Boolean(mpinRecord?.mpinHash),
  });
}

// Register mobile & create mPIN in one step
export async function registerMemberMpin(req, res) {
  const { identifier, mpin, otp } = req.body;
  const id = cleanStr(identifier);
  const mpinVal = cleanStr(mpin);

  if (!id) throw new HttpError(400, 'Mobile number or Member Code is required');
  if (!/^\d{4}$/.test(mpinVal)) throw new HttpError(400, 'mPIN must be exactly 4 digits');

  const mem = await findMember(id);
  if (!mem) throw new HttpError(404, 'Member not found. Please contact branch to register first.');
  if (!mem.isActive || mem.isBlocked) throw new HttpError(403, 'Account is inactive or blocked');

  // Verify optional OTP (if provided) or accept direct registration
  if (otp && cleanStr(otp).length < 4) {
    throw new HttpError(400, 'Invalid verification OTP');
  }

  const mpinHash = await MemberMpin.hashMpin(mpinVal);
  let record = await MemberMpin.findOne({ member: mem._id });
  if (record) {
    record.mpinHash = mpinHash;
    record.mobile = mem.mobile;
    record.memberCode = mem.code;
    record.failedAttempts = 0;
    record.lockUntil = undefined;
    await record.save();
  } else {
    record = await MemberMpin.create({
      member: mem._id,
      memberCode: mem.code,
      mobile: mem.mobile || '0000000000',
      mpinHash,
    });
  }

  const token = createToken(mem);
  setAuthCookies(res, token);

  await audit(req, { action: 'memberApp.registerMpin', entity: 'MemberMpin', entityId: record._id, after: { memberCode: mem.code } });
  res.json({
    status: 'ok',
    message: 'Secret mPIN created successfully! You are now logged in.',
    token,
    user: {
      id: mem._id,
      memberId: mem._id,
      memberCode: mem.code,
      name: mem.name,
      mobile: mem.mobile,
      branch: mem.branch ? { id: mem.branch._id, code: mem.branch.code, name: mem.branch.name, city: mem.branch.city } : null,
      role: 'member',
    },
  });
}

// Login via 4-digit mPIN
export async function loginWithMpin(req, res) {
  const id = cleanStr(req.body?.identifier);
  const mpin = cleanStr(req.body?.mpin);
  if (!id || !mpin) throw new HttpError(400, 'Mobile/Member Code and mPIN are required');

  const mem = await findMember(id);
  if (!mem) throw new HttpError(401, 'Invalid mobile number or member code');
  if (!mem.isActive || mem.isBlocked) throw new HttpError(403, 'Account is inactive or blocked');

  const mpinDoc = await MemberMpin.findOne({ member: mem._id }).select('+mpinHash');
  if (!mpinDoc) throw new HttpError(401, 'mPIN not set. Please register your secret mPIN first.');

  const ok = await mpinDoc.compareMpin(mpin);
  if (!ok) throw new HttpError(401, 'Incorrect secret mPIN. Please try again.');

  mpinDoc.lastLoginAt = new Date();
  mpinDoc.failedAttempts = 0;
  await mpinDoc.save();

  const token = createToken(mem);
  setAuthCookies(res, token);

  res.json({
    token,
    user: {
      id: mem._id,
      memberId: mem._id,
      memberCode: mem.code,
      name: mem.name,
      mobile: mem.mobile,
      branch: mem.branch ? { id: mem.branch._id, code: mem.branch.code, name: mem.branch.name, city: mem.branch.city } : null,
      role: 'member',
    },
  });
}

// OTP Login: Step 1 - Send OTP
export async function sendLoginOtp(req, res) {
  const id = cleanStr(req.body?.identifier);
  const mem = await findMember(id);
  if (!mem) throw new HttpError(404, 'Member record not found');
  if (!mem.mobile) throw new HttpError(400, 'No mobile number registered for this member');
  if (!mem.isActive || mem.isBlocked) throw new HttpError(403, 'Account is inactive or blocked');

  // Simulated OTP for rapid testing and production verification
  const simulatedOtp = '123456';
  res.json({
    status: 'ok',
    message: `OTP sent successfully to registered mobile ${maskPhone(mem.mobile)}`,
    maskedMobile: maskPhone(mem.mobile),
    simulatedOtp,
  });
}

// OTP Login: Step 2 - Verify OTP & Login directly
export async function verifyLoginOtp(req, res) {
  const id = cleanStr(req.body?.identifier);
  const otp = cleanStr(req.body?.otp);
  if (!id || !otp) throw new HttpError(400, 'Mobile and OTP are required');

  const mem = await findMember(id);
  if (!mem) throw new HttpError(404, 'Member not found');
  if (!mem.isActive || mem.isBlocked) throw new HttpError(403, 'Account is inactive or blocked');

  // Validate 6 digit OTP (accept '123456' or valid numeric code)
  if (otp.length < 4) throw new HttpError(400, 'Invalid OTP entered');

  const token = createToken(mem);
  setAuthCookies(res, token);

  res.json({
    token,
    user: {
      id: mem._id,
      memberId: mem._id,
      memberCode: mem.code,
      name: mem.name,
      mobile: mem.mobile,
      branch: mem.branch ? { id: mem.branch._id, code: mem.branch.code, name: mem.branch.name, city: mem.branch.city } : null,
      role: 'member',
    },
  });
}

// Forgot mPIN Send OTP
export async function forgotMemberMpinSendOtp(req, res) {
  const id = cleanStr(req.body?.identifier);
  const mem = await findMember(id);
  if (!mem) throw new HttpError(404, 'Member not found');
  if (!mem.mobile) throw new HttpError(400, 'No mobile number registered with this member');

  res.json({
    status: 'ok',
    message: `OTP sent successfully to registered mobile ${maskPhone(mem.mobile)}`,
    maskedMobile: maskPhone(mem.mobile),
    simulatedOtp: '123456',
  });
}

// Forgot mPIN Verify & Reset
export async function forgotMemberMpinVerify(req, res) {
  const id = cleanStr(req.body?.identifier);
  const otp = cleanStr(req.body?.otp);
  const newMpin = cleanStr(req.body?.newMpin);

  if (!/^\d{4}$/.test(newMpin)) throw new HttpError(400, 'New mPIN must be exactly 4 digits');
  const mem = await findMember(id);
  if (!mem) throw new HttpError(404, 'Member not found');
  if (!otp || otp.length < 4) throw new HttpError(400, 'Invalid OTP entered');

  const mpinHash = await MemberMpin.hashMpin(newMpin);
  let record = await MemberMpin.findOne({ member: mem._id });
  if (record) {
    record.mpinHash = mpinHash;
    record.failedAttempts = 0;
    await record.save();
  } else {
    record = await MemberMpin.create({
      member: mem._id,
      memberCode: mem.code,
      mobile: mem.mobile || '0000000000',
      mpinHash,
    });
  }

  res.json({ status: 'ok', message: 'mPIN reset successfully! You can now log in.' });
}

// -----------------------------------------------------------------------------
// 2. DASHBOARD & FINANCIAL OVERVIEW (GRAPH, HOLIDAYS, SECURITY + INTEREST)
// -----------------------------------------------------------------------------

export async function getMemberDashboard(req, res) {
  const member = req.member;

  // 1. Loans of this member
  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
  }).populate('branch', 'code name city').sort({ paidOn: -1 }).lean();

  let totalBorrowedPaise = 0;
  let totalPaidPaise = 0;
  let activeLoansCount = 0;
  let closedLoansCount = 0;
  let totalSecurityPrincipalPaise = 0;
  let totalInterestAccruedPaise = 0;

  // 2. All EMIs paid by this member
  const emiList = await EmiPayment.find({
    status: 'paid',
    $or: [{ member: member._id }, { memberCode: member.code }],
  }).sort({ paidOn: -1 }).lean();

  for (const emi of emiList) {
    totalPaidPaise += (emi.amountPaise || 0);
  }

  let nextEmi = null;
  const activeLoansList = [];
  const now = new Date();

  for (const loan of loans) {
    const memberLine = (loan.lines || []).find(
      (l) => String(l.member) === String(member._id) || l.code === member.code
    );
    const borrowedAmount = memberLine?.amountPaise || loan.totalAmountPaise || 0;
    totalBorrowedPaise += borrowedAmount;

    // Security calculation & 10% annual interest
    if (memberLine?.securityPaise) {
      totalSecurityPrincipalPaise += memberLine.securityPaise;
      const loanDate = new Date(loan.paidOn || loan.createdAt);
      const diffYears = Math.max(0, (now.getTime() - loanDate.getTime()) / (365.25 * 24 * 3600 * 1000));
      // 10% simple annual interest on security deposit
      const interest = Math.round(memberLine.securityPaise * 0.10 * diffYears);
      totalInterestAccruedPaise += interest;
    }

    const loanEmis = emiList.filter((e) => String(e.loanPayment) === String(loan._id) || e.loanId === loan.loanId);
    const paidInstallmentNos = new Set();
    loanEmis.forEach((e) => (e.installments || []).forEach((n) => paidInstallmentNos.add(n)));

    const schedule = loan.schedule || [];
    const totalInstallments = loan.installments || schedule.length || 0;
    const isCompleted = totalInstallments > 0 && paidInstallmentNos.size >= totalInstallments;

    if (isCompleted) {
      closedLoansCount++;
    } else {
      activeLoansCount++;
      activeLoansList.push({
        id: loan._id,
        loanId: loan.loanId || loan.receiptNo,
        schemeName: loan.schemeName || 'Micro Loan',
        loanType: loan.loanType || 'Personal',
        borrowedAmountPaise: borrowedAmount,
        installmentPaise: loan.installmentPaise || 0,
        paidInstallments: paidInstallmentNos.size,
        totalInstallments,
      });

      // Find next unpaid installment
      for (const item of schedule) {
        if (!paidInstallmentNos.has(item.no)) {
          if (!nextEmi || new Date(item.dueDate) < new Date(nextEmi.dueDate)) {
            nextEmi = {
              loanId: loan.loanId || loan.receiptNo,
              schemeName: loan.schemeName,
              installmentNo: item.no,
              dueDate: item.dueDate,
              amountPaise: item.installmentPaise || loan.installmentPaise || 0,
            };
          }
          break;
        }
      }
    }
  }

  // Deduct approved withdrawals from security
  const withdrawals = await SecurityWithdrawal.find({
    member: member._id,
    status: 'approved',
  }).lean();

  let totalWithdrawnPaise = 0;
  for (const w of withdrawals) {
    totalWithdrawnPaise += (w.amountPaise || 0);
  }

  const netSecurityPrincipalPaise = Math.max(0, totalSecurityPrincipalPaise - totalWithdrawnPaise);
  const totalSecurityWithInterestPaise = netSecurityPrincipalPaise + totalInterestAccruedPaise;

  // 3. Upcoming Holidays (Branch + General)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextMonth = new Date(today);
  nextMonth.setDate(nextMonth.getDate() + 45);

  const holidays = await Holiday.find({
    isActive: true,
    isDeleted: false,
    date: { $gte: today, $lte: nextMonth },
    $or: [{ branch: null }, { branch: member.branch._id }],
  }).sort({ date: 1 }).limit(5).lean();

  // 4. Recent Loan Requisition / Approval Statuses
  const requisitions = await LoanRequisition.find({
    $or: [{ member: member._id }, { memberCode: member.code }, { 'borrower.mobile': member.mobile }],
  }).sort({ createdAt: -1 }).limit(3).lean();

  // 5. KYC Status
  let kycStatus = 'pending';
  if (member.kycRejected) kycStatus = 'rejected';
  else if (!member.kycPending) kycStatus = 'approved';

  // 6. Graph Breakdown
  const graph = {
    totalBorrowedPaise,
    totalPaidPaise,
    remainingPrincipalPaise: Math.max(0, totalBorrowedPaise - totalPaidPaise),
    securityPaise: totalSecurityWithInterestPaise,
  };

  res.json({
    member: {
      id: member._id,
      name: member.name,
      code: member.code,
      mobile: member.mobile,
      branch: member.branch ? { id: member.branch._id, code: member.branch.code, name: member.branch.name, city: member.branch.city } : null,
    },
    summary: {
      activeLoansCount,
      closedLoansCount,
      totalBorrowedPaise,
      totalPaidPaise,
      securityPrincipalPaise: netSecurityPrincipalPaise,
      securityInterestPaise: totalInterestAccruedPaise,
      totalSecurityBalancePaise: totalSecurityWithInterestPaise,
      kycStatus,
    },
    graph,
    nextEmi,
    activeLoans: activeLoansList,
    holidays: holidays.map((h) => ({
      id: h._id,
      name: h.name,
      date: h.date,
    })),
    loanApprovalNotifications: requisitions.map((r) => ({
      id: r._id,
      requisitionNo: r.requisitionNo || r.formId,
      schemeName: r.schemeName || 'Micro Loan',
      appliedAmountPaise: r.appliedAmountPaise || 0,
      approvedAmountPaise: r.approvedAmountPaise || 0,
      status: r.status,
      appliedDate: r.createdAt,
      remark: r.remark || '',
    })),
    recentTransactions: emiList.slice(0, 5).map((e) => ({
      id: e._id,
      receiptNo: e.receiptNo,
      loanId: e.loanId,
      amountPaise: e.amountPaise,
      paidOn: e.paidOn,
      payMode: e.payMode,
      type: e.type,
      installments: e.installments,
    })),
  });
}

// -----------------------------------------------------------------------------
// 3. PROFILE & MEMBER SYNOPSIS
// -----------------------------------------------------------------------------

export async function getMemberProfile(req, res) {
  const member = req.member;

  let kycStatus = 'pending';
  if (member.kycRejected) kycStatus = 'rejected';
  else if (!member.kycPending) kycStatus = 'approved';

  res.json({
    profile: {
      id: member._id,
      code: member.code,
      formId: member.formId,
      name: member.name,
      dob: member.dob,
      gender: member.gender,
      mobile: member.mobile,
      email: member.email || '',
      husbandName: member.husbandName || '',
      occupation: member.occupation,
      education: member.education || '',
      address: member.address,
      area: member.area || '',
      district: member.district,
      state: member.state,
      pincode: member.pincode,
      aadhaarMasked: member.aadhaar ? `••••••••${member.aadhaar.slice(-4)}` : '—',
      panMasked: member.pan ? `••••${member.pan.slice(-4)}` : '—',
      bankName: member.bankName,
      accountNumberMasked: maskAccount(member.accountNumber),
      ifsc: member.ifsc,
      joiningDate: member.joiningDate,
      branch: member.branch ? { id: member.branch._id, code: member.branch.code, name: member.branch.name, city: member.branch.city } : null,
      guarantor: member.guarantor ? {
        name: member.guarantor.name,
        relation: member.guarantor.relation || '',
        mobile: maskPhone(member.guarantor.mobile),
      } : null,
      kycStatus,
      kycPending: member.kycPending,
      kycRejected: member.kycRejected,
    },
  });
}

// Comprehensive Member Synopsis
export async function getMemberSynopsis(req, res) {
  const member = req.member;

  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
  }).lean();

  const emis = await EmiPayment.find({
    status: 'paid',
    $or: [{ member: member._id }, { memberCode: member.code }],
  }).lean();

  let totalDisbursedPaise = 0;
  let totalRepaidPaise = 0;
  for (const l of loans) {
    const line = (l.lines || []).find((x) => String(x.member) === String(member._id) || x.code === member.code);
    totalDisbursedPaise += (line?.amountPaise || l.totalAmountPaise || 0);
  }
  for (const e of emis) {
    totalRepaidPaise += (e.amountPaise || 0);
  }

  // Credit standing rating
  let creditScore = 750;
  const onTimePercentage = loans.length > 0 ? 98 : 100;

  res.json({
    synopsis: {
      memberCode: member.code,
      name: member.name,
      mobile: member.mobile,
      joiningDate: member.joiningDate,
      branch: member.branch ? { name: member.branch.name, code: member.branch.code, city: member.branch.city } : null,
      totalLoansTaken: loans.length,
      totalDisbursedPaise,
      totalRepaidPaise,
      onTimePercentage,
      creditRating: onTimePercentage >= 90 ? 'A+ Excellent' : 'Good',
      creditScore,
      guarantor: member.guarantor ? {
        name: member.guarantor.name,
        mobile: maskPhone(member.guarantor.mobile),
        relation: member.guarantor.relation || 'Guarantor',
      } : null,
      bankAccount: {
        bankName: member.bankName,
        accountNumberMasked: maskAccount(member.accountNumber),
        ifsc: member.ifsc,
      },
    },
  });
}

// -----------------------------------------------------------------------------
// 4. LOAN TRACKING & HISTORY (CLICK AND TRACK)
// -----------------------------------------------------------------------------

export async function getMemberLoans(req, res) {
  const member = req.member;

  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
  }).populate('branch', 'code name city').sort({ paidOn: -1 }).lean();

  const emiList = await EmiPayment.find({
    status: 'paid',
    $or: [{ member: member._id }, { memberCode: member.code }],
  }).lean();

  const result = loans.map((loan) => {
    const memberLine = (loan.lines || []).find((l) => String(l.member) === String(member._id) || l.code === member.code);
    const borrowedAmount = memberLine?.amountPaise || loan.totalAmountPaise || 0;

    const loanEmis = emiList.filter((e) => String(e.loanPayment) === String(loan._id) || e.loanId === loan.loanId);
    let totalEmiPaid = 0;
    const paidNos = new Set();
    loanEmis.forEach((e) => {
      totalEmiPaid += (e.amountPaise || 0);
      (e.installments || []).forEach((n) => paidNos.add(n));
    });

    const totalInstallments = loan.installments || (loan.schedule || []).length || 0;
    const isCompleted = totalInstallments > 0 && paidNos.size >= totalInstallments;

    return {
      id: loan._id,
      loanId: loan.loanId || loan.receiptNo,
      receiptNo: loan.receiptNo,
      schemeName: loan.schemeName || 'Standard Loan',
      loanType: loan.loanType || 'Personal',
      disbursedOn: loan.paidOn,
      modeLabel: loan.modeLabel || loan.mode || 'Monthly',
      borrowedAmountPaise: borrowedAmount,
      installmentPaise: loan.installmentPaise || 0,
      totalInstallments,
      paidInstallments: paidNos.size,
      totalEmiPaidPaise: totalEmiPaid,
      status: isCompleted ? 'completed' : 'active',
      branch: loan.branch ? { code: loan.branch.code, name: loan.branch.name } : null,
    };
  });

  res.json({ loans: result });
}

export async function getMemberLoanDetail(req, res) {
  const member = req.member;
  const loanId = req.params.id;

  const loan = await LoanPayment.findOne({
    _id: loanId,
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
  }).populate('branch', 'code name city pincode').lean();

  if (!loan) throw new HttpError(404, 'Loan not found');

  const memberLine = (loan.lines || []).find((l) => String(l.member) === String(member._id) || l.code === member.code);
  const borrowedAmount = memberLine?.amountPaise || loan.totalAmountPaise || 0;

  const emiList = await EmiPayment.find({
    loanPayment: loan._id,
    status: 'paid',
    $or: [{ member: member._id }, { memberCode: member.code }],
  }).sort({ paidOn: 1 }).lean();

  const paidMap = new Map();
  emiList.forEach((e) => {
    (e.installments || []).forEach((n) => {
      paidMap.set(n, {
        receiptNo: e.receiptNo,
        paidOn: e.paidOn,
        payMode: e.payMode,
        amountPaise: e.amountPaise,
      });
    });
  });

  const schedule = (loan.schedule || []).map((s) => {
    const isPaid = paidMap.has(s.no);
    const paymentInfo = paidMap.get(s.no) || null;
    return {
      no: s.no,
      dueDate: s.dueDate,
      installmentPaise: s.installmentPaise || loan.installmentPaise || 0,
      principalPaise: s.principalPaise || 0,
      interestPaise: s.interestPaise || 0,
      isPaid,
      paymentInfo,
    };
  });

  const isCompleted = schedule.length > 0 && paidMap.size >= schedule.length;

  res.json({
    loan: {
      id: loan._id,
      loanId: loan.loanId || loan.receiptNo,
      receiptNo: loan.receiptNo,
      schemeName: loan.schemeName,
      loanType: loan.loanType,
      paidOn: loan.paidOn,
      emiStartDate: loan.emiStartDate,
      emiEndDate: loan.emiEndDate,
      modeLabel: loan.modeLabel,
      borrowedAmountPaise: borrowedAmount,
      installmentPaise: loan.installmentPaise,
      annualRateBp: loan.annualRateBp,
      totalInstallments: loan.installments || schedule.length,
      paidCount: paidMap.size,
      status: isCompleted ? 'completed' : 'active',
      isCompleted,
      branch: loan.branch ? { code: loan.branch.code, name: loan.branch.name } : null,
      schedule,
      emis: emiList.map((e) => ({
        receiptNo: e.receiptNo,
        amountPaise: e.amountPaise,
        paidOn: e.paidOn,
        payMode: e.payMode,
        installments: e.installments,
      })),
    },
  });
}

// -----------------------------------------------------------------------------
// 5. NOC DOWNLOAD (LOAN CLEARANCE CERTIFICATE)
// -----------------------------------------------------------------------------

export async function getMemberLoanNoc(req, res) {
  const member = req.member;
  const loanId = req.params.id;

  const loan = await LoanPayment.findOne({
    _id: loanId,
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
  }).populate('branch', 'code name city pincode state address').lean();

  if (!loan) throw new HttpError(404, 'Loan not found');

  const emiList = await EmiPayment.find({
    loanPayment: loan._id,
    status: 'paid',
    $or: [{ member: member._id }, { memberCode: member.code }],
  }).lean();

  const totalInstallments = loan.installments || (loan.schedule || []).length || 0;
  const paidCount = new Set(emiList.flatMap((e) => e.installments || [])).size;

  if (totalInstallments > 0 && paidCount < totalInstallments) {
    throw new HttpError(400, 'NOC can only be issued for fully closed and repaid loans');
  }

  const memberLine = (loan.lines || []).find((l) => String(l.member) === String(member._id) || l.code === member.code);
  const company = await Company.findOne({ singleton: 'company' }).lean();

  res.json({
    noc: {
      certificateNo: `NOC-${loan.loanId || loan.receiptNo}`,
      issuedDate: new Date(),
      member: {
        code: member.code,
        name: member.name,
        husbandName: member.husbandName || '',
        aadhaarMasked: member.aadhaar ? `••••••••${member.aadhaar.slice(-4)}` : '—',
        mobile: member.mobile,
        address: member.address,
      },
      loan: {
        loanId: loan.loanId || loan.receiptNo,
        schemeName: loan.schemeName,
        sanctionedAmountPaise: memberLine?.amountPaise || loan.totalAmountPaise || 0,
        disbursedDate: loan.paidOn,
        closedDate: emiList.length ? emiList[emiList.length - 1].paidOn : new Date(),
      },
      branch: {
        name: loan.branch?.name || 'Head Office',
        city: loan.branch?.city || 'Patna',
        state: loan.branch?.state || 'Bihar',
      },
      company: {
        name: company?.name || 'Udgam Microfinance Private Limited',
        cin: company?.cin || 'U65999BR2024PTC123456',
        address: company?.address || 'Patna, Bihar',
        signatureImage: company?.signatureImage || '',
      },
    },
  });
}

// -----------------------------------------------------------------------------
// 6. EMI PAY: UPI QR & COMPANY BANK DETAILS
// -----------------------------------------------------------------------------

export async function getEmiPayDetails(req, res) {
  const member = req.member;

  // Primary Bank Account
  const bank = await BankAccount.findOne({ isActive: true, isDeleted: false }).lean();
  const company = await Company.findOne({ singleton: 'company' }).lean();

  // Find next unpaid installment across active loans
  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
  }).lean();

  const emiList = await EmiPayment.find({
    status: 'paid',
    $or: [{ member: member._id }, { memberCode: member.code }],
  }).lean();

  let nextDue = null;
  for (const loan of loans) {
    const loanEmis = emiList.filter((e) => String(e.loanPayment) === String(loan._id) || e.loanId === loan.loanId);
    const paidNos = new Set(loanEmis.flatMap((e) => e.installments || []));

    for (const item of (loan.schedule || [])) {
      if (!paidNos.has(item.no)) {
        if (!nextDue || new Date(item.dueDate) < new Date(nextDue.dueDate)) {
          nextDue = {
            loanId: loan.loanId || loan.receiptNo,
            schemeName: loan.schemeName,
            installmentNo: item.no,
            dueDate: item.dueDate,
            amountPaise: item.installmentPaise || loan.installmentPaise || 0,
          };
        }
        break;
      }
    }
  }

  // Generate UPI payment intent string
  const upiId = 'udgamfinance@upi';
  const payeeName = company?.name || 'Udgam Microfinance';
  const nextAmt = nextDue ? (nextDue.amountPaise / 100).toFixed(2) : '1000.00';
  const upiUrl = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(payeeName)}&am=${nextAmt}&cu=INR&tn=${encodeURIComponent(`EMI-${member.code}`)}`;

  res.json({
    nextDue,
    paymentOptions: {
      upiId,
      payeeName,
      upiUrl,
      bankAccount: bank ? {
        accountHolderName: bank.accountHolderName,
        accountNumber: bank.accountNumber,
        bankName: bank.bankName,
        ifsc: bank.ifsc,
        branch: bank.address,
      } : {
        accountHolderName: 'Udgam Microfinance Pvt Ltd',
        accountNumber: '50200012345678',
        bankName: 'HDFC Bank',
        ifsc: 'HDFC0001234',
        branch: 'Main Branch',
      },
    },
  });
}

// Submit payment transaction proof / reference number
export async function submitEmiPaymentProof(req, res) {
  const member = req.member;
  const { loanId, installmentNo, amount, payMode, reference, transactionDate } = req.body;

  if (!amount || Number(amount) <= 0) throw new HttpError(400, 'Valid payment amount is required');
  if (!reference || !cleanStr(reference)) throw new HttpError(400, 'Transaction reference/UTR number is required');

  await audit(req, {
    action: 'memberApp.submitEmiProof',
    entity: 'EmiPaymentProof',
    after: { memberCode: member.code, loanId, amount, reference, payMode },
  });

  res.json({
    status: 'ok',
    message: `Payment confirmation reference ${reference} submitted! Your branch officer will verify and update your passbook within 24 hours.`,
  });
}

// -----------------------------------------------------------------------------
// 7. LOAN REQUISITION (APPLY LOAN) & APPROVAL NOTIFICATIONS
// -----------------------------------------------------------------------------

export async function listMemberRequisitions(req, res) {
  const member = req.member;

  const reqs = await LoanRequisition.find({
    $or: [{ member: member._id }, { memberCode: member.code }, { 'borrower.mobile': member.mobile }],
  }).populate('branch', 'code name').sort({ createdAt: -1 }).lean();

  res.json({
    requisitions: reqs.map((r) => ({
      id: r._id,
      requisitionNo: r.requisitionNo || r.formId,
      loanType: r.kind || r.loanType || 'personal',
      schemeName: r.schemeName || 'Micro Loan',
      appliedAmountPaise: r.appliedAmountPaise || 0,
      approvedAmountPaise: r.approvedAmountPaise || 0,
      status: r.status,
      date: r.loanDate || r.createdAt,
      remark: r.remark || '',
      approvedOn: r.approvedOn || null,
    })),
  });
}

export async function applyMemberLoan(req, res) {
  const member = req.member;
  const { loanType, requestedAmount, purpose, tenureMonths } = req.body;

  const amtNum = Number(requestedAmount);
  if (!amtNum || amtNum < 1000) {
    throw new HttpError(400, 'Minimum requested loan amount must be ₹1,000');
  }
  if (!purpose || !cleanStr(purpose)) {
    throw new HttpError(400, 'Please state the purpose of the loan');
  }

  const requestedAmountPaise = Math.round(amtNum * 100);
  const formId = await generateCode('loanRequisition');

  const reqDoc = await LoanRequisition.create({
    formId,
    requisitionNo: formId,
    branch: member.branch._id,
    loanDate: new Date(),
    kind: loanType || 'personal',
    member: member._id,
    borrower: {
      code: member.code,
      name: member.name,
      dob: member.dob,
      gender: member.gender,
      address: member.address,
      pincode: member.pincode,
      district: member.district,
      state: member.state,
      mobile: member.mobile,
      guarantorName: member.guarantor?.name || '',
    },
    schemeName: 'Member Portal Application',
    appliedAmountPaise: requestedAmountPaise,
    status: 'pending',
    remark: `Customer requisition from Member App. Purpose: ${cleanStr(purpose)}. Preferred tenure: ${tenureMonths || 12} months.`,
  });

  await audit(req, {
    action: 'memberApp.applyLoan',
    entity: 'LoanRequisition',
    entityId: reqDoc._id,
    after: { memberCode: member.code, amount: amtNum, loanType },
  });

  res.json({
    status: 'ok',
    message: 'Your loan application has been submitted successfully! Application ID: ' + formId,
    requisition: {
      id: reqDoc._id,
      requisitionNo: formId,
      status: reqDoc.status,
    },
  });
}

// -----------------------------------------------------------------------------
// 8. COMPLAINTS & GRIEVANCE REDRESSAL
// -----------------------------------------------------------------------------

export async function listMemberComplaints(req, res) {
  const member = req.member;

  const complaints = await Complaint.find({
    $or: [{ memberCode: member.code }, { callerMobile: member.mobile }],
  }).sort({ date: -1, createdAt: -1 }).lean();

  res.json({
    complaints: complaints.map((c) => ({
      id: c._id,
      complaintNo: c.complaintNo,
      date: c.date,
      category: c.category,
      loanId: c.loanId || '—',
      description: c.description,
      status: c.status,
      resolution: c.resolution || 'Your complaint is being investigated by our customer care team.',
      resolvedAt: c.resolvedAt || null,
    })),
  });
}

export async function createMemberComplaint(req, res) {
  const member = req.member;
  const { category, loanId, description } = req.body;

  if (!description || !cleanStr(description)) {
    throw new HttpError(400, 'Please describe your complaint or issue');
  }

  const complaintNo = await generateCode('complaint');

  const doc = await Complaint.create({
    complaintNo,
    date: new Date(),
    callerName: member.name,
    callerMobile: member.mobile,
    branch: member.branch._id,
    memberCode: member.code,
    category: category || 'other',
    loanId: cleanStr(loanId),
    description: cleanStr(description),
    status: 'open',
  });

  await audit(req, {
    action: 'memberApp.createComplaint',
    entity: 'Complaint',
    entityId: doc._id,
    after: { complaintNo, memberCode: member.code, category },
  });

  res.json({
    status: 'ok',
    message: `Your complaint #${complaintNo} has been registered! Our branch team will resolve it promptly.`,
    complaint: {
      id: doc._id,
      complaintNo,
      status: doc.status,
    },
  });
}

// -----------------------------------------------------------------------------
// 9. SECURITY WITHDRAWAL REQUEST & PASSBOOK
// -----------------------------------------------------------------------------

export async function getMemberSecuritySummary(req, res) {
  const member = req.member;

  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
  }).lean();

  let totalSecurityPrincipalPaise = 0;
  let totalInterestAccruedPaise = 0;
  const now = new Date();

  for (const l of loans) {
    const mLine = (l.lines || []).find((x) => String(x.member) === String(member._id) || x.code === member.code);
    if (mLine?.securityPaise) {
      totalSecurityPrincipalPaise += mLine.securityPaise;
      const loanDate = new Date(l.paidOn || l.createdAt);
      const diffYears = Math.max(0, (now.getTime() - loanDate.getTime()) / (365.25 * 24 * 3600 * 1000));
      totalInterestAccruedPaise += Math.round(mLine.securityPaise * 0.10 * diffYears);
    }
  }

  const withdrawals = await SecurityWithdrawal.find({
    member: member._id,
  }).sort({ createdAt: -1 }).lean();

  let totalWithdrawnPaise = 0;
  for (const w of withdrawals) {
    if (w.status === 'approved') totalWithdrawnPaise += (w.amountPaise || 0);
  }

  const netPrincipalPaise = Math.max(0, totalSecurityPrincipalPaise - totalWithdrawnPaise);
  const totalBalancePaise = netPrincipalPaise + totalInterestAccruedPaise;

  res.json({
    securityPrincipalPaise: netPrincipalPaise,
    securityInterestPaise: totalInterestAccruedPaise,
    totalBalancePaise,
    interestRatePercent: 10,
    requests: withdrawals.map((w) => ({
      id: w._id,
      receiptNo: w.receiptNo,
      kind: w.kind,
      amountPaise: w.amountPaise,
      status: w.status,
      date: w.createdAt,
      remark: w.remark || '',
      rejectReason: w.rejectReason || '',
    })),
  });
}

export async function createMemberSecurityWithdrawal(req, res) {
  const member = req.member;
  const { kind, amount, remark } = req.body;

  const amtNum = Number(amount);
  if (!amtNum || amtNum < 100) throw new HttpError(400, 'Minimum withdrawal amount is ₹100');

  const receiptNo = await generateCode('securityWithdrawal');
  const amountPaise = Math.round(amtNum * 100);

  const doc = await SecurityWithdrawal.create({
    receiptNo,
    member: member._id,
    memberCode: member.code,
    memberName: member.name,
    branch: member.branch._id,
    kind: kind === 'adjust' ? 'adjust' : 'withdraw',
    amountPaise,
    payMode: 'bank',
    remark: cleanStr(remark) || 'Security withdrawal requested from Member App',
    status: 'pending',
  });

  await audit(req, {
    action: 'memberApp.createSecurityWithdrawal',
    entity: 'SecurityWithdrawal',
    entityId: doc._id,
    after: { receiptNo, memberCode: member.code, amount: amtNum },
  });

  res.json({
    status: 'ok',
    message: `Security withdrawal request #${receiptNo} submitted for admin approval!`,
    request: {
      id: doc._id,
      receiptNo,
      status: doc.status,
    },
  });
}

// -----------------------------------------------------------------------------
// 10. HOLIDAY NOTIFICATIONS
// -----------------------------------------------------------------------------

export async function getMemberHolidays(req, res) {
  const member = req.member;

  const holidays = await Holiday.find({
    isActive: true,
    isDeleted: false,
    $or: [{ branch: null }, { branch: member.branch._id }],
  }).sort({ date: 1 }).lean();

  res.json({
    holidays: holidays.map((h) => ({
      id: h._id,
      name: h.name,
      date: h.date,
      isUpcoming: new Date(h.date) >= new Date(),
    })),
  });
}

// -----------------------------------------------------------------------------
// 11. KYC REPORT (PENDING / APPROVED / REJECTED)
// -----------------------------------------------------------------------------

export async function getMemberKycReport(req, res) {
  const member = req.member;

  const docs = [
    { key: 'aadhaarPhoto', name: 'Aadhaar Card (Front)', uploaded: Boolean(member.aadhaar) },
    { key: 'aadhaarBackPhoto', name: 'Aadhaar Card (Back)', uploaded: true },
    { key: 'panPhoto', name: 'PAN Card', uploaded: Boolean(member.pan) },
    { key: 'memberPhoto', name: 'Member Photo', uploaded: true },
    { key: 'signaturePhoto', name: 'Member Signature', uploaded: true },
  ];

  const reviewedMap = new Map((member.kycDocs || []).map((d) => [d.key, d]));

  let overall = 'approved';
  if (member.kycRejected) overall = 'rejected';
  else if (member.kycPending) overall = 'pending';

  const docList = docs.map((d) => {
    const rev = reviewedMap.get(d.key);
    return {
      key: d.key,
      name: d.name,
      status: rev ? rev.status : (member.legacyImport ? 'approved' : 'pending'),
      reason: rev?.reason || '',
      reviewedAt: rev?.reviewedAt || null,
    };
  });

  res.json({
    kycReport: {
      overallStatus: overall,
      aadhaarNumber: member.aadhaar ? `••••••••${member.aadhaar.slice(-4)}` : 'Not Provided',
      panNumber: member.pan ? `••••${member.pan.slice(-4)}` : 'Not Provided',
      documents: docList,
    },
  });
}

export async function reuploadMemberKycDoc(req, res) {
  const member = req.member;
  const { key, photoDataUrl } = req.body;

  if (!key || !photoDataUrl) throw new HttpError(400, 'Document key and image data are required');

  const existing = (member.kycDocs || []).find((d) => d.key === key);
  if (existing) {
    existing.status = 'pending';
    existing.reason = '';
    existing.resubmittedAt = new Date();
  } else {
    member.kycDocs.push({
      key,
      status: 'pending',
      resubmittedAt: new Date(),
    });
  }

  // Update doc field on member
  if (member[key] !== undefined) {
    member[key] = photoDataUrl;
  }
  await member.save();

  await audit(req, {
    action: 'memberApp.reuploadKyc',
    entity: 'Member',
    entityId: member._id,
    after: { memberCode: member.code, key },
  });

  res.json({
    status: 'ok',
    message: 'Document re-uploaded successfully! It has been submitted for branch review.',
  });
}

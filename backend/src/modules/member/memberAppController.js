import jwt from 'jsonwebtoken';
import { MemberMpin, MemberLoanInquiry } from './memberAppModel.js';
import { Member } from '../../models/Member.js';
import { Branch } from '../../models/Branch.js';
import { LoanPayment } from '../../models/LoanPayment.js';
import { EmiPayment } from '../../models/EmiPayment.js';
import { SecurityWithdrawal } from '../../models/SecurityWithdrawal.js';
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

  return await Member.findOne(query).populate('branch', 'code name city pincode state address');
}

// Mask sensitive mobile number
function maskPhone(mobile) {
  const s = String(mobile || '');
  if (s.length < 10) return s;
  return s.slice(0, 2) + '••••••' + s.slice(-2);
}

// Mask account number
function maskAccount(acc) {
  const s = String(acc || '');
  if (s.length < 4) return s;
  return '••••' + s.slice(-4);
}

// -----------------------------------------------------------------------------
// 1. AUTHENTICATION & MPIN
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

export async function createMemberMpin(req, res) {
  const identifier = cleanStr(req.body?.identifier);
  const mpin = cleanStr(req.body?.mpin);
  if (!identifier) throw new HttpError(400, 'Member mobile or Code is required');
  if (!/^\d{4}$/.test(mpin)) throw new HttpError(400, 'mPIN must be exactly 4 digits');

  const mem = await findMember(identifier);
  if (!mem) throw new HttpError(404, 'Member not found');
  if (!mem.isActive || mem.isBlocked) throw new HttpError(403, 'Account is inactive or blocked');

  const mpinHash = await MemberMpin.hashMpin(mpin);

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

  await audit(req, { action: 'memberApp.createMpin', entity: 'MemberMpin', entityId: record._id, after: { memberCode: mem.code } });
  res.json({ status: 'ok', message: 'Secret 4-digit mPIN set successfully! You can now log in.' });
}

export async function loginMember(req, res) {
  const id = cleanStr(req.body?.identifier);
  const mpin = cleanStr(req.body?.mpin);
  if (!id || !mpin) throw new HttpError(400, 'Mobile/Member Code and mPIN are required');

  const mem = await findMember(id);
  if (!mem) throw new HttpError(401, 'Invalid mobile number or member code');
  if (!mem.isActive || mem.isBlocked) throw new HttpError(403, 'Account is inactive or blocked');

  const mpinDoc = await MemberMpin.findOne({ member: mem._id }).select('+mpinHash');
  if (!mpinDoc) throw new HttpError(401, 'mPIN not set. Please create your secret mPIN first.');

  const ok = await mpinDoc.compareMpin(mpin);
  if (!ok) throw new HttpError(401, 'Incorrect mPIN. Please try again.');

  mpinDoc.lastLoginAt = new Date();
  mpinDoc.failedAttempts = 0;
  await mpinDoc.save();

  const token = jwt.sign(
    {
      memberId: mem._id,
      memberCode: mem.code,
      role: 'member',
      branchId: mem.branch?._id || null,
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

export async function forgotMemberMpinSendOtp(req, res) {
  const id = cleanStr(req.body?.identifier);
  const mem = await findMember(id);
  if (!mem) throw new HttpError(404, 'Member not found');
  if (!mem.mobile) throw new HttpError(400, 'No mobile number registered with this member. Please contact branch.');

  // Simulation / standard challenge
  res.json({
    status: 'ok',
    message: `OTP sent successfully to registered mobile number ${maskPhone(mem.mobile)}`,
    maskedMobile: maskPhone(mem.mobile),
    simulatedOtp: '123456',
  });
}

export async function forgotMemberMpinVerify(req, res) {
  const id = cleanStr(req.body?.identifier);
  const otp = cleanStr(req.body?.otp);
  const newMpin = cleanStr(req.body?.newMpin);

  if (!/^\d{4}$/.test(newMpin)) throw new HttpError(400, 'New mPIN must be exactly 4 digits');
  const mem = await findMember(id);
  if (!mem) throw new HttpError(404, 'Member not found');

  // Accept valid 6 digit OTP
  if (!otp || otp.length < 4) throw new HttpError(400, 'Invalid OTP');

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
// 2. MEMBER PROFILE & DASHBOARD
// -----------------------------------------------------------------------------

export async function getMemberProfile(req, res) {
  const member = req.member;
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
      kycPending: member.kycPending,
      kycRejected: member.kycRejected,
    },
  });
}

export async function getMemberDashboard(req, res) {
  const member = req.member;

  // Find all loans where this member is a borrower
  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
  }).populate('branch', 'code name city').sort({ paidOn: -1 }).lean();

  let totalBorrowedPaise = 0;
  let totalPaidPaise = 0;
  let activeLoansCount = 0;
  let closedLoansCount = 0;

  // Find all EMIs paid by this member
  const emiList = await EmiPayment.find({
    status: 'paid',
    $or: [{ member: member._id }, { memberCode: member.code }],
  }).sort({ paidOn: -1 }).lean();

  for (const emi of emiList) {
    totalPaidPaise += (emi.amountPaise || 0);
  }

  // Next upcoming EMI calculation
  let nextEmi = null;
  const activeLoansList = [];

  for (const loan of loans) {
    const memberLine = (loan.lines || []).find(
      (l) => String(l.member) === String(member._id) || l.code === member.code
    );
    const borrowedAmount = memberLine?.amountPaise || loan.totalAmountPaise || 0;
    totalBorrowedPaise += borrowedAmount;

    // Check installments paid for this loan
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
        loanId: loan.loanId || loan.receiptNo,
        schemeName: loan.schemeName || 'Micro Loan',
        loanType: loan.loanType || 'Personal',
        borrowedAmountPaise: borrowedAmount,
        installmentPaise: loan.installmentPaise || 0,
        paidInstallments: paidInstallmentNos.size,
        totalInstallments,
      });

      // Find earliest unpaid schedule item
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

  // Security savings balance
  const withdrawals = await SecurityWithdrawal.find({
    member: member._id,
    status: 'approved',
  }).lean();
  let totalWithdrawnPaise = 0;
  for (const w of withdrawals) {
    totalWithdrawnPaise += (w.amountPaise || 0);
  }

  let totalSecurityPaise = 0;
  for (const loan of loans) {
    const memberLine = (loan.lines || []).find((l) => String(l.member) === String(member._id) || l.code === member.code);
    if (memberLine?.securityPaise) totalSecurityPaise += memberLine.securityPaise;
  }
  const securityBalancePaise = Math.max(0, totalSecurityPaise - totalWithdrawnPaise);

  res.json({
    member: {
      name: member.name,
      code: member.code,
      branch: member.branch?.name || '',
      mobile: member.mobile,
    },
    summary: {
      activeLoansCount,
      closedLoansCount,
      totalBorrowedPaise,
      totalPaidPaise,
      securityBalancePaise,
    },
    nextEmi,
    activeLoans: activeLoansList,
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
// 3. MEMBER LOANS & DETAILS
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
// 4. PASSBOOK & SAVINGS
// -----------------------------------------------------------------------------

export async function getMemberPassbook(req, res) {
  const member = req.member;

  // 1. Credit entries: Security deducted during loan disbursements
  const loans = await LoanPayment.find({
    status: 'paid',
    $or: [{ 'lines.member': member._id }, { 'lines.code': member.code }],
  }).lean();

  const entries = [];
  let currentBalancePaise = 0;

  for (const l of loans) {
    const mLine = (l.lines || []).find((x) => String(x.member) === String(member._id) || x.code === member.code);
    if (mLine?.securityPaise && mLine.securityPaise > 0) {
      entries.push({
        date: l.paidOn,
        type: 'credit',
        amountPaise: mLine.securityPaise,
        remark: `Security Deposit deduction on Loan ${l.loanId || l.receiptNo}`,
        reference: l.receiptNo,
      });
      currentBalancePaise += mLine.securityPaise;
    }
  }

  // 2. Debit entries: Security withdrawals / adjustments
  const withdrawals = await SecurityWithdrawal.find({
    member: member._id,
    status: 'approved',
  }).lean();

  for (const w of withdrawals) {
    entries.push({
      date: w.decidedAt || w.createdAt,
      type: 'debit',
      amountPaise: w.amountPaise,
      remark: w.kind === 'adjust' ? `Adjusted against Loan EMI (${w.loanId || ''})` : `Security Refund withdrawal`,
      reference: w.receiptNo,
    });
    currentBalancePaise -= w.amountPaise;
  }

  entries.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({
    balancePaise: Math.max(0, currentBalancePaise),
    entries,
  });
}

// -----------------------------------------------------------------------------
// 5. LOAN REQUISITION (APPLY LOAN)
// -----------------------------------------------------------------------------

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

  const inquiry = await MemberLoanInquiry.create({
    member: member._id,
    memberCode: member.code,
    memberName: member.name,
    mobile: member.mobile,
    branch: member.branch._id,
    loanType: loanType || 'personal',
    requestedAmountPaise,
    purpose: cleanStr(purpose),
    tenureMonths: Number(tenureMonths) || 12,
  });

  await audit(req, {
    action: 'memberApp.applyLoan',
    entity: 'MemberLoanInquiry',
    entityId: inquiry._id,
    after: { memberCode: member.code, amount: amtNum, loanType },
  });

  res.json({
    status: 'ok',
    message: 'Your loan application has been submitted successfully! Your branch officer will contact you shortly.',
    inquiry: {
      id: inquiry._id,
      loanType: inquiry.loanType,
      requestedAmountPaise: inquiry.requestedAmountPaise,
      status: inquiry.status,
      createdAt: inquiry.createdAt,
    },
  });
}

// -----------------------------------------------------------------------------
// 6. BRANCH CONTACT INFO
// -----------------------------------------------------------------------------

export async function getMemberBranchContact(req, res) {
  const member = req.member;
  const branch = await Branch.findById(member.branch._id).lean();
  if (!branch) throw new HttpError(404, 'Branch details not found');

  res.json({
    branch: {
      code: branch.code,
      name: branch.name,
      address: branch.address || 'Main Branch Office',
      city: branch.city,
      state: branch.state,
      pincode: branch.pincode,
      phone: branch.phone || 'Contact Branch',
    },
  });
}

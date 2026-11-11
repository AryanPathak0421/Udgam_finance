import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { Member } from '../../models/Member.js';
import { asyncHandler as h } from '../../utils/http.js';
import {
  lookupMember,
  registerMemberMpin,
  loginWithMpin,
  sendLoginOtp,
  verifyLoginOtp,
  forgotMemberMpinSendOtp,
  forgotMemberMpinVerify,
  getMemberProfile,
  getMemberDashboard,
  getMemberSynopsis,
  getMemberLoans,
  getMemberLoanDetail,
  getMemberLoanNoc,
  getEmiPayDetails,
  submitEmiPaymentProof,
  listMemberRequisitions,
  applyMemberLoan,
  listMemberComplaints,
  createMemberComplaint,
  getMemberSecuritySummary,
  createMemberSecurityWithdrawal,
  getMemberHolidays,
  getMemberKycReport,
  reuploadMemberKycDoc,
} from './memberAppController.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-udgam-2026';

// Member authentication middleware
export async function requireMemberAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const token = bearer || req.cookies?.udgam_member_token || req.cookies?.token || req.cookies?.udgam_token;

    if (!token) return res.status(401).json({ message: 'Member not signed in' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ message: 'Session expired or invalid. Please sign in again.' });
    }

    const memberId = decoded.memberId || (decoded.role === 'member' ? decoded.id : null);
    if (!memberId && !decoded.memberCode) {
      return res.status(401).json({ message: 'Invalid member session' });
    }

    let member = null;
    if (memberId) {
      member = await Member.findOne({ _id: memberId, isDeleted: false })
        .populate('branch', 'code name city pincode state address phone');
    } else if (decoded.memberCode) {
      member = await Member.findOne({ code: decoded.memberCode, isDeleted: false })
        .populate('branch', 'code name city pincode state address phone');
    }

    if (!member || !member.isActive) {
      return res.status(403).json({ message: 'Member account is inactive or not found' });
    }
    if (member.isBlocked) {
      return res.status(403).json({ message: 'Member account is blocked. Please visit your branch.' });
    }

    req.member = member;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Session expired or invalid. Please sign in again.' });
  }
}

const router = Router();

// 1. Public Auth Routes
router.post('/auth/lookup', h(lookupMember));
router.post('/auth/register', h(registerMemberMpin));
router.post('/auth/login', h(loginWithMpin));
router.post('/auth/logout', (req, res) => {
  res.clearCookie('udgam_member_token');
  res.json({ status: 'ok', message: 'Signed out successfully' });
});
router.post('/auth/login-otp/send', h(sendLoginOtp));
router.post('/auth/login-otp/verify', h(verifyLoginOtp));
router.post('/auth/forgot-mpin/send-otp', h(forgotMemberMpinSendOtp));
router.post('/auth/forgot-mpin/reset', h(forgotMemberMpinVerify));

// 2. Protected Member Core Routes
router.get('/profile', requireMemberAuth, h(getMemberProfile));
router.get('/dashboard', requireMemberAuth, h(getMemberDashboard));
router.get('/synopsis', requireMemberAuth, h(getMemberSynopsis));

// 3. Loans & Deep Tracking & NOC
router.get('/loans', requireMemberAuth, h(getMemberLoans));
router.get('/loans/:id', requireMemberAuth, h(getMemberLoanDetail));
router.get('/loans/:id/noc', requireMemberAuth, h(getMemberLoanNoc));

// 4. EMI Pay
router.get('/emi-pay/details', requireMemberAuth, h(getEmiPayDetails));
router.post('/emi-pay/submit-proof', requireMemberAuth, h(submitEmiPaymentProof));

// 5. Loan Requisitions & Approval Notifications
router.get('/requisitions', requireMemberAuth, h(listMemberRequisitions));
router.post('/requisitions', requireMemberAuth, h(applyMemberLoan));
router.post('/apply-loan', requireMemberAuth, h(applyMemberLoan));

// 6. Complaints & Grievance
router.get('/complaints', requireMemberAuth, h(listMemberComplaints));
router.post('/complaints', requireMemberAuth, h(createMemberComplaint));

// 7. Security Deposit & Passbook & Withdrawal
router.get('/security/summary', requireMemberAuth, h(getMemberSecuritySummary));
router.get('/passbook', requireMemberAuth, h(getMemberSecuritySummary));
router.post('/security/withdraw', requireMemberAuth, h(createMemberSecurityWithdrawal));

// 8. Holidays & KYC
router.get('/holidays', requireMemberAuth, h(getMemberHolidays));
router.get('/kyc', requireMemberAuth, h(getMemberKycReport));
router.post('/kyc/reupload', requireMemberAuth, h(reuploadMemberKycDoc));

export default router;

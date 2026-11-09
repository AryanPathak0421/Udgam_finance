import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { Member } from '../../models/Member.js';
import { asyncHandler as h } from '../../utils/http.js';
import {
  lookupMember,
  createMemberMpin,
  loginMember,
  forgotMemberMpinSendOtp,
  forgotMemberMpinVerify,
  getMemberProfile,
  getMemberDashboard,
  getMemberLoans,
  getMemberLoanDetail,
  getMemberPassbook,
  applyMemberLoan,
  getMemberBranchContact,
} from './memberAppController.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-udgam-2026';

// Member authentication middleware
export async function requireMemberAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const token = bearer || req.cookies?.token || req.cookies?.udgam_token;

    if (!token) return res.status(401).json({ message: 'Member not signed in' });

    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.memberId) return res.status(401).json({ message: 'Invalid member session' });

    const member = await Member.findOne({ _id: decoded.memberId, isDeleted: false })
      .populate('branch', 'code name city pincode state address phone');

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

// Public auth routes
router.post('/auth/lookup', h(lookupMember));
router.post('/auth/create-mpin', h(createMemberMpin));
router.post('/auth/login', h(loginMember));
router.post('/auth/forgot-mpin/send-otp', h(forgotMemberMpinSendOtp));
router.post('/auth/forgot-mpin/reset', h(forgotMemberMpinVerify));

// Protected member routes
router.get('/profile', requireMemberAuth, h(getMemberProfile));
router.get('/dashboard', requireMemberAuth, h(getMemberDashboard));
router.get('/loans', requireMemberAuth, h(getMemberLoans));
router.get('/loans/:id', requireMemberAuth, h(getMemberLoanDetail));
router.get('/passbook', requireMemberAuth, h(getMemberPassbook));
router.post('/apply-loan', requireMemberAuth, h(applyMemberLoan));
router.get('/branch-contact', requireMemberAuth, h(getMemberBranchContact));

export default router;

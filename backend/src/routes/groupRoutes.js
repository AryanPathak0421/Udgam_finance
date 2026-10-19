import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import {
  listGroups,
  groupBranchOptions,
  createGroup,
  updateGroup,
  setGroupStatus,
  deleteGroup,
  listDisbursements,
  saveDisbursement,
  getGroup,
  memberCandidates,
  addGroupMembers,
  removeGroupMember,
} from '../controllers/groupController.js';
import { report, generate, sendOtp, verifyOtp, dueByGroup, sendDueOtp, payDue } from '../controllers/groupLeaderCommissionController.js';
import { verifyOtp as verifyChallenge } from '../controllers/memberController.js';

const router = Router();

const READ = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];
const MANAGE = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];
// Everything that changes the group master itself, and the loan disbursement entry, is admin only.
const ADMIN = ['super_admin', 'admin'];
const FINANCE = ['super_admin', 'admin', 'accountant'];
const REPORT = ['super_admin', 'admin', 'branch_manager', 'accountant', 'viewer'];

const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });

// Groups
router.get('/groups', requireAuth, requireRole(...READ), h(listGroups));
router.get('/groups/branch-options', requireAuth, requireRole(...MANAGE), h(groupBranchOptions));
router.get('/groups/member-candidates', requireAuth, requireRole(...MANAGE), h(memberCandidates));
router.get('/groups/:id', requireAuth, requireRole(...READ), h(getGroup));
router.post('/groups/:id/members', requireAuth, requireRole(...MANAGE), h(addGroupMembers));
router.delete('/groups/:id/members/:memberId', requireAuth, requireRole(...MANAGE), h(removeGroupMember));
router.post('/groups', requireAuth, requireRole(...MANAGE), h(createGroup));
router.put('/groups/:id', requireAuth, requireRole(...ADMIN), h(updateGroup));
router.patch('/groups/:id/status', requireAuth, requireRole(...ADMIN), h(setGroupStatus));
router.delete('/groups/:id', requireAuth, requireRole(...ADMIN), h(deleteGroup));
router.get('/groups/:id/disbursements', requireAuth, requireRole(...ADMIN), h(listDisbursements));
router.put('/groups/:id/disbursements', requireAuth, requireRole(...ADMIN), h(saveDisbursement));

// Group leader commission: report, generation, OTP deposit
router.get('/group-leader-commission', requireAuth, requireRole(...REPORT), h(report));
router.post('/group-leader-commission/generate', requireAuth, requireRole(...FINANCE), h(generate));
// due commission of a group, paid with one OTP
router.get('/group-leader-commission/due', requireAuth, requireRole(...REPORT), h(dueByGroup));
router.post('/group-leader-commission/pay/send-otp', requireAuth, requireRole(...FINANCE), otpLimiter, h(sendDueOtp));
router.post('/group-leader-commission/pay/verify-otp', requireAuth, requireRole(...FINANCE), otpLimiter, h(verifyChallenge));
router.post('/group-leader-commission/pay', requireAuth, requireRole(...FINANCE), otpLimiter, h(payDue));
router.post('/group-leader-commission/:id/send-otp', requireAuth, requireRole(...FINANCE), otpLimiter, h(sendOtp));
router.post('/group-leader-commission/:id/verify-otp', requireAuth, requireRole(...FINANCE), otpLimiter, h(verifyOtp));

export default router;

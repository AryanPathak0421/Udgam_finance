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
} from '../controllers/groupController.js';
import { report, generate, sendOtp, verifyOtp } from '../controllers/groupLeaderCommissionController.js';

const router = Router();

const READ = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];
const MANAGE = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];
const FINANCE = ['super_admin', 'admin', 'accountant'];
const REPORT = ['super_admin', 'admin', 'branch_manager', 'accountant', 'viewer'];

const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });

// Groups
router.get('/groups', requireAuth, requireRole(...READ), h(listGroups));
router.get('/groups/branch-options', requireAuth, requireRole(...MANAGE), h(groupBranchOptions));
router.post('/groups', requireAuth, requireRole(...MANAGE), h(createGroup));
router.put('/groups/:id', requireAuth, requireRole(...MANAGE), h(updateGroup));
router.patch('/groups/:id/status', requireAuth, requireRole(...MANAGE), h(setGroupStatus));
router.delete('/groups/:id', requireAuth, requireRole('super_admin', 'admin', 'branch_manager'), h(deleteGroup));
router.get('/groups/:id/disbursements', requireAuth, requireRole(...READ), h(listDisbursements));
router.put('/groups/:id/disbursements', requireAuth, requireRole(...MANAGE), h(saveDisbursement));

// Group leader commission: report, generation, OTP deposit
router.get('/group-leader-commission', requireAuth, requireRole(...REPORT), h(report));
router.post('/group-leader-commission/generate', requireAuth, requireRole(...FINANCE), h(generate));
router.post('/group-leader-commission/:id/send-otp', requireAuth, requireRole(...FINANCE), otpLimiter, h(sendOtp));
router.post('/group-leader-commission/:id/verify-otp', requireAuth, requireRole(...FINANCE), otpLimiter, h(verifyOtp));

export default router;

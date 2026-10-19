import { Router } from 'express';
import { requireAuth, requireMenu, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { depositList, memberSavings, requestWithdrawal, withdrawalList, approveWithdrawal, rejectWithdrawal, sendWithdrawalOtp, verifyWithdrawalOtp } from '../controllers/savingsController.js';

const router = Router();
const REQUEST = ['super_admin', 'admin', 'branch_manager', 'accountant']; // who can ask for a withdrawal
const READ = [...REQUEST, 'loan_officer', 'field_officer', 'collection_officer', 'viewer'];

router.get('/savings/deposits', requireAuth, requireRole(...READ), h(depositList));
router.get('/savings/members/:id', requireAuth, requireRole(...READ), h(memberSavings));
router.get('/savings/withdrawals', requireAuth, requireRole(...READ), h(withdrawalList));
router.post('/savings/withdrawals', requireAuth, requireRole(...REQUEST), h(requestWithdrawal));
// Security Approval: admins, and the ranks that have the menu ticked in Menu Permission (e.g. a supervisor)
const APPROVAL = '/savings/approval';
router.post('/savings/withdrawals/:id/approve', requireAuth, requireMenu(APPROVAL, 'view'), h(approveWithdrawal));
router.post('/savings/withdrawals/:id/reject', requireAuth, requireMenu(APPROVAL, 'view'), h(rejectWithdrawal));
router.post('/savings/withdrawals/:id/send-otp', requireAuth, requireRole(...REQUEST), h(sendWithdrawalOtp));
router.post('/savings/withdrawals/:id/verify-otp', requireAuth, requireRole(...REQUEST), h(verifyWithdrawalOtp));

export default router;

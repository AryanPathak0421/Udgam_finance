import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { memberChecks, addCheck, deleteCheck, getSettings, saveSettings, bureauSendOtp, bureauFetch } from '../controllers/civilCheckController.js';
import { verifyOtp as verifyChallenge } from '../controllers/memberController.js';

const router = Router();

const READ = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];
const CREATE = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];

const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
// the score from the bureau: PAN number + OTP of the phone number
router.post('/civil-checks/bureau/send-otp', requireAuth, requireRole(...CREATE), otpLimiter, h(bureauSendOtp));
router.post('/civil-checks/bureau/verify-otp', requireAuth, requireRole(...CREATE), otpLimiter, h(verifyChallenge));
router.post('/civil-checks/bureau/fetch', requireAuth, requireRole(...CREATE), otpLimiter, h(bureauFetch));
router.get('/civil-checks/settings', requireAuth, requireRole(...READ), h(getSettings));
router.put('/civil-checks/settings', requireAuth, requireRole('super_admin', 'admin'), h(saveSettings));
router.get('/civil-checks/member/:memberId', requireAuth, requireRole(...READ), h(memberChecks));
router.post('/civil-checks', requireAuth, requireRole(...CREATE), h(addCheck));
router.delete('/civil-checks/:id', requireAuth, requireRole('super_admin', 'admin'), h(deleteCheck));

export default router;

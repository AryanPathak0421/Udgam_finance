import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { memberOptions, districts, sendOtp, verifyOtp, createMember, listMembers, getMember, savePerson, employeeOptions } from '../controllers/memberController.js';

const router = Router();

const READ = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];
const CREATE = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];

const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

router.get('/members/options', requireAuth, requireRole(...CREATE), memberOptions);
router.get('/members/employees', requireAuth, requireRole(...CREATE), h(employeeOptions));
router.get('/members/districts', requireAuth, requireRole(...CREATE), districts);
router.post('/members/otp/send', requireAuth, requireRole(...CREATE), otpLimiter, h(sendOtp));
router.post('/members/otp/verify', requireAuth, requireRole(...CREATE), otpLimiter, h(verifyOtp));
router.get('/members', requireAuth, requireRole(...READ), h(listMembers));
router.post('/members', requireAuth, requireRole(...CREATE), h(createMember));
router.put('/members/:id/guarantor', requireAuth, requireRole(...CREATE), h(savePerson('guarantor')));
router.put('/members/:id/nominee', requireAuth, requireRole(...CREATE), h(savePerson('nominee')));
router.get('/members/:id', requireAuth, requireRole(...READ), h(getMember));

export default router;

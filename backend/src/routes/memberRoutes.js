import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireMenu, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { checkAccount, memberOptions, districts, sendOtp, verifyOtp, createMember, listMembers, getMember, savePerson, employeeOptions, changeGuarantor, setBlocked, synopsis, updateMember, completeMember, pincodeInfo, ifscInfo, listKyc, getKyc, reviewKyc, reuploadKyc } from '../controllers/memberController.js';

const router = Router();

const READ = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];
const CREATE = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];

const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

router.get('/members/options', requireAuth, requireRole(...CREATE), memberOptions);
router.get('/members/employees', requireAuth, requireRole(...CREATE), h(employeeOptions));
router.get('/members/check-account', requireAuth, requireRole(...CREATE), h(checkAccount));
router.get('/members/lookup/pincode/:pin', requireAuth, requireRole(...CREATE), h(pincodeInfo));
router.get('/members/lookup/ifsc/:code', requireAuth, requireRole(...CREATE), h(ifscInfo));
router.get('/members/districts', requireAuth, requireRole(...CREATE), districts);
router.post('/members/otp/send', requireAuth, requireRole(...CREATE), otpLimiter, h(sendOtp));
router.post('/members/otp/verify', requireAuth, requireRole(...CREATE), otpLimiter, h(verifyOtp));
router.get('/members', requireAuth, requireRole(...READ), h(listMembers));
router.post('/members', requireAuth, requireRole(...CREATE), h(createMember));
router.put('/members/:id/guarantor', requireAuth, requireRole(...CREATE), h(savePerson('guarantor')));
router.put('/members/:id/nominee', requireAuth, requireRole(...CREATE), h(savePerson('nominee')));
const APPROVERS = ['super_admin', 'admin', 'branch_manager'];
const REVIEWERS = ['super_admin', 'admin']; // KYC approve / reject: admin only
router.get('/members/kyc', requireAuth, requireRole(...READ), h(listKyc));
router.get('/members/:id/kyc', requireAuth, requireRole(...READ), h(getKyc));
router.post('/members/:id/kyc/review', requireAuth, requireRole(...REVIEWERS), h(reviewKyc));
router.post('/members/:id/kyc/reupload', requireAuth, requireRole(...CREATE), h(reuploadKyc));
// guarantor change: admins, and the ranks that have the Guarantor Change menu ticked in Menu Permission
router.put('/members/:id/guarantor/change', requireAuth, requireMenu('/members/guarantor-change', 'view'), h(changeGuarantor));
router.get('/members/:id/synopsis', requireAuth, requireRole(...READ), h(synopsis));
router.post('/members/:id/block', requireAuth, requireRole(...APPROVERS), h(setBlocked));
router.put('/members/:id/complete', requireAuth, requireRole(...CREATE), h(completeMember));
router.put('/members/:id', requireAuth, requireRole('super_admin', 'admin'), h(updateMember));
router.get('/members/:id', requireAuth, requireRole(...READ), h(getMember));

export default router;

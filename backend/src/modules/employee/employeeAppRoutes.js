import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../utils/http.js';
import {
  lookupEmployee,
  createMpin,
  loginWithMpin,
  forgotMpinSendOtp,
  forgotMpinVerifyAndReset,
  getEmployeeProfile,
  rateEmployee,
  getDashboard,
  getTodayCollectionHistory,
  getTodayDueList,
  sendMemberOtp,
  verifyMemberOtp,
  registerMember,
  getMemberKyc,
  reuploadMemberKycDoc,
  requestGuarantorChange,
  listGuarantorRequests,
  decideGuarantorChange,
  getMemberSynopsis,
  calculateLoanEmi,
  createLoanRequisition,
  listEmployeeRequisitions,
} from './employeeAppController.js';

const router = Router();

// Public routes for Employee App Auth
router.post('/auth/lookup', h(lookupEmployee));
router.post('/auth/create-mpin', h(createMpin));
router.post('/auth/login', h(loginWithMpin));
router.post('/auth/forgot-mpin/send-otp', h(forgotMpinSendOtp));
router.post('/auth/forgot-mpin/verify', h(forgotMpinVerifyAndReset));
router.post('/calculator/public', h(calculateLoanEmi));

// Protected Employee App routes
router.get('/profile', requireAuth, h(getEmployeeProfile));
router.post('/profile/rate', requireAuth, h(rateEmployee));
router.get('/dashboard', requireAuth, h(getDashboard));
router.get('/collections/today', requireAuth, h(getTodayCollectionHistory));
router.get('/collections/due', requireAuth, h(getTodayDueList));

// Member Registration (Phone OTP first) & KYC
router.post('/members/send-otp', requireAuth, h(sendMemberOtp));
router.post('/members/verify-otp', requireAuth, h(verifyMemberOtp));
router.post('/members/register', requireAuth, h(registerMember));
router.get('/members/:id/kyc', requireAuth, h(getMemberKyc));
router.post('/members/:id/kyc/reupload', requireAuth, h(reuploadMemberKycDoc));

// Guarantor Change
router.post('/members/guarantor-change', requireAuth, h(requestGuarantorChange));
router.get('/members/guarantor-requests', requireAuth, h(listGuarantorRequests));
router.post('/members/guarantor-requests/:id/decide', requireAuth, h(decideGuarantorChange));

// Member Detail / Synopsis
router.get('/members/synopsis/:query', requireAuth, h(getMemberSynopsis));

// Loan Calculator & Requisitions
router.post('/calculator', requireAuth, h(calculateLoanEmi));
router.post('/requisitions', requireAuth, h(createLoanRequisition));
router.get('/requisitions', requireAuth, h(listEmployeeRequisitions));

export default router;

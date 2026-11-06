import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../utils/http.js';
import {
  lookupSupervisor,
  createMpin,
  loginWithMpin,
  forgotMpinSendOtp,
  forgotMpinVerifyAndReset,
  getSupervisorProfile,
  getSupervisorDashboard,
  getSupervisorTodayDue,
  getSupervisorCollectionPaid,
  getSupervisorNewMemberReport,
  getSupervisorNpaOverview,
  getSupervisorStaffAttendance,
  getSupervisorSalarySlips,
} from './supervisorAppController.js';

const router = Router();

// Public auth routes
router.post('/auth/lookup', h(lookupSupervisor));
router.post('/auth/create-mpin', h(createMpin));
router.post('/auth/login', h(loginWithMpin));
router.post('/auth/forgot-mpin/send-otp', h(forgotMpinSendOtp));
router.post('/auth/forgot-mpin/reset', h(forgotMpinVerifyAndReset));

// Protected supervisor routes
router.get('/profile', requireAuth, h(getSupervisorProfile));
router.get('/dashboard', requireAuth, h(getSupervisorDashboard));
router.get('/today-due', requireAuth, h(getSupervisorTodayDue));
router.get('/collection-paid', requireAuth, h(getSupervisorCollectionPaid));
router.get('/new-member-report', requireAuth, h(getSupervisorNewMemberReport));
router.get('/npa-overview', requireAuth, h(getSupervisorNpaOverview));
router.get('/staff-attendance', requireAuth, h(getSupervisorStaffAttendance));
router.get('/salary-slips', requireAuth, h(getSupervisorSalarySlips));

export default router;

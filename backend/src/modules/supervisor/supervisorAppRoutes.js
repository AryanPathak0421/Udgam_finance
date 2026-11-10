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
  recoverNpaLoan,
  getSupervisorStaffAttendance,
  getSupervisorSalarySlips,
  markSupervisorFirstMeetingAttendance,
  getPersonalAttendance,
  getTeamAttendance,
  getTeamCenterVisits,
  updateCenterVisitStatus,
  getStaffLeaves,
  decideStaffLeave,
  submitSupervisorComplaint,
  getComplaintsReport,
  submitSupervisorResignation,
  getResignationsReport,
  getBranchTransferReport,
  getProductSalesReport,
  rateStaffMember,
  getStaffRatingsList,
  recordSupervisorCenterVisit,
  submitStaffRequisition,
  listStaffRequisitions,
  getSupervisedEmployeesList,
  getEmployeeFullDossier,
  getSupervisorNotifications,
  dismissSupervisorNotification,
  getSupervisorTasks,
  createSupervisorTask,
  updateSupervisorTaskStatus,
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
router.post('/npa/recover', requireAuth, h(recoverNpaLoan));
router.get('/staff-attendance', requireAuth, h(getSupervisorStaffAttendance));
router.get('/salary-slips', requireAuth, h(getSupervisorSalarySlips));

// Items 20 - 30 routes
router.post('/attendance/meeting', requireAuth, h(markSupervisorFirstMeetingAttendance));
router.get('/attendance/personal', requireAuth, h(getPersonalAttendance));
router.get('/attendance/team', requireAuth, h(getTeamAttendance));
router.get('/center-visits/team-requests', requireAuth, h(getTeamCenterVisits));
router.patch('/center-visits/:id/status', requireAuth, h(updateCenterVisitStatus));
router.post('/center-visits/:id/status', requireAuth, h(updateCenterVisitStatus));
router.post('/center-visits/report', requireAuth, h(recordSupervisorCenterVisit));

router.get('/leaves', requireAuth, h(getStaffLeaves));
router.post('/leaves/:id/decide', requireAuth, h(decideStaffLeave));

router.post('/complaints', requireAuth, h(submitSupervisorComplaint));
router.get('/complaints/report', requireAuth, h(getComplaintsReport));

router.post('/resignation', requireAuth, h(submitSupervisorResignation));
router.get('/resignations/report', requireAuth, h(getResignationsReport));

router.get('/branch-transfers/report', requireAuth, h(getBranchTransferReport));
router.get('/products/sales-report', requireAuth, h(getProductSalesReport));

router.post('/staff/rate', requireAuth, h(rateStaffMember));
router.get('/staff/ratings', requireAuth, h(getStaffRatingsList));

router.post('/staff-requisition', requireAuth, h(submitStaffRequisition));
router.get('/staff-requisition', requireAuth, h(listStaffRequisitions));

// Staff All Data & Dossier (Sheet Point 1)
router.get('/staff', requireAuth, h(getSupervisedEmployeesList));
router.get('/staff/:id/dossier', requireAuth, h(getEmployeeFullDossier));

// Notifications (Sheet Point 2)
router.get('/notifications', requireAuth, h(getSupervisorNotifications));
router.post('/notifications/dismiss', requireAuth, h(dismissSupervisorNotification));

// Tasks: Pending & Completed (Sheet Point 3)
router.get('/tasks', requireAuth, h(getSupervisorTasks));
router.post('/tasks', requireAuth, h(createSupervisorTask));
router.patch('/tasks/:id', requireAuth, h(updateSupervisorTaskStatus));

export default router;

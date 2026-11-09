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
  getCollectionHistory,
  getTodayDueList,
  collectTodayDue,
  sendMemberOtp,
  verifyMemberOtp,
  registerMember,
  getMemberKyc,
  reuploadMemberKycDoc,
  rejectMemberKycDoc,
  sendMemberPhoneChangeOtp,
  verifyMemberPhoneChange,
  sendGuarantorOtp,
  verifyGuarantorOtp,
  requestGuarantorChange,
  listGuarantorRequests,
  decideGuarantorChange,
  getMemberGuarantorAndNominee,
  saveGuarantorAndNominee,
  getMemberSynopsis,
  getEmployeeLoanSchemes,
  calculateLoanEmi,
  createLoanRequisition,
  listEmployeeRequisitions,
  trackLoanHistory,
  getEmiGroups,
  getGroupEmiMembers,
  collectBulkEmi,
  getIndividualLoans,
  advancePayment,
  getNpaLoans,
  recoverNpaLoan,
  getCompanyQr,
  getBorrowerSavings,
  requestSavingsWithdrawal,
  getEmployeeReports,
  getStaffGroups,
  getStaffRecentMembers,
  markFirstMeetingAttendance,
  getSalarySlips,
  getAttendanceHistory,
  recordCenterVisit,
  listCenterVisits,
  listCgtVisits,
  updateCgtDayPhoto,
  getLeaveOverview,
  applyLeave,
  submitComplaint,
  listMyComplaints,
  submitResignation,
  getResignationStatus,
  requestBranchTransfer,
  listTransferRequests,
  getBranchStockProducts,
  sellStockProduct,
  getMyTasks,
  updateTaskStatus,
  getHolidays,
  getAttendanceTiming,
  checkCivilScore,
  addCivilCheckedMember,
  getEmployeeNotifications,
  markEmployeeNotificationRead,
  submitDeathRequest,
  listDeathRequests,
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
router.get('/collections/today', requireAuth, h(getCollectionHistory));
router.get('/collections/due', requireAuth, h(getTodayDueList));
router.post('/collections/due/collect', requireAuth, h(collectTodayDue));

// Member Registration (Phone OTP first) & KYC
router.post('/members/send-otp', requireAuth, h(sendMemberOtp));
router.post('/members/verify-otp', requireAuth, h(verifyMemberOtp));
router.post('/members/register', requireAuth, h(registerMember));
router.get('/members/recent', requireAuth, h(getStaffRecentMembers));
router.get('/members/:id/kyc', requireAuth, h(getMemberKyc));
router.post('/members/:id/kyc/reupload', requireAuth, h(reuploadMemberKycDoc));
router.post('/members/:id/kyc/reject', requireAuth, h(rejectMemberKycDoc));
router.post('/members/:id/phone/send-otp', requireAuth, h(sendMemberPhoneChangeOtp));
router.post('/members/:id/phone/verify-change', requireAuth, h(verifyMemberPhoneChange));
router.get('/groups', requireAuth, h(getStaffGroups));

// Guarantor & Nominee Details Module (Item 8)
router.get('/members/:id/guarantor-nominee', requireAuth, h(getMemberGuarantorAndNominee));
router.post('/members/guarantor-nominee/save', requireAuth, h(saveGuarantorAndNominee));

// Guarantor Change & Verification
router.post('/members/guarantor/send-otp', requireAuth, h(sendGuarantorOtp));
router.post('/members/guarantor/verify-otp', requireAuth, h(verifyGuarantorOtp));
router.post('/members/guarantor-change', requireAuth, h(requestGuarantorChange));
router.get('/members/guarantor-requests', requireAuth, h(listGuarantorRequests));
router.post('/members/guarantor-requests/:id/decide', requireAuth, h(decideGuarantorChange));

// Member Detail / Synopsis
router.get('/members/synopsis/:query', requireAuth, h(getMemberSynopsis));

// Loan Schemes, Calculator & Requisitions
router.get('/loan-schemes', requireAuth, h(getEmployeeLoanSchemes));
router.post('/calculator', requireAuth, h(calculateLoanEmi));
router.post('/requisitions', requireAuth, h(createLoanRequisition));
router.get('/requisitions', requireAuth, h(listEmployeeRequisitions));

// Track Loan History Loan ID Wise
router.get('/loans/track/:loanId', requireAuth, h(trackLoanHistory));

// EMI Payment - Group & Individual (Daily, Weekly, Monthly)
router.get('/emi/groups', requireAuth, h(getEmiGroups));
router.get('/emi/groups/:groupCode/members', requireAuth, h(getGroupEmiMembers));
router.post('/emi/collect-bulk', requireAuth, h(collectBulkEmi));
router.get('/emi/individual-loans', requireAuth, h(getIndividualLoans));

// Advance Payment
router.post('/advance-payment', requireAuth, h(advancePayment));

// NPA Recovery
router.get('/npa/loans', requireAuth, h(getNpaLoans));
router.post('/npa/recover', requireAuth, h(recoverNpaLoan));

// Dynamic Company UPI QR Code
router.get('/company-qr', requireAuth, h(getCompanyQr));

// 16. Borrower Savings & Withdrawal
router.get('/savings/:query', requireAuth, h(getBorrowerSavings));
router.post('/savings/withdraw', requireAuth, h(requestSavingsWithdrawal));

// 17. Employee Reports & Targets
router.get('/reports', requireAuth, h(getEmployeeReports));

// 18 & 20. Attendance (First Meeting & History)
router.get('/attendance/timing', requireAuth, h(getAttendanceTiming));
router.post('/attendance/meeting', requireAuth, h(markFirstMeetingAttendance));
router.get('/attendance/history', requireAuth, h(getAttendanceHistory));

// 19. Salary Slips
router.get('/salary-slips', requireAuth, h(getSalarySlips));

// 21 & 22. New Center Visit & CGT
router.post('/center-visits', requireAuth, h(recordCenterVisit));
router.get('/center-visits', requireAuth, h(listCenterVisits));
router.get('/cgt-visits', requireAuth, h(listCgtVisits));
router.post('/cgt-visits/photo', requireAuth, h(updateCgtDayPhoto));

// 23. Leave Management
router.get('/leave', requireAuth, h(getLeaveOverview));
router.post('/leave', requireAuth, h(applyLeave));

// 24. Complaints
router.post('/complaints', requireAuth, h(submitComplaint));
router.get('/complaints', requireAuth, h(listMyComplaints));

// 25. Resignation
router.post('/resignation', requireAuth, h(submitResignation));
router.get('/resignation', requireAuth, h(getResignationStatus));

// 26. Branch Transfer
router.post('/branch-transfer', requireAuth, h(requestBranchTransfer));
router.get('/branch-transfer', requireAuth, h(listTransferRequests));

// 27. Product Sale
router.get('/stock/products', requireAuth, h(getBranchStockProducts));
router.post('/stock/sell', requireAuth, h(sellStockProduct));

// 28. Tasks
router.get('/tasks', requireAuth, h(getMyTasks));
router.patch('/tasks/:id', requireAuth, h(updateTaskStatus));

// 29. Holidays
router.get('/holidays', requireAuth, h(getHolidays));

// 30. Civil Check & Auto Add Member (Point 20)
router.post('/civil-check', requireAuth, h(checkCivilScore));
router.post('/civil-check/add-member', requireAuth, h(addCivilCheckedMember));

// 31. Notifications & Broadcasts (Points 21, 23, 25)
router.get('/notifications', requireAuth, h(getEmployeeNotifications));
router.post('/notifications/read', requireAuth, h(markEmployeeNotificationRead));

// 32. Death Requests (Point 24)
router.post('/death-requests', requireAuth, h(submitDeathRequest));
router.get('/death-requests', requireAuth, h(listDeathRequests));

export default router;


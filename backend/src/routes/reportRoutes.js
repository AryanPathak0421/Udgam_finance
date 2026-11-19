import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { report, callDone, npaPayment, npaWriteOff, npaWriteOffRevert, writeOffPayment, reportStaffOptions } from '../controllers/reportController.js';
import { listSurveys, createSurvey, updateSurveyStatus } from '../controllers/surveyController.js';

const router = Router();
const READ = ['super_admin', 'admin', 'branch_manager', 'accountant', 'loan_officer', 'collection_officer', 'field_officer', 'viewer'];
const CALL = ['super_admin', 'admin']; // the Call option is in the admin panel only

const MGMT = ['super_admin', 'admin', 'branch_manager'];
router.get('/center-surveys', requireAuth, requireRole(...READ), h(listSurveys));
router.post('/center-surveys', requireAuth, requireRole(...CALL), h(createSurvey));
router.post('/center-surveys/:id/status', requireAuth, requireRole(...MGMT), h(updateSurveyStatus));
router.post('/reports/npa-payment', requireAuth, requireRole('super_admin', 'admin', 'branch_manager', 'accountant', 'collection_officer'), h(npaPayment));
router.post('/reports/npa-write-off', requireAuth, requireRole('super_admin', 'admin'), h(npaWriteOff));
router.post('/reports/npa-write-off-revert', requireAuth, requireRole('super_admin', 'admin'), h(npaWriteOffRevert));
router.post('/reports/write-off-payment', requireAuth, requireRole('super_admin', 'admin', 'branch_manager', 'accountant', 'collection_officer'), h(writeOffPayment));
router.post('/reports/call-done', requireAuth, requireRole(...CALL), h(callDone));
router.get('/reports/staff-options', requireAuth, requireRole(...READ), h(reportStaffOptions));
router.get('/reports/:name', requireAuth, requireRole(...READ), h(report));

export default router;

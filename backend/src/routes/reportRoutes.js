import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { report, callDone } from '../controllers/reportController.js';

const router = Router();
const READ = ['super_admin', 'admin', 'branch_manager', 'accountant', 'loan_officer', 'collection_officer', 'field_officer', 'viewer'];
const CALL = ['super_admin', 'admin', 'branch_manager', 'accountant', 'loan_officer', 'collection_officer', 'field_officer'];

router.post('/reports/call-done', requireAuth, requireRole(...CALL), h(callDone));
router.get('/reports/:name', requireAuth, requireRole(...READ), h(report));

export default router;

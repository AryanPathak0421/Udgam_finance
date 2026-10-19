import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { overview, run, employeeList } from '../controllers/commissionGenerateController.js';

const router = Router();

const FINANCE = ['super_admin', 'admin', 'accountant'];
const REPORT = ['super_admin', 'admin', 'branch_manager', 'accountant', 'viewer'];

// Commission Generate: group leader and employee commission of a month
router.get('/commission/generate', requireAuth, requireRole(...REPORT), h(overview));
router.post('/commission/generate', requireAuth, requireRole(...FINANCE), h(run));
router.get('/commission/employee', requireAuth, requireRole(...REPORT), h(employeeList));

export default router;

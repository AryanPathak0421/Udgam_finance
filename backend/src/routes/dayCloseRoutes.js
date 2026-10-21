import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { status, cashClosing, submit, list, approve, reject } from '../controllers/dayCloseController.js';

const router = Router();
const VIEW = ['super_admin', 'admin', 'branch_manager', 'accountant'];
const ADMIN = ['super_admin', 'admin'];

router.get('/day-close/status', requireAuth, requireRole(...VIEW), h(status));
router.get('/day-close/cash-closing', requireAuth, requireRole(...VIEW), h(cashClosing));
router.post('/day-close', requireAuth, requireRole(...VIEW), h(submit));
router.get('/day-close', requireAuth, requireRole(...VIEW), h(list));
router.post('/day-close/:id/approve', requireAuth, requireRole(...ADMIN), h(approve));
router.post('/day-close/:id/reject', requireAuth, requireRole(...ADMIN), h(reject));

export default router;

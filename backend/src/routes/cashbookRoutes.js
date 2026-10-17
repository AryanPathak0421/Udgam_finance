import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { cashbook } from '../controllers/cashbookController.js';

const router = Router();
router.get('/cashbook', requireAuth, requireRole('super_admin', 'admin', 'branch_manager', 'accountant'), h(cashbook));
export default router;

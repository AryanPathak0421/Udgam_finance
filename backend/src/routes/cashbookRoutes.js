import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { cashbook, addEntry, deleteEntry } from '../controllers/cashbookController.js';

const router = Router();
const VIEW = ['super_admin', 'admin', 'branch_manager', 'accountant'];
router.get('/cashbook', requireAuth, requireRole(...VIEW), h(cashbook));
router.post('/cashbook/entries', requireAuth, requireRole(...VIEW), h(addEntry));
router.delete('/cashbook/entries/:id', requireAuth, requireRole('super_admin', 'admin'), h(deleteEntry));
export default router;

import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { preview, settleLoan, settleDeath, recordGuarantorDeath, guarantorDeathList, listSettlements, getSettlement, cancelSettlement } from '../controllers/settlementController.js';

const router = Router();
const SETTLE = ['super_admin', 'admin', 'branch_manager', 'accountant']; // who settles loans
const READ = [...SETTLE, 'loan_officer', 'collection_officer', 'field_officer', 'viewer'];

router.get('/settlements/preview', requireAuth, requireRole(...READ), h(preview));
router.get('/settlements', requireAuth, requireRole(...READ), h(listSettlements));
router.post('/settlements/loan', requireAuth, requireRole(...SETTLE), h(settleLoan));
router.post('/settlements/death', requireAuth, requireRole(...SETTLE), h(settleDeath));
router.post('/settlements/guarantor-death', requireAuth, requireRole(...SETTLE), h(recordGuarantorDeath));
router.get('/settlements/guarantor-deaths', requireAuth, requireRole(...READ), h(guarantorDeathList));
router.get('/settlements/:id', requireAuth, requireRole(...READ), h(getSettlement));
router.post('/settlements/:id/cancel', requireAuth, requireRole('super_admin', 'admin'), h(cancelSettlement));

export default router;

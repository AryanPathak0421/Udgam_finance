import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { searchLoans, loanDetail, payEmi, listEmiPayments, getEmiPayment, cancelEmiPayment } from '../controllers/emiController.js';

const router = Router();
const COLLECT = ['super_admin', 'admin', 'branch_manager', 'accountant', 'collection_officer', 'field_officer']; // who takes EMI payments
const READ = [...COLLECT, 'loan_officer', 'viewer'];

router.get('/emi/search', requireAuth, requireRole(...READ), h(searchLoans));
router.get('/emi/loans/:id', requireAuth, requireRole(...READ), h(loanDetail));
router.post('/emi/pay', requireAuth, requireRole(...COLLECT), h(payEmi));
router.get('/emi/payments', requireAuth, requireRole(...READ), h(listEmiPayments));
router.get('/emi/payments/:id', requireAuth, requireRole(...READ), h(getEmiPayment));
router.post('/emi/payments/:id/cancel', requireAuth, requireRole('super_admin', 'admin'), h(cancelEmiPayment));

export default router;

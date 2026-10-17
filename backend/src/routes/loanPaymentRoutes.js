import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { preparePayment, payLoan, payBatch, listPayments, getPayment, cancelPayment } from '../controllers/loanPaymentController.js';

const router = Router();
const PAY = ['super_admin', 'admin', 'branch_manager', 'accountant']; // who pays the loans out
const READ = [...PAY, 'loan_officer', 'field_officer', 'collection_officer', 'viewer'];

router.get('/loan-payments/prepare/:id', requireAuth, requireRole(...PAY), h(preparePayment));
router.post('/loan-payments', requireAuth, requireRole(...PAY), h(payLoan));
router.post('/loan-payments/batch', requireAuth, requireRole(...PAY), h(payBatch));
router.get('/loan-payments', requireAuth, requireRole(...READ), h(listPayments));
router.get('/loan-payments/:id', requireAuth, requireRole(...READ), h(getPayment));
router.post('/loan-payments/:id/cancel', requireAuth, requireRole('super_admin', 'admin'), h(cancelPayment));

export default router;

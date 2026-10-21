import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { makeEntry, listEntries, accountOptions, bankBook, dayBook, trialBalance } from '../controllers/accountsController.js';
import { purchaseBalance } from '../controllers/stockOrderController.js';
import { deleteEntry } from '../controllers/cashbookController.js';

const router = Router();
const VIEW = ['super_admin', 'admin', 'branch_manager', 'accountant'];
const ADMIN = ['super_admin', 'admin'];

router.get('/accounts/options', requireAuth, requireRole(...VIEW), h(accountOptions));
router.get('/accounts/entries', requireAuth, requireRole(...VIEW), h(listEntries));
router.post('/accounts/payment-vouchers', requireAuth, requireRole(...VIEW), h(makeEntry('payment_voucher')));
router.post('/accounts/receive-vouchers', requireAuth, requireRole(...VIEW), h(makeEntry('receive_voucher')));
router.post('/accounts/bank-deposits', requireAuth, requireRole(...VIEW), h(makeEntry('bank_deposit')));
router.post('/accounts/bank-withdrawals', requireAuth, requireRole(...VIEW), h(makeEntry('bank_withdraw')));
router.post('/accounts/branch-transfers', requireAuth, requireRole(...VIEW), h(makeEntry('branch_transfer')));
router.delete('/accounts/entries/:id', requireAuth, requireRole(...ADMIN), h(deleteEntry));
router.get('/accounts/trial-balance', requireAuth, requireRole(...VIEW), h(trialBalance));
router.get('/accounts/bank-book', requireAuth, requireRole(...VIEW), h(bankBook));
router.get('/accounts/day-book', requireAuth, requireRole(...VIEW), h(dayBook));
router.get('/accounts/product-branch-due', requireAuth, requireRole(...VIEW), h(purchaseBalance));

export default router;

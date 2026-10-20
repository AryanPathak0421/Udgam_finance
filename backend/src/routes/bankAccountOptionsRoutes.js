import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { bankAccountOptions } from '../services/bankAccountPick.js';

const router = Router();
// the bank accounts to pick under Account detail when a payment is made by bank transfer (any signed-in user; the account master stays admin-only)
router.get('/bank-account-options', requireAuth, h(async (_req, res) => res.json({ accounts: await bankAccountOptions() })));

export default router;

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import {
  verifyPanController,
  verifyGstController,
  initiateOkycController,
  verifyOkycController,
  verifyBankController,
} from '../controllers/verifyController.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Require authenticated staff or member session with rate limiting
router.post('/verify/pan', requireAuth, limiter, h(verifyPanController));
router.post('/verify/gst', requireAuth, limiter, h(verifyGstController));
router.post('/verify/okyc/initiate', requireAuth, limiter, h(initiateOkycController));
router.post('/verify/okyc/verify', requireAuth, limiter, h(verifyOkycController));
router.post('/verify/bank', requireAuth, limiter, h(verifyBankController));

export default router;

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireStaffOrMemberAuth } from '../middleware/auth.js';
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
router.post('/verify/pan', requireStaffOrMemberAuth, limiter, h(verifyPanController));
router.post('/verify/gst', requireStaffOrMemberAuth, limiter, h(verifyGstController));
router.post('/verify/okyc/initiate', requireStaffOrMemberAuth, limiter, h(initiateOkycController));
router.post('/verify/okyc/verify', requireStaffOrMemberAuth, limiter, h(verifyOkycController));
router.post('/verify/bank', requireStaffOrMemberAuth, limiter, h(verifyBankController));

export default router;

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me, forgotPassword, resetPassword } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/http.js';

const router = Router();
const limiter = (limit) =>
  rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false });

router.post('/login', limiter(30), asyncHandler(login));
router.post('/logout', logout);
router.get('/me', requireAuth, me);
router.post('/forgot-password', limiter(5), asyncHandler(forgotPassword));
router.post('/reset-password', limiter(10), asyncHandler(resetPassword));

export default router;

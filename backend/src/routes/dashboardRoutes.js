import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { badges, summary, offDays } from '../controllers/dashboardController.js';

const router = Router();
router.get('/dashboard/summary', requireAuth, h(summary));
router.get('/badges', requireAuth, h(badges));
router.get('/off-days', requireAuth, h(offDays));
export default router;

import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import {
  notificationPreview, sendNotification, listNotifications, myNotifications, readNotifications, listHolidays, createHoliday, updateHoliday, removeHoliday,
  profitLoss, complaintOverview, companySummary, monitoring, graph,
} from '../controllers/superAdminController.js';

const router = Router();
const ADMIN = ['super_admin', 'admin'];

// the bell: every signed-in user
router.get('/notifications/mine', requireAuth, h(myNotifications));
router.post('/notifications/read', requireAuth, h(readNotifications));

router.post('/super-admin/notifications/preview', requireAuth, requireRole(...ADMIN), h(notificationPreview));
router.post('/super-admin/notifications', requireAuth, requireRole(...ADMIN), h(sendNotification));
router.get('/super-admin/notifications', requireAuth, requireRole(...ADMIN), h(listNotifications));
router.get('/super-admin/holidays', requireAuth, requireRole(...ADMIN, 'branch_manager', 'accountant'), h(listHolidays));
router.post('/super-admin/holidays', requireAuth, requireRole(...ADMIN), h(createHoliday));
router.put('/super-admin/holidays/:id', requireAuth, requireRole(...ADMIN), h(updateHoliday));
router.delete('/super-admin/holidays/:id', requireAuth, requireRole(...ADMIN), h(removeHoliday));
router.get('/super-admin/profit-loss', requireAuth, requireRole(...ADMIN), h(profitLoss));
router.get('/super-admin/complaints', requireAuth, requireRole(...ADMIN), h(complaintOverview));
router.get('/super-admin/company-summary', requireAuth, requireRole(...ADMIN), h(companySummary));
router.get('/super-admin/monitoring', requireAuth, requireRole(...ADMIN), h(monitoring));
router.get('/super-admin/graph', requireAuth, requireRole(...ADMIN), h(graph));

export default router;

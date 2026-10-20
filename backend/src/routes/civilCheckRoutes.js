import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { memberChecks, addCheck, deleteCheck, getSettings, saveSettings } from '../controllers/civilCheckController.js';

const router = Router();

const READ = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];
const CREATE = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];

router.get('/civil-checks/settings', requireAuth, requireRole(...READ), h(getSettings));
router.put('/civil-checks/settings', requireAuth, requireRole('super_admin', 'admin'), h(saveSettings));
router.get('/civil-checks/member/:memberId', requireAuth, requireRole(...READ), h(memberChecks));
router.post('/civil-checks', requireAuth, requireRole(...CREATE), h(addCheck));
router.delete('/civil-checks/:id', requireAuth, requireRole('super_admin', 'admin'), h(deleteCheck));

export default router;

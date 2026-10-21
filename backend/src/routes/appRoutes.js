import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import {
  listAppUsers, staffOptions, createAppUser, setAppUserStatus, removeAppUser, listMemberApprovals, approveMember, rejectMember, listEmiApprovals, approveEmi, rejectEmi, myAppRequests,
} from '../controllers/appController.js';

const router = Router();
const ADMIN = ['super_admin', 'admin'];
const MGMT = ['super_admin', 'admin', 'branch_manager'];

router.get('/app/users', requireAuth, requireRole(...ADMIN), h(listAppUsers));
router.get('/app/staff-options', requireAuth, requireRole(...ADMIN), h(staffOptions));
router.post('/app/users', requireAuth, requireRole(...ADMIN), h(createAppUser));
router.patch('/app/users/:id/status', requireAuth, requireRole(...ADMIN), h(setAppUserStatus));
router.delete('/app/users/:id', requireAuth, requireRole(...ADMIN), h(removeAppUser));
router.get('/app/member-approvals', requireAuth, requireRole(...MGMT), h(listMemberApprovals));
router.post('/app/member-approvals/:id/approve', requireAuth, requireRole(...MGMT), h(approveMember));
router.post('/app/member-approvals/:id/reject', requireAuth, requireRole(...MGMT), h(rejectMember));
router.get('/app/emi-approvals', requireAuth, requireRole(...MGMT), h(listEmiApprovals));
router.post('/app/emi-approvals/:id/approve', requireAuth, requireRole(...MGMT), h(approveEmi));
router.post('/app/emi-approvals/:id/reject', requireAuth, requireRole(...MGMT), h(rejectEmi));
router.get('/app/my-requests', requireAuth, h(myAppRequests));

export default router;

import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppUser } from '../models/AppUser.js';
import { sendOtp, verifyOtp, createMember } from '../controllers/memberController.js';
import { collectEmi, payEmi } from '../controllers/emiController.js';
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
// The URLs the mobile app uses. Everything sent here is an app request: a member registered here waits for joining approval, EMI collected here waits for collection approval.
const appOnly = h(async (req, res, next) => {
  if (!(await AppUser.exists({ user: req.user._id, isActive: true }))) return res.status(403).json({ message: 'This login is not allowed to use the app. Ask the admin (App Section → App User Creation).' });
  req.appClient = true;
  return next();
});
const MEMBER = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];
const COLLECT = ['super_admin', 'admin', 'branch_manager', 'accountant', 'collection_officer', 'field_officer'];
router.post('/app/members/otp/send', requireAuth, appOnly, requireRole(...MEMBER), h(sendOtp));
router.post('/app/members/otp/verify', requireAuth, appOnly, requireRole(...MEMBER), h(verifyOtp));
router.post('/app/members', requireAuth, appOnly, requireRole(...MEMBER), h(createMember));
router.post('/app/emi-collections', requireAuth, appOnly, requireRole(...COLLECT), h(collectEmi));
router.post('/app/emi-payments', requireAuth, appOnly, requireRole(...COLLECT), h(payEmi));
router.get('/app/my-requests', requireAuth, h(myAppRequests));

export default router;

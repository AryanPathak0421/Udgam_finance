import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { employees, items, transfer, groupMembers, targetGroups, transferMembers, history } from '../controllers/groupTransferController.js';

const router = Router();

const MGMT = ['super_admin', 'admin', 'branch_manager'];
const MANAGE = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];

// Group transfer: the groups / loans of one employee handed to another
router.get('/group-transfer/employees', requireAuth, requireRole(...MGMT), h(employees));
router.get('/group-transfer/items', requireAuth, requireRole(...MGMT), h(items));
router.post('/group-transfer', requireAuth, requireRole(...MGMT), h(transfer));
router.get('/group-transfer/history', requireAuth, requireRole(...MANAGE), h(history));
// Member group transfer: members moved from one group to another
router.get('/group-transfer/group-members', requireAuth, requireRole(...MANAGE), h(groupMembers));
router.get('/group-transfer/target-groups', requireAuth, requireRole(...MANAGE), h(targetGroups));
router.post('/group-transfer/members', requireAuth, requireRole(...MANAGE), h(transferMembers));

export default router;

import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import {
  listRoomRents, createRoomRent, cancelRoomRent, roomRentPhoto, listRentParties, getRentParty, createRentParty, updateRentParty, deleteRentParty, listTasks, createTask, setTaskStatus, listComplaints, createComplaint, setComplaintStatus,
  listRequirements, createRequirement, decideRequirement, listLeaves, applyLeave, decideLeave, listResignations, applyResignation, decideResignation,
  listChanges, createChange, letterhead, blockEmployee,
} from '../controllers/hrExtraController.js';

const router = Router();
const ADMIN = ['super_admin', 'admin'];
const MGMT = ['super_admin', 'admin', 'branch_manager'];
const HR = ['super_admin', 'admin', 'branch_manager', 'accountant'];

router.get('/hr/room-rents', requireAuth, requireRole(...HR), h(listRoomRents));
router.post('/hr/room-rents', requireAuth, requireRole(...HR), h(createRoomRent));
router.get('/hr/room-rents/:id/photo', requireAuth, requireRole(...HR), h(roomRentPhoto));
router.get('/hr/rent-parties', requireAuth, requireRole(...HR), h(listRentParties));
router.get('/hr/rent-parties/:id', requireAuth, requireRole(...ADMIN), h(getRentParty));
router.post('/hr/rent-parties', requireAuth, requireRole(...ADMIN), h(createRentParty));
router.put('/hr/rent-parties/:id', requireAuth, requireRole(...ADMIN), h(updateRentParty));
router.delete('/hr/rent-parties/:id', requireAuth, requireRole(...ADMIN), h(deleteRentParty));
router.post('/hr/room-rents/:id/cancel', requireAuth, requireRole(...ADMIN), h(cancelRoomRent));

router.get('/hr/tasks', requireAuth, requireRole(...HR), h(listTasks));
router.post('/hr/tasks', requireAuth, requireRole(...MGMT), h(createTask));
router.post('/hr/tasks/:id/status', requireAuth, requireRole(...HR), h(setTaskStatus));

router.get('/hr/complaints', requireAuth, requireRole(...HR), h(listComplaints));
router.post('/hr/complaints', requireAuth, requireRole(...HR), h(createComplaint));
router.post('/hr/complaints/:id/status', requireAuth, requireRole(...HR), h(setComplaintStatus));

router.get('/hr/requirements', requireAuth, requireRole(...HR), h(listRequirements));
router.post('/hr/requirements', requireAuth, requireRole(...MGMT), h(createRequirement));
router.post('/hr/requirements/:id/decide', requireAuth, requireRole(...ADMIN), h(decideRequirement));

router.get('/hr/leaves', requireAuth, requireRole(...HR), h(listLeaves));
router.post('/hr/leaves', requireAuth, requireRole(...HR), h(applyLeave));
router.post('/hr/leaves/:id/decide', requireAuth, requireRole(...MGMT), h(decideLeave));

router.get('/hr/resignations', requireAuth, requireRole(...HR), h(listResignations));
router.post('/hr/resignations', requireAuth, requireRole(...MGMT), h(applyResignation));
router.post('/hr/resignations/:id/decide', requireAuth, requireRole(...ADMIN), h(decideResignation));

router.get('/hr/changes', requireAuth, requireRole(...HR), h(listChanges));
router.post('/hr/changes', requireAuth, requireRole(...ADMIN), h(createChange));
router.get('/hr/letterhead', requireAuth, requireRole(...HR), h(letterhead));
router.post('/hr/employees/:id/block', requireAuth, requireRole(...ADMIN), h(blockEmployee));

export default router;

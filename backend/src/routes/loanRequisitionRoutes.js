import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import {
  schemes, borrowers, borrowerDetail, groups, groupDetail, preview, createRequisition, listRequisitions, getRequisition, deleteRequisition, gstCheck,
} from '../controllers/loanRequisitionController.js';

const router = Router();

const READ = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];
const CREATE = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];

router.get('/loan-requisitions/schemes', requireAuth, requireRole(...CREATE), h(schemes));
router.get('/loan-requisitions/borrowers', requireAuth, requireRole(...CREATE), h(borrowers));
router.get('/loan-requisitions/borrowers/:id', requireAuth, requireRole(...CREATE), h(borrowerDetail));
router.get('/loan-requisitions/groups', requireAuth, requireRole(...CREATE), h(groups));
router.get('/loan-requisitions/groups/:id', requireAuth, requireRole(...CREATE), h(groupDetail));
router.get('/loan-requisitions/gst/:gstin', requireAuth, requireRole(...CREATE), h(gstCheck));
router.post('/loan-requisitions/preview', requireAuth, requireRole(...CREATE), h(preview));
router.get('/loan-requisitions', requireAuth, requireRole(...READ), h(listRequisitions));

// One endpoint per kind of requisition.
router.post('/loan-requisitions', requireAuth, requireRole(...CREATE), h(createRequisition('personal')));
router.post('/loan-requisitions/group', requireAuth, requireRole(...CREATE), h(createRequisition('group')));
router.post('/loan-requisitions/business', requireAuth, requireRole(...CREATE), h(createRequisition('business')));
router.post('/loan-requisitions/product', requireAuth, requireRole(...CREATE), h(createRequisition('product')));

router.get('/loan-requisitions/:id', requireAuth, requireRole(...READ), h(getRequisition));
router.delete('/loan-requisitions/:id', requireAuth, requireRole('super_admin', 'admin', 'branch_manager'), h(deleteRequisition));

export default router;

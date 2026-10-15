import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { schemes, borrowers, borrowerDetail, preview, createRequisition, listRequisitions, getRequisition } from '../controllers/loanRequisitionController.js';

const router = Router();

const READ = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'];
const CREATE = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];

router.get('/loan-requisitions/schemes', requireAuth, requireRole(...CREATE), h(schemes));
router.get('/loan-requisitions/borrowers', requireAuth, requireRole(...CREATE), h(borrowers));
router.get('/loan-requisitions/borrowers/:id', requireAuth, requireRole(...CREATE), h(borrowerDetail));
router.post('/loan-requisitions/preview', requireAuth, requireRole(...CREATE), h(preview));
router.get('/loan-requisitions', requireAuth, requireRole(...READ), h(listRequisitions));
router.post('/loan-requisitions', requireAuth, requireRole(...CREATE), h(createRequisition));
router.get('/loan-requisitions/:id', requireAuth, requireRole(...READ), h(getRequisition));

export default router;

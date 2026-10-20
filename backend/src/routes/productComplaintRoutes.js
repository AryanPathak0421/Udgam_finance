import { Router } from 'express';
import { requireAuth, requireMenu, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { sales, create, list, getOne, resolve, deliver } from '../controllers/productComplaintController.js';

const router = Router();
const ORDERS = '/stock/orders'; // complaints are part of Product Orders: the same menu permission
const ADMIN = ['super_admin', 'admin'];

router.get('/product-complaints/sales', requireAuth, requireMenu(ORDERS, 'add'), h(sales));
router.get('/product-complaints', requireAuth, requireMenu(ORDERS, 'view'), h(list));
router.post('/product-complaints', requireAuth, requireMenu(ORDERS, 'add'), h(create));
router.get('/product-complaints/:id', requireAuth, requireMenu(ORDERS, 'view'), h(getOne));
router.post('/product-complaints/:id/resolve', requireAuth, requireRole(...ADMIN), h(resolve));
router.post('/product-complaints/:id/deliver', requireAuth, requireMenu(ORDERS, 'add'), h(deliver));

export default router;

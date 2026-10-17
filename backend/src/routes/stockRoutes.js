import { Router } from 'express';
import { requireAuth, requireMenu } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { listProducts, createProduct, updateProduct, setProductStatus, deleteProduct } from '../controllers/stockProductController.js';

const router = Router();
const MENU = '/stock/products';

// Stock Product Master is its own module: admins always, other ranks through Menu Permission.
router.get('/stock-products', requireAuth, requireMenu(MENU, 'view'), h(listProducts));
router.post('/stock-products', requireAuth, requireMenu(MENU, 'add'), h(createProduct));
router.put('/stock-products/:id', requireAuth, requireMenu(MENU, 'edit'), h(updateProduct));
router.patch('/stock-products/:id/status', requireAuth, requireMenu(MENU, 'edit'), h(setProductStatus));
router.delete('/stock-products/:id', requireAuth, requireMenu(MENU, 'delete'), h(deleteProduct));

export default router;

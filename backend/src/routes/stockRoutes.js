import { Router } from 'express';
import { requireAuth, requireMenu, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { listProducts, createProduct, updateProduct, setProductStatus, deleteProduct, productOptions, stockReport } from '../controllers/stockProductController.js';
import { listEntries, entryProducts, createEntry, cancelEntry, quantityReport } from '../controllers/stockEntryController.js';
import { stockAt, productsWithPlaces, createTransfer, listTransfers } from '../controllers/stockTransferController.js';
import { orderableProducts, listOrders, getOrder, createOrder, approveOrder, rejectOrder, cancelOrder, purchaseBalance, listPayments, addPayment, voidPayment, payToHeadOffice, receivePayment, rejectPayment } from '../controllers/stockOrderController.js';

const router = Router();
const MENU = '/stock/products';
const ORDERS = '/stock/orders';
const ENTRY = '/stock/stock-entry';
const QTY = '/stock/quantity-report';
const ADMIN = ['super_admin', 'admin'];

// Stock Product Master is its own module: admins always, other ranks through Menu Permission.
router.get('/stock-products/options', requireAuth, requireMenu(MENU, 'view'), h(productOptions));
router.get('/stock-products/report', requireAuth, requireMenu(MENU, 'view'), h(stockReport));
router.get('/stock-products', requireAuth, requireMenu(MENU, 'view'), h(listProducts));
router.post('/stock-products', requireAuth, requireMenu(MENU, 'add'), h(createProduct));
router.put('/stock-products/:id', requireAuth, requireMenu(MENU, 'edit'), h(updateProduct));
router.patch('/stock-products/:id/status', requireAuth, requireMenu(MENU, 'edit'), h(setProductStatus));
router.delete('/stock-products/:id', requireAuth, requireMenu(MENU, 'delete'), h(deleteProduct));

// Product orders: a branch (buyer) asks the admin; only the admin approves (and can edit the quantities) or rejects.
router.get('/stock-entries/products', requireAuth, requireMenu(ENTRY, 'add'), h(entryProducts));
router.get('/stock-entries', requireAuth, requireMenu(ENTRY, 'view'), h(listEntries));
router.post('/stock-entries', requireAuth, requireMenu(ENTRY, 'add'), h(createEntry));
router.post('/stock-entries/:id/cancel', requireAuth, requireRole(...ADMIN), h(cancelEntry));
router.get('/stock-report/quantity', requireAuth, requireMenu(QTY, 'view'), h(quantityReport));
router.get('/stock-orders/products', requireAuth, requireMenu(ORDERS, 'add'), h(orderableProducts));
router.get('/stock-orders/balance', requireAuth, requireMenu(ORDERS, 'view'), h(purchaseBalance));
router.get('/stock-payments', requireAuth, requireMenu(ORDERS, 'view'), h(listPayments));
router.post('/stock-payments', requireAuth, requireRole(...ADMIN), h(addPayment));
// A branch pays for the products; only the admin receives (or rejects) it.
router.post('/stock-payments/pay', requireAuth, requireMenu(ORDERS, 'add'), h(payToHeadOffice));
router.post('/stock-payments/:id/receive', requireAuth, requireRole(...ADMIN), h(receivePayment));
router.post('/stock-payments/:id/reject', requireAuth, requireRole(...ADMIN), h(rejectPayment));
router.delete('/stock-payments/:id', requireAuth, requireRole(...ADMIN), h(voidPayment));
router.get('/stock-orders', requireAuth, requireMenu(ORDERS, 'view'), h(listOrders));
router.post('/stock-orders', requireAuth, requireMenu(ORDERS, 'add'), h(createOrder));
router.get('/stock-orders/:id', requireAuth, requireMenu(ORDERS, 'view'), h(getOrder));
router.post('/stock-orders/:id/approve', requireAuth, requireRole(...ADMIN), h(approveOrder));
router.post('/stock-orders/:id/reject', requireAuth, requireRole(...ADMIN), h(rejectOrder));
router.post('/stock-orders/:id/cancel', requireAuth, requireMenu(ORDERS, 'delete'), h(cancelOrder));

// Moving stock between head office and branches (BR01 -> BR02): admin only.
router.get('/stock-transfers/stock', requireAuth, requireRole(...ADMIN), h(stockAt));
router.get('/stock-transfers/products', requireAuth, requireRole(...ADMIN), h(productsWithPlaces));
router.get('/stock-transfers', requireAuth, requireRole(...ADMIN), h(listTransfers));
router.post('/stock-transfers', requireAuth, requireRole(...ADMIN), h(createTransfer));

export default router;

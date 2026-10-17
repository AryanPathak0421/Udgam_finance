import mongoose from 'mongoose';
import { ProductOrder } from '../models/ProductOrder.js';
import { StockProduct } from '../models/StockProduct.js';
import { Branch } from '../models/Branch.js';
import { ProductPayment, PAYMENT_MODES } from '../models/ProductPayment.js';
import { toMinor } from '../utils/money.js';
import { parseDateOnly } from '../utils/http.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { isAdmin } from './groupController.js';

const POPULATE = { path: 'branch', select: 'code name' };
const scope = (user) => (isAdmin(user) ? {} : { branch: { $in: user.branches || [] } });
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);

const present = (o) => ({
  id: o._id,
  code: o.code,
  branch: o.branch?._id ? { id: o.branch._id, code: o.branch.code, name: o.branch.name } : null,
  status: o.status,
  note: o.note || '',
  rejectReason: o.rejectReason || '',
  requestedByCode: o.requestedByCode || '',
  decidedByCode: o.decidedByCode || '',
  decidedAt: o.decidedAt || null,
  createdAt: o.createdAt,
  items: o.items.map((i) => ({
    id: i._id,
    product: i.product,
    category: i.category,
    brand: i.brand,
    model: i.model,
    variant: i.variant,
    name: i.name,
    unitPrice: (i.unitPricePaise || 0) / 100,
    requestedQty: i.requestedQty,
    approvedQty: i.approvedQty ?? null,
  })),
  totalRequested: o.items.reduce((s, i) => s + i.requestedQty, 0),
  totalApproved: o.status === 'approved' ? o.items.reduce((s, i) => s + (i.approvedQty || 0), 0) : null,
  value: o.items.reduce((s, i) => s + (o.status === 'approved' ? i.approvedQty || 0 : i.requestedQty) * (i.unitPricePaise || 0), 0) / 100,
});

/** Head-office products a branch can order. */
export async function orderableProducts(_req, res) {
  const items = await StockProduct.find({ isDeleted: false, isActive: true, branch: null }).sort({ category: 1, name: 1 });
  res.json({
    items: items.map((p) => ({ id: p._id, code: p.code, category: p.category, brand: p.brand, model: p.model, variant: p.variant, name: p.name, unitPrice: p.unitPricePaise / 100, stockQty: p.stockQty })),
  });
}

export async function listOrders(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { isDeleted: false, ...scope(req.user) };
  if (mongoose.isValidObjectId(req.query.branch) && (isAdmin(req.user) || (req.user.branches || []).some((b) => String(b) === req.query.branch))) filter.branch = req.query.branch;
  const status = asString(req.query.status);
  if (['pending', 'approved', 'rejected', 'cancelled'].includes(status)) filter.status = status;
  const [items, total, pending] = await Promise.all([
    ProductOrder.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ProductOrder.countDocuments(filter),
    ProductOrder.countDocuments({ isDeleted: false, ...scope(req.user), status: 'pending' }),
  ]);
  res.json({ items: items.map(present), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1), pending });
}

async function load(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Order not found');
  const o = await ProductOrder.findOne({ _id: req.params.id, isDeleted: false, ...scope(req.user) });
  if (!o) throw new HttpError(404, 'Order not found');
  return o;
}

export async function getOrder(req, res) {
  const o = await load(req);
  await o.populate(POPULATE);
  res.json({ order: present(o) });
}

/** A branch (buyer) asks the admin for products. */
export async function createOrder(req, res) {
  const b = req.body || {};
  let branchId = asString(b.branch);
  if (!branchId && !isAdmin(req.user) && (req.user.branches || []).length === 1) branchId = String(req.user.branches[0]);
  if (!mongoose.isValidObjectId(branchId)) throw invalid({ branch: 'Select the branch that is ordering' });
  if (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === branchId)) throw new HttpError(403, 'You can only use branches assigned to you');
  if (!(await Branch.exists({ _id: branchId, isDeleted: false }))) throw invalid({ branch: 'Branch not found' });

  const lines = Array.isArray(b.items) ? b.items : [];
  if (!lines.length) throw invalid({ items: 'Add at least one product' });
  if (lines.length > 50) throw invalid({ items: 'An order can have up to 50 products' });
  const items = [];
  const seen = new Set();
  for (const l of lines) {
    const pid = String(l?.product || '');
    if (!mongoose.isValidObjectId(pid)) throw invalid({ items: 'Select the product on every line' });
    if (seen.has(pid)) throw invalid({ items: 'A product is on the order twice' });
    seen.add(pid);
    const qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw invalid({ items: 'Enter the quantity (a whole number, 1 or more) on every line' });
    const p = await StockProduct.findOne({ _id: pid, isDeleted: false, isActive: true, branch: null });
    if (!p) throw invalid({ items: 'A chosen product is not available to order' });
    items.push({ product: p._id, category: p.category, brand: p.brand, model: p.model, variant: p.variant, name: p.name, unitPricePaise: p.unitPricePaise, requestedQty: qty });
  }
  const note = asString(b.note).slice(0, 300);
  const o = await ProductOrder.create({
    code: await generateCode('productOrder'),
    branch: branchId,
    items,
    note,
    requestedByCode: req.user.employeeCode || '',
    createdBy: req.user._id,
  });
  await o.populate(POPULATE);
  await audit(req, { action: 'productOrder.create', entity: 'ProductOrder', entityId: o._id, after: { code: o.code, branch: o.branch.code, items: items.map((i) => `${i.name} x${i.requestedQty}`) } });
  res.status(201).json({ order: present(o) });
}

// Moves `qty` units of the head-office product into the branch's stock (a new entry when the branch has none yet).
async function transfer(source, branchId, qty, userId) {
  const taken = await StockProduct.updateOne({ _id: source._id, isDeleted: false, stockQty: { $gte: qty } }, { $inc: { stockQty: -qty } });
  if (!taken.modifiedCount) throw new HttpError(409, `Only ${source.stockQty} unit${source.stockQty === 1 ? '' : 's'} of ${source.name} left in head office stock`, { items: `Not enough stock of ${source.name}` });
  try {
    const key = { branch: branchId, category: source.category, brand: source.brand, model: source.model, variant: source.variant || '', isDeleted: false };
    const existing = await StockProduct.findOneAndUpdate(key, { $inc: { stockQty: qty }, $set: { updatedBy: userId } }, { collation: { locale: 'en', strength: 2 } });
    if (!existing) {
      await StockProduct.create({
        code: await generateCode('stockProduct'),
        category: source.category, brand: source.brand, model: source.model, variant: source.variant || '', name: source.name,
        branch: branchId, unitPricePaise: source.unitPricePaise, stockQty: qty, createdBy: userId, updatedBy: userId,
      });
    }
  } catch (err) {
    await StockProduct.updateOne({ _id: source._id }, { $inc: { stockQty: qty } }); // put it back
    throw err;
  }
}

/** Admin approves the order; the quantities can be edited (0 drops a line). */
export async function approveOrder(req, res) {
  const o = await load(req);
  if (o.status !== 'pending') throw new HttpError(409, `This order is already ${o.status}`);
  const edits = Array.isArray(req.body?.items) ? req.body.items : [];
  const moves = [];
  for (const it of o.items) {
    const e = edits.find((x) => String(x?.id) === String(it._id));
    const qty = e && e.quantity !== undefined && e.quantity !== '' ? Number(e.quantity) : it.requestedQty;
    if (!Number.isInteger(qty) || qty < 0 || qty > 1_000_000) throw invalid({ items: `Enter a valid quantity for ${it.name}` });
    moves.push({ it, qty });
  }
  if (!moves.some((m) => m.qty > 0)) throw invalid({ items: 'Approve at least one unit, or reject the order' });

  const done = [];
  try {
    for (const { it, qty } of moves) {
      if (qty > 0) {
        const source = await StockProduct.findOne({ _id: it.product, isDeleted: false });
        if (!source) throw new HttpError(409, `${it.name} is no longer in stock`, { items: `${it.name} is no longer available` });
        await transfer(source, o.branch, qty, req.user._id);
        done.push({ source, qty });
      }
    }
  } catch (err) {
    // Undo what had already moved so a failed approval changes nothing.
    for (const d of done) {
      await StockProduct.updateOne({ _id: d.source._id }, { $inc: { stockQty: d.qty } });
      await StockProduct.updateOne({ branch: o.branch, category: d.source.category, brand: d.source.brand, model: d.source.model, variant: d.source.variant || '', isDeleted: false }, { $inc: { stockQty: -d.qty } }, { collation: { locale: 'en', strength: 2 } });
    }
    throw err;
  }
  moves.forEach(({ it, qty }) => { it.approvedQty = qty; });
  o.status = 'approved';
  o.decidedAt = new Date();
  o.decidedBy = req.user._id;
  o.decidedByCode = req.user.employeeCode || '';
  await o.save();
  await o.populate(POPULATE);
  await audit(req, { action: 'productOrder.approve', entity: 'ProductOrder', entityId: o._id, after: { code: o.code, items: o.items.map((i) => `${i.name}: ${i.requestedQty} -> ${i.approvedQty}`) } });
  res.json({ order: present(o) });
}

export async function rejectOrder(req, res) {
  const o = await load(req);
  if (o.status !== 'pending') throw new HttpError(409, `This order is already ${o.status}`);
  const reason = asString(req.body?.reason);
  if (reason.length < 3 || reason.length > 200) throw invalid({ reason: 'Enter the reason (3–200 characters)' });
  o.status = 'rejected';
  o.rejectReason = reason;
  o.decidedAt = new Date();
  o.decidedBy = req.user._id;
  o.decidedByCode = req.user.employeeCode || '';
  await o.save();
  await o.populate(POPULATE);
  await audit(req, { action: 'productOrder.reject', entity: 'ProductOrder', entityId: o._id, after: { code: o.code, reason } });
  res.json({ order: present(o) });
}

/** The branch withdraws an order that is still pending. */
export async function cancelOrder(req, res) {
  const o = await load(req);
  if (o.status !== 'pending') throw new HttpError(409, `This order is already ${o.status}`);
  o.status = 'cancelled';
  await o.save();
  await o.populate(POPULATE);
  await audit(req, { action: 'productOrder.cancel', entity: 'ProductOrder', entityId: o._id, after: { code: o.code } });
  res.json({ order: present(o) });
}

// ---- purchase balance: what each branch bought from head office, paid, and still owes ----------------------------
async function purchased(branchIds) {
  const rows = await ProductOrder.aggregate([
    { $match: { isDeleted: false, status: 'approved', ...(branchIds ? { branch: { $in: branchIds } } : {}) } },
    { $unwind: '$items' },
    { $group: { _id: '$branch', orders: { $addToSet: '$_id' }, amountPaise: { $sum: { $multiply: [{ $ifNull: ['$items.approvedQty', 0] }, { $ifNull: ['$items.unitPricePaise', 0] }] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { orders: r.orders.length, amountPaise: r.amountPaise }]));
}
async function paid(branchIds) {
  const rows = await ProductPayment.aggregate([
    { $match: { isDeleted: false, ...(branchIds ? { branch: { $in: branchIds } } : {}) } },
    { $group: { _id: '$branch', amountPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { amountPaise: r.amountPaise, count: r.count }]));
}
async function balanceOf(branchId) {
  const [p, q] = await Promise.all([purchased([new mongoose.Types.ObjectId(String(branchId))]), paid([new mongoose.Types.ObjectId(String(branchId))])]);
  return (p.get(String(branchId))?.amountPaise || 0) - (q.get(String(branchId))?.amountPaise || 0);
}

export async function purchaseBalance(req, res) {
  const ids = isAdmin(req.user) ? null : (req.user.branches || []).map((b) => new mongoose.Types.ObjectId(String(b)));
  const [p, q] = await Promise.all([purchased(ids), paid(ids)]);
  const keys = [...new Set([...p.keys(), ...q.keys()])];
  const branches = await Branch.find({ _id: { $in: keys } }).select('code name');
  const rows = keys
    .map((k) => {
      const b = branches.find((x) => String(x._id) === k);
      const bought = p.get(k)?.amountPaise || 0;
      const paidAmt = q.get(k)?.amountPaise || 0;
      return { branchId: k, branch: b ? { id: b._id, code: b.code, name: b.name } : null, orders: p.get(k)?.orders || 0, purchased: bought / 100, paid: paidAmt / 100, balance: (bought - paidAmt) / 100 };
    })
    .sort((a, b) => (a.branch?.code || '').localeCompare(b.branch?.code || ''));
  res.json({
    rows,
    total: { purchased: rows.reduce((s, r) => s + r.purchased, 0), paid: rows.reduce((s, r) => s + r.paid, 0), balance: rows.reduce((s, r) => s + r.balance, 0) },
  });
}

const presentPayment = (p) => ({
  id: p._id,
  branch: p.branch?._id ? { id: p.branch._id, code: p.branch.code, name: p.branch.name } : null,
  amount: p.amountPaise / 100,
  paidOn: p.paidOn.toISOString().slice(0, 10),
  mode: p.mode,
  reference: p.reference || '',
  note: p.note || '',
  createdByCode: p.createdByCode || '',
  createdAt: p.createdAt,
});

export async function listPayments(req, res) {
  const filter = { isDeleted: false, ...scope(req.user) };
  if (mongoose.isValidObjectId(req.query.branch) && (isAdmin(req.user) || (req.user.branches || []).some((b) => String(b) === req.query.branch))) filter.branch = req.query.branch;
  const items = await ProductPayment.find(filter).populate(POPULATE).sort({ paidOn: -1, createdAt: -1 }).limit(200);
  res.json({ items: items.map(presentPayment) });
}

/** Head office records a payment received from a branch; it cannot be more than the branch still owes. */
export async function addPayment(req, res) {
  const b = req.body || {};
  if (!mongoose.isValidObjectId(String(b.branch || ''))) throw invalid({ branch: 'Select the branch' });
  if (!(await Branch.exists({ _id: b.branch, isDeleted: false }))) throw invalid({ branch: 'Branch not found' });
  const amountPaise = toMinor(b.amount);
  if (amountPaise === null || amountPaise < 100) throw invalid({ amount: 'Enter the amount paid (₹1 or more, up to 2 decimals)' });
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const paidOn = b.paidOn ? parseDateOnly(asString(b.paidOn)) : today;
  if (!paidOn) throw invalid({ paidOn: 'Enter a valid date' });
  if (paidOn > today) throw invalid({ paidOn: 'The payment date cannot be in the future' });
  const mode = asString(b.mode);
  if (!PAYMENT_MODES.includes(mode)) throw invalid({ mode: 'Select the payment mode' });
  const balance = await balanceOf(b.branch);
  if (amountPaise > balance) throw invalid({ amount: `The branch owes only ₹${balance / 100}. The payment cannot be more than the balance.` });
  const p = await ProductPayment.create({
    branch: b.branch, amountPaise, paidOn, mode, reference: asString(b.reference).slice(0, 60), note: asString(b.note).slice(0, 200),
    createdBy: req.user._id, createdByCode: req.user.employeeCode || '',
  });
  await p.populate(POPULATE);
  await audit(req, { action: 'productPayment.create', entity: 'ProductPayment', entityId: p._id, after: { branch: p.branch.code, amount: amountPaise / 100, mode } });
  res.status(201).json({ payment: presentPayment(p), balance: (balance - amountPaise) / 100 });
}

export async function voidPayment(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Payment not found');
  const p = await ProductPayment.findOne({ _id: req.params.id, isDeleted: false });
  if (!p) throw new HttpError(404, 'Payment not found');
  p.isDeleted = true;
  await p.save();
  await audit(req, { action: 'productPayment.delete', entity: 'ProductPayment', entityId: p._id, after: { amount: p.amountPaise / 100 } });
  res.json({ message: 'Payment removed' });
}

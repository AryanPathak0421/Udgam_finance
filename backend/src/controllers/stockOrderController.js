import { readBankAccount } from '../services/bankAccountPick.js';
import mongoose from 'mongoose';
import { StockTransfer } from '../models/StockTransfer.js';
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

const COLL = { locale: 'en', strength: 2 };
const identityOf = (x) => ({ category: x.category, brand: x.brand, model: x.model, variant: x.variant || '' });

/** Where a product of an order can be taken from: head office and every other branch that has it in stock. */
async function sourcesFor(item, orderBranch) {
  const docs = await StockProduct.find({ ...identityOf(item), isDeleted: false, isActive: true, stockQty: { $gt: 0 }, branch: { $ne: orderBranch } }).collation(COLL).populate('branch', 'code name');
  return docs
    .map((d) => ({ key: d.branch ? String(d.branch._id) : 'ho', label: d.branch ? `${d.branch.code} — ${d.branch.name}` : 'Head office', stockQty: d.stockQty, unitPrice: d.unitPricePaise / 100, productId: d._id }))
    .sort((a, b) => (a.key === 'ho' ? -1 : b.key === 'ho' ? 1 : b.stockQty - a.stockQty));
}

/** Products a branch can order: whatever is in stock with the admin (head office) or in any branch, counted once. */
export async function orderableProducts(req, res) {
  const all = await StockProduct.find({ isDeleted: false, isActive: true, stockQty: { $gt: 0 } }).populate('branch', 'code name').sort({ category: 1, name: 1 });
  const groups = new Map();
  for (const p of all) {
    const k = [p.category, p.brand, p.model, p.variant || ''].join('|').toLowerCase();
    const g = groups.get(k) || { rep: p, total: 0, where: [] };
    if (!p.branch) g.rep = p; // head office first
    g.total += p.stockQty;
    g.where.push({ label: p.branch ? `${p.branch.code} — ${p.branch.name}` : 'Head office', qty: p.stockQty });
    groups.set(k, g);
  }
  const admin = isAdmin(req.user);
  res.json({
    items: [...groups.values()].map(({ rep: p, total, where }) => ({
      id: p._id, code: p.code, category: p.category, brand: p.brand, model: p.model, variant: p.variant, name: p.name, unitPrice: p.unitPricePaise / 100, stockQty: total, ...(admin ? { where } : {}),
    })),
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
  const out = present(o);
  // The admin deciding on an order sees where each product can be taken from.
  if (isAdmin(req.user) && o.status === 'pending') {
    for (let i = 0; i < o.items.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      out.items[i].sources = (await sourcesFor(o.items[i], o.branch._id || o.branch)).map(({ productId, ...s }) => s);
    }
  }
  res.json({ order: out });
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
    const p = await StockProduct.findOne({ _id: pid, isDeleted: false, isActive: true });
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
export async function transfer(source, branchId, qty, userId) {
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
        // Taken from the place the admin chose (head office or a branch); by default head office, else the branch with the most stock.
        const e = edits.find((x) => String(x?.id) === String(it._id));
        const options = await sourcesFor(it, o.branch);
        const wanted = e?.source ? options.find((s) => s.key === String(e.source)) : options.find((s) => s.key === 'ho' && s.stockQty >= qty) || options.find((s) => s.stockQty >= qty);
        if (!wanted) throw new HttpError(409, `${it.name} is not available for ${qty} unit${qty === 1 ? '' : 's'}${e?.source ? ' at the chosen place' : ''}`, { items: `Not enough stock of ${it.name}` });
        const source = await StockProduct.findOne({ _id: wanted.productId, isDeleted: false });
        if (!source) throw new HttpError(409, `${it.name} is no longer in stock`, { items: `${it.name} is no longer available` });
        await transfer(source, o.branch, qty, req.user._id);
        it.unitPricePaise = source.unitPricePaise; // the price of the stock it came from
        it.sourceBranch = wanted.key === 'ho' ? undefined : wanted.key; // goods taken from another branch move that branch's due to the one that ordered
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

// ---- purchase balance: what each branch bought, paid (received by the admin) and still owes ------------------------------
// The due to head office follows the goods: what a branch ordered from head office is its due; goods it passes on to another branch (a transfer,
// or an order of that branch filled from this one) are taken off its due and added to the due of the branch that gets them.
async function purchased(branchIds) {
  const rows = await ProductOrder.aggregate([
    { $match: { isDeleted: false, status: 'approved', ...(branchIds ? { branch: { $in: branchIds } } : {}) } },
    { $unwind: '$items' },
    { $group: { _id: '$branch', orders: { $addToSet: '$_id' }, amountPaise: { $sum: { $multiply: [{ $ifNull: ['$items.approvedQty', 0] }, { $ifNull: ['$items.unitPricePaise', 0] }] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { orders: r.orders.length, amountPaise: r.amountPaise }]));
}
/** Goods moved between places: value a branch got (in) and value it gave away (out). */
async function movedGoods(branchIds) {
  const only = branchIds ? new Set(branchIds.map(String)) : null;
  const map = new Map();
  const add = (id, field, v) => {
    if (!id || !v) return;
    const k = String(id);
    if (only && !only.has(k)) return;
    const cur = map.get(k) || { inPaise: 0, outPaise: 0 };
    cur[field] += v;
    map.set(k, cur);
  };
  const transfers = await StockTransfer.find({}).select('fromBranch toBranch quantity unitPricePaise').lean();
  transfers.forEach((t) => {
    const v = (t.unitPricePaise || 0) * t.quantity;
    add(t.toBranch, 'inPaise', v);
    add(t.fromBranch, 'outPaise', v);
  });
  // an order filled from another branch: the ordering branch's due is in its orders already, the giving branch's due goes down
  const filled = await ProductOrder.aggregate([
    { $match: { isDeleted: false, status: 'approved' } },
    { $unwind: '$items' },
    { $match: { 'items.sourceBranch': { $exists: true, $ne: null } } },
    { $group: { _id: '$items.sourceBranch', amountPaise: { $sum: { $multiply: [{ $ifNull: ['$items.approvedQty', 0] }, { $ifNull: ['$items.unitPricePaise', 0] }] } } } },
  ]);
  filled.forEach((r) => add(r._id, 'outPaise', r.amountPaise));
  return map;
}
// Payments by status: 'received' counts (older records without a status were recorded as received), 'paid' waits for the admin.
async function paidBy(branchIds, waiting) {
  const rows = await ProductPayment.aggregate([
    { $match: { isDeleted: false, status: waiting ? 'paid' : { $nin: ['paid', 'rejected'] }, ...(branchIds ? { branch: { $in: branchIds } } : {}) } },
    { $group: { _id: '$branch', amountPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { amountPaise: r.amountPaise, count: r.count }]));
}
async function balanceOf(branchId) {
  const ids = [new mongoose.Types.ObjectId(String(branchId))];
  const [p, q, w, mv] = await Promise.all([purchased(ids), paidBy(ids, false), paidBy(ids, true), movedGoods(ids)]);
  const moved = mv.get(String(branchId)) || { inPaise: 0, outPaise: 0 };
  const bought = (p.get(String(branchId))?.amountPaise || 0) + moved.inPaise - moved.outPaise;
  const received = q.get(String(branchId))?.amountPaise || 0;
  const waiting = w.get(String(branchId))?.amountPaise || 0;
  return { balance: bought - received, waiting, free: bought - received - waiting };
}

export async function purchaseBalance(req, res) {
  const ids = isAdmin(req.user) ? null : (req.user.branches || []).map((b) => new mongoose.Types.ObjectId(String(b)));
  const [p, q, w, mv] = await Promise.all([purchased(ids), paidBy(ids, false), paidBy(ids, true), movedGoods(ids)]);
  const keys = [...new Set([...p.keys(), ...q.keys(), ...w.keys(), ...mv.keys()])];
  const branches = await Branch.find({ _id: { $in: keys } }).select('code name');
  const rows = keys
    .map((k) => {
      const b = branches.find((x) => String(x._id) === k);
      const ordered = p.get(k)?.amountPaise || 0;
      const moved = mv.get(k) || { inPaise: 0, outPaise: 0 };
      const bought = ordered + moved.inPaise - moved.outPaise;
      const received = q.get(k)?.amountPaise || 0;
      const waiting = w.get(k)?.amountPaise || 0;
      return {
        branchId: k, branch: b ? { id: b._id, code: b.code, name: b.name } : null, orders: p.get(k)?.orders || 0, purchased: ordered / 100, transferredIn: moved.inPaise / 100, transferredOut: moved.outPaise / 100,
        net: bought / 100, paid: received / 100, waiting: waiting / 100, balance: (bought - received) / 100,
      };
    })
    .sort((a, b) => (a.branch?.code || '').localeCompare(b.branch?.code || ''));
  res.json({
    rows,
    total: { purchased: rows.reduce((s, r) => s + r.purchased, 0), transferredIn: rows.reduce((s, r) => s + r.transferredIn, 0), transferredOut: rows.reduce((s, r) => s + r.transferredOut, 0), paid: rows.reduce((s, r) => s + r.paid, 0), waiting: rows.reduce((s, r) => s + r.waiting, 0), balance: rows.reduce((s, r) => s + r.balance, 0) },
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
  status: p.status || 'received',
  receivedOn: p.receivedOn ? p.receivedOn.toISOString().slice(0, 10) : null,
  receivedByCode: p.receivedByCode || '',
  rejectReason: p.rejectReason || '',
  createdByCode: p.createdByCode || '',
  createdAt: p.createdAt,
});

export async function listPayments(req, res) {
  const filter = { isDeleted: false, ...scope(req.user) };
  if (mongoose.isValidObjectId(req.query.branch) && (isAdmin(req.user) || (req.user.branches || []).some((b) => String(b) === req.query.branch))) filter.branch = req.query.branch;
  const items = await ProductPayment.find(filter).populate(POPULATE).sort({ paidOn: -1, createdAt: -1 }).limit(200);
  res.json({ items: items.map(presentPayment) });
}

async function readPayment(req, b, { today }) {
  if (!mongoose.isValidObjectId(String(b.branch || ''))) throw invalid({ branch: 'Select the branch' });
  if (!(await Branch.exists({ _id: b.branch, isDeleted: false }))) throw invalid({ branch: 'Branch not found' });
  const amountPaise = toMinor(typeof b.amount === 'number' ? String(b.amount) : asString(b.amount));
  if (amountPaise === null || amountPaise < 100) throw invalid({ amount: 'Enter the amount (₹1 or more, up to 2 decimals)' });
  const paidOn = b.paidOn ? parseDateOnly(asString(b.paidOn)) : today;
  if (!paidOn) throw invalid({ paidOn: 'Enter a valid date' });
  if (paidOn > today) throw invalid({ paidOn: 'The payment date cannot be in the future' });
  const mode = asString(b.mode);
  if (!PAYMENT_MODES.includes(mode)) throw invalid({ mode: 'Select the payment mode' });
  const bankAccount = await readBankAccount(b, mode);
  return { amountPaise, paidOn, mode, bankAccount, reference: asString(b.reference).slice(0, 60), note: asString(b.note).slice(0, 200) };
}
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

/** A branch pays for the products it bought. It waits for the admin to receive it; it shows on the branch cashbook (payment side). */
export async function payToHeadOffice(req, res) {
  const b = req.body || {};
  if (!isAdmin(req.user)) {
    const mine = (req.user.branches || []).map(String);
    if (!b.branch && mine.length === 1) b.branch = mine[0];
    if (!mine.includes(String(b.branch))) throw new HttpError(403, 'You can only pay for your own branch');
  }
  const d = await readPayment(req, b, { today: startOfToday() });
  const bal = await balanceOf(b.branch);
  if (d.amountPaise > bal.free) {
    throw invalid({ amount: `The branch owes ₹${bal.balance / 100}${bal.waiting ? ` and ₹${bal.waiting / 100} is already paid and waiting to be received` : ''}. You can pay up to ₹${Math.max(bal.free, 0) / 100}.` });
  }
  const p = await ProductPayment.create({ branch: b.branch, ...d, status: 'paid', createdBy: req.user._id, createdByCode: req.user.employeeCode || '' });
  await p.populate(POPULATE);
  await audit(req, { action: 'productPayment.pay', entity: 'ProductPayment', entityId: p._id, after: { branch: p.branch.code, amount: d.amountPaise / 100, mode: d.mode } });
  res.status(201).json({ payment: presentPayment(p), balance: (bal.balance - d.amountPaise) / 100 });
}

/** Admin records a payment that was already received (it counts at once). */
export async function addPayment(req, res) {
  const b = req.body || {};
  const d = await readPayment(req, b, { today: startOfToday() });
  const bal = await balanceOf(b.branch);
  if (d.amountPaise > bal.free) throw invalid({ amount: `The branch owes only ₹${Math.max(bal.free, 0) / 100} that is not already paid. The payment cannot be more than that.` });
  const p = await ProductPayment.create({
    branch: b.branch, ...d, status: 'received', receivedOn: startOfToday(), receivedByCode: req.user.employeeCode || '', createdBy: req.user._id, createdByCode: req.user.employeeCode || '',
  });
  await p.populate(POPULATE);
  await audit(req, { action: 'productPayment.create', entity: 'ProductPayment', entityId: p._id, after: { branch: p.branch.code, amount: d.amountPaise / 100, mode: d.mode } });
  res.status(201).json({ payment: presentPayment(p), balance: (bal.balance - d.amountPaise) / 100 });
}

async function loadWaiting(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Payment not found');
  const p = await ProductPayment.findOne({ _id: req.params.id, isDeleted: false });
  if (!p) throw new HttpError(404, 'Payment not found');
  if (p.status !== 'paid') throw new HttpError(409, `This payment is already ${p.status || 'received'}`);
  return p;
}

/** Admin: the money has been received. Only now does it reduce what the branch owes (and show on the head-office cashbook). */
export async function receivePayment(req, res) {
  const p = await loadWaiting(req);
  p.status = 'received';
  p.receivedOn = startOfToday();
  p.receivedByCode = req.user.employeeCode || '';
  await p.save();
  await p.populate(POPULATE);
  await audit(req, { action: 'productPayment.receive', entity: 'ProductPayment', entityId: p._id, after: { branch: p.branch.code, amount: p.amountPaise / 100 } });
  res.json({ payment: presentPayment(p) });
}

export async function rejectPayment(req, res) {
  const p = await loadWaiting(req);
  const reason = asString(req.body?.reason);
  if (reason.length < 3 || reason.length > 200) throw invalid({ reason: 'Enter the reason (3–200 characters)' });
  p.status = 'rejected';
  p.rejectReason = reason;
  await p.save();
  await p.populate(POPULATE);
  await audit(req, { action: 'productPayment.reject', entity: 'ProductPayment', entityId: p._id, after: { branch: p.branch.code, amount: p.amountPaise / 100, reason } });
  res.json({ payment: presentPayment(p) });
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

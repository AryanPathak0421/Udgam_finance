import mongoose from 'mongoose';
import { StockEntry } from '../models/StockEntry.js';
import { StockProduct } from '../models/StockProduct.js';
import { StockTransfer } from '../models/StockTransfer.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, parseDateOnly, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { isAdmin } from './groupController.js';
import { scopeOf } from './stockProductController.js';

/** Product stock entry (stock received, with the quantity) and the Quantity Report. */
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const rupees = (p) => (p || 0) / 100;
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const oid = (v) => mongoose.isValidObjectId(String(v || ''));
const branchLabel = (b) => (b?._id ? `${b.code} — ${b.name}` : 'Head office');
const POP = { path: 'branch', select: 'code name' };

/** The branch filter of a request: "ho" is head office, an id a branch (never wider than the user's own). */
function placeFilter(req, field = 'branch') {
  const own = scopeOf(req.user);
  const wanted = asString(req.query.branch);
  if (wanted === 'ho') return isAdmin(req.user) ? { [field]: null } : { [field]: { $in: [] } };
  if (oid(wanted)) {
    if (isAdmin(req.user) || (req.user.branches || []).some((b) => String(b) === wanted)) return { [field]: new mongoose.Types.ObjectId(wanted) };
    return { [field]: { $in: [] } };
  }
  return own.branch ? { [field]: { $in: own.branch.$in.map((b) => new mongoose.Types.ObjectId(String(b))) } } : {};
}

const present = (e) => ({
  id: e._id, code: e.code, product: { id: e.product, code: e.productCode, name: e.productName }, place: branchLabel(e.branch), quantity: e.quantity, stockBefore: e.stockBefore, stockAfter: e.stockAfter,
  purchaseRate: e.purchaseRatePaise ? rupees(e.purchaseRatePaise) : null, amount: e.purchaseRatePaise ? rupees(e.purchaseRatePaise * e.quantity) : null, entryDate: iso(e.entryDate), supplier: e.supplier || '', billNo: e.billNo || '', remark: e.remark || '',
  status: e.status, cancelReason: e.cancelReason || '', by: e.byCode || '',
});

export async function listEntries(req, res) {
  const filter = { ...placeFilter(req) };
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) filter.entryDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const q = asString(req.query.q).toLowerCase();
  const rows = await StockEntry.find(filter).sort({ entryDate: -1, createdAt: -1 }).limit(1000).populate(POP).lean();
  const items = rows.map(present).filter((e) => !q || [e.code, e.product.code, e.product.name, e.supplier, e.billNo].some((v) => String(v).toLowerCase().includes(q)));
  const active = items.filter((e) => e.status === 'active');
  res.json({ items, summary: { entries: items.length, units: active.reduce((s, e) => s + e.quantity, 0), amount: active.reduce((s, e) => s + (e.amount || 0), 0) } });
}

/** Products an entry can be made for (active ones of the user's places). */
export async function entryProducts(req, res) {
  const rows = await StockProduct.find({ isDeleted: false, isActive: true, ...scopeOf(req.user) }).sort({ name: 1 }).limit(3000).populate(POP).lean();
  res.json({ items: rows.map((p) => ({ id: p._id, code: p.code, name: p.name, category: p.category, place: branchLabel(p.branch), stockQty: p.stockQty, unitPrice: rupees(p.unitPricePaise) })) });
}

export async function createEntry(req, res) {
  const b = req.body || {};
  if (!oid(b.product)) throw invalid({ product: 'Select the product' });
  const p = await StockProduct.findOne({ _id: b.product, isDeleted: false, ...scopeOf(req.user) }).populate(POP);
  if (!p) throw invalid({ product: 'Product not found' });
  const quantity = Number(b.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw invalid({ quantity: 'Enter the number of units received (1 to 100000)' });
  const entryDate = b.entryDate ? parseDateOnly(asString(b.entryDate)) : startOfToday();
  if (!entryDate) throw invalid({ entryDate: 'Enter a valid date' });
  if (entryDate > startOfToday()) throw invalid({ entryDate: 'The date cannot be in the future' });
  if (!isAdmin(req.user) && startOfToday().getTime() - entryDate.getTime() > 30 * 24 * 3600 * 1000) throw invalid({ entryDate: 'The date cannot be older than 30 days' });
  let rate;
  if (asString(b.purchaseRate) !== '') {
    rate = toMinor(typeof b.purchaseRate === 'number' ? String(b.purchaseRate) : asString(b.purchaseRate));
    if (rate === null || rate < 0) throw invalid({ purchaseRate: 'Enter the purchase rate per unit (₹, up to 2 decimals)' });
  }
  // the units are added in one step, so two entries at the same time never lose one
  const after = await StockProduct.findOneAndUpdate({ _id: p._id }, { $inc: { stockQty: quantity } }, { new: true });
  const e = await StockEntry.create({
    code: await generateCode('stockEntry'), product: p._id, productCode: p.code, productName: p.name, branch: p.branch?._id || null, quantity, stockBefore: after.stockQty - quantity, stockAfter: after.stockQty, purchaseRatePaise: rate,
    entryDate, supplier: asString(b.supplier).slice(0, 80), billNo: asString(b.billNo).slice(0, 40), remark: asString(b.remark).slice(0, 200), byCode: req.user.employeeCode || '', createdBy: req.user._id,
  });
  await e.populate(POP);
  await audit(req, { action: 'stockEntry.create', entity: 'StockEntry', entityId: e._id, after: { code: e.code, product: p.code, quantity, stockAfter: after.stockQty } });
  res.status(201).json({ item: present(e) });
}

/** Cancelling takes the units out again, which is only possible while they are still in stock. */
export async function cancelEntry(req, res) {
  if (!oid(req.params.id)) throw new HttpError(404, 'Entry not found');
  const e = await StockEntry.findById(req.params.id).populate(POP);
  if (!e) throw new HttpError(404, 'Entry not found');
  if (e.status === 'cancelled') throw new HttpError(409, 'This entry is already cancelled');
  const reason = asString(req.body?.reason).slice(0, 200);
  if (reason.length < 3) throw invalid({ reason: 'Enter the reason' });
  const done = await StockProduct.findOneAndUpdate({ _id: e.product, stockQty: { $gte: e.quantity } }, { $inc: { stockQty: -e.quantity } }, { new: true });
  if (!done) throw new HttpError(409, 'These units are not all in stock any more (they were ordered, sold or transferred), so the entry cannot be cancelled');
  e.status = 'cancelled';
  e.cancelReason = reason;
  await e.save();
  await audit(req, { action: 'stockEntry.cancel', entity: 'StockEntry', entityId: e._id, after: { code: e.code, reason } });
  res.json({ item: present(e) });
}

/** Quantity Report: every product with the units in stock, their value, the units received and transferred in the period. */
export async function quantityReport(req, res) {
  const from = parseDateOnly(asString(req.query.from)) || new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`);
  const to = parseDateOnly(asString(req.query.to)) || startOfToday();
  const filter = { isDeleted: false, ...placeFilter(req) };
  const category = asString(req.query.category);
  if (category) filter.category = category;
  const q = asString(req.query.q).toLowerCase();
  const low = Number(asString(req.query.low));
  const products = await StockProduct.find(filter).sort({ category: 1, name: 1 }).limit(5000).populate(POP).lean();
  const entered = new Map((await StockEntry.aggregate([{ $match: { status: 'active', entryDate: { $gte: from, $lte: to }, product: { $in: products.map((p) => p._id) } } }, { $group: { _id: '$product', n: { $sum: '$quantity' } } }])).map((r) => [String(r._id), r.n]));
  const moves = await StockTransfer.find({ createdAt: { $gte: from, $lt: new Date(to.getTime() + 24 * 3600 * 1000) } }).select('fromBranch toBranch name quantity').lean();
  const key = (name, branch) => `${name}|${branch ? String(branch) : 'ho'}`;
  const tin = new Map();
  const tout = new Map();
  moves.forEach((m) => {
    tin.set(key(m.name, m.toBranch), (tin.get(key(m.name, m.toBranch)) || 0) + m.quantity);
    tout.set(key(m.name, m.fromBranch), (tout.get(key(m.name, m.fromBranch)) || 0) + m.quantity);
  });
  let rows = products.map((p) => ({
    id: p._id, code: p.code, name: p.name, category: p.category, place: branchLabel(p.branch), isActive: p.isActive, unitPrice: rupees(p.unitPricePaise), stock: p.stockQty, value: rupees(p.stockQty * p.unitPricePaise),
    received: entered.get(String(p._id)) || 0, transferIn: tin.get(key(p.name, p.branch?._id)) || 0, transferOut: tout.get(key(p.name, p.branch?._id)) || 0,
  })).filter((r) => !q || [r.code, r.name, r.category].some((v) => String(v).toLowerCase().includes(q)));
  if (Number.isFinite(low) && asString(req.query.low) !== '') rows = rows.filter((r) => r.stock <= low);
  const sum = (f) => rows.reduce((s, r) => s + r[f], 0);
  const categories = [...new Set(products.map((p) => p.category))].sort();
  res.json({ from: iso(from), to: iso(to), rows, categories, totals: { products: rows.length, stock: sum('stock'), value: Math.round(sum('value') * 100) / 100, received: sum('received'), transferIn: sum('transferIn'), transferOut: sum('transferOut'), outOfStock: rows.filter((r) => r.stock === 0).length } });
}

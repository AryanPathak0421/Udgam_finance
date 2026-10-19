import mongoose from 'mongoose';
import { StockTransfer } from '../models/StockTransfer.js';
import { StockProduct } from '../models/StockProduct.js';
import { Branch } from '../models/Branch.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { transfer } from './stockOrderController.js';

const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const BR = [{ path: 'fromBranch', select: 'code name' }, { path: 'toBranch', select: 'code name' }];

// 'ho' (or empty) = head office, otherwise a branch id
async function place(v, field) {
  const s = asString(v);
  if (!s || s === 'ho') return null;
  if (!mongoose.isValidObjectId(s) || !(await Branch.exists({ _id: s, isDeleted: false }))) throw invalid({ [field]: 'Select a valid branch' });
  return s;
}

/** Products in stock at one place (head office or a branch), to choose from. */
export async function stockAt(req, res) {
  const from = await place(req.query.from, 'from');
  const items = await StockProduct.find({ isDeleted: false, isActive: true, stockQty: { $gt: 0 }, branch: from }).sort({ category: 1, name: 1 });
  res.json({ items: items.map((p) => ({ id: p._id, code: p.code, category: p.category, name: p.name, unitPrice: p.unitPricePaise / 100, stockQty: p.stockQty })) });
}

/**
 * Every product that is in stock somewhere, with the places (head office / branches) that have it: choosing a product shows only the places
 * that can give it.
 */
export async function productsWithPlaces(req, res) {
  const stock = await StockProduct.find({ isDeleted: false, isActive: true, stockQty: { $gt: 0 } }).populate('branch', 'code name').sort({ category: 1, name: 1 });
  const groups = new Map();
  for (const p of stock) {
    const key = [p.category, p.brand, p.model, p.variant || ''].map((x) => String(x || '').trim().toLowerCase()).join('|');
    if (!groups.has(key)) groups.set(key, { key, category: p.category, name: p.name, places: [] });
    groups.get(key).places.push({ place: p.branch ? String(p.branch._id) : 'ho', label: p.branch ? `${p.branch.code} — ${p.branch.name}` : 'Head office', stockId: p._id, stockQty: p.stockQty, unitPrice: p.unitPricePaise / 100 });
  }
  const items = [...groups.values()].map((g) => ({ ...g, places: g.places.sort((a, b) => (a.place === 'ho' ? -1 : b.place === 'ho' ? 1 : b.stockQty - a.stockQty)) }));
  res.json({ items });
}

const present = (t) => ({
  id: t._id, code: t.code, date: t.createdAt, from: t.fromBranch ? `${t.fromBranch.code} — ${t.fromBranch.name}` : 'Head office', to: t.toBranch ? `${t.toBranch.code} — ${t.toBranch.name}` : 'Head office',
  category: t.category, name: t.name, quantity: t.quantity, unitPrice: (t.unitPricePaise || 0) / 100, value: ((t.unitPricePaise || 0) * t.quantity) / 100, remark: t.remark || '', byCode: t.byCode || '',
});

/** Moves units of a product from one place to another. The destination gets the same product (a new entry if it has none). */
export async function createTransfer(req, res) {
  const b = req.body || {};
  const from = await place(b.from, 'from');
  const to = await place(b.to, 'to');
  if (String(from || '') === String(to || '')) throw invalid({ to: 'Choose a different place to move the stock to' });
  if (!mongoose.isValidObjectId(String(b.product || ''))) throw invalid({ product: 'Select the product' });
  const src = await StockProduct.findOne({ _id: b.product, isDeleted: false, isActive: true, branch: from });
  if (!src) throw invalid({ product: 'This product is not in stock at the chosen place' });
  const qty = Number(b.quantity);
  if (!Number.isInteger(qty) || qty < 1) throw invalid({ quantity: 'Enter the number of units (1 or more)' });
  if (qty > src.stockQty) throw invalid({ quantity: `Only ${src.stockQty} unit${src.stockQty === 1 ? '' : 's'} in stock there` });
  await transfer(src, to, qty, req.user._id);
  const t = await StockTransfer.create({
    code: await generateCode('stockTransfer'), fromBranch: from || undefined, toBranch: to || undefined, category: src.category, brand: src.brand, model: src.model, variant: src.variant, name: src.name,
    quantity: qty, unitPricePaise: src.unitPricePaise, remark: asString(b.remark).slice(0, 200), byCode: req.user.employeeCode || '', createdBy: req.user._id,
  });
  await t.populate(BR);
  await audit(req, { action: 'stockTransfer.create', entity: 'StockTransfer', entityId: t._id, after: { code: t.code, product: src.name, from: present(t).from, to: present(t).to, quantity: qty } });
  res.status(201).json({ transfer: present(t) });
}

export async function listTransfers(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = {};
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lt = new Date(to.getTime() + 24 * 3600 * 1000);
  }
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }, { category: rx }];
  }
  const [items, total] = await Promise.all([StockTransfer.find(filter).populate(BR).sort({ createdAt: -1 }).skip(skip).limit(limit), StockTransfer.countDocuments(filter)]);
  res.json({ items: items.map(present), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

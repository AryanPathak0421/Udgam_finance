import mongoose from 'mongoose';
import { StockProduct } from '../models/StockProduct.js';
import { Branch } from '../models/Branch.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, createValidator, escapeRegex, parsePaging, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { isAdmin } from './groupController.js';

const MAX_PRICE_PAISE = 10_000_000 * 100; // ₹1 crore per unit
export const DEFAULT_CATEGORIES = ['Electronics', 'Furniture', 'Home appliance', 'Mobile', 'Kitchen', 'Other'];

export const presentProduct = (p) => ({
  id: p._id,
  code: p.code,
  category: p.category || '',
  brand: p.brand || '',
  model: p.model || '',
  variant: p.variant || '',
  name: p.name,
  branch: p.branch?._id ? { id: p.branch._id, code: p.branch.code, name: p.branch.name } : null,
  branchId: p.branch?._id ? p.branch._id : p.branch || null,
  unitPrice: p.unitPricePaise / 100,
  stockQty: p.stockQty,
  isActive: p.isActive,
  createdAt: p.createdAt,
});

const POPULATE = { path: 'branch', select: 'code name' };

// Admins see every branch (and head office); everyone else only the stock of their own branches.
export const scopeOf = (user) => (isAdmin(user) ? {} : { branch: { $in: user.branches || [] } });

/** The branch an entry belongs to: admins choose any branch or head office (empty); others one of their own. */
function readBranch(req, v) {
  const raw = asString(req.body?.branch);
  if (!raw) {
    if (isAdmin(req.user)) return null; // head office
    const mine = req.user.branches || [];
    if (mine.length === 1) return mine[0];
    v.add('branch', 'Select the branch');
    return undefined;
  }
  if (!mongoose.isValidObjectId(raw)) {
    v.add('branch', 'Select the branch');
    return undefined;
  }
  if (!isAdmin(req.user) && !(req.user.branches || []).some((b) => String(b) === raw)) {
    throw new HttpError(403, 'You can only use branches assigned to you');
  }
  return raw;
}

function read(req, v) {
  const b = req.body || {};
  const out = {};
  const text = (key, label, { required, max = 60 } = {}) => {
    const s = asString(b[key]).replace(/\s+/g, ' ');
    if (required && !s) v.add(key, `${label} is required`);
    else if (s.length > max) v.add(key, `${label} can be up to ${max} characters`);
    out[key] = s;
  };
  text('category', 'Category', { required: true });
  text('brand', 'Brand', { required: true });
  text('model', 'Model', { required: true });
  text('variant', 'Variant', { max: 60 });
  out.name = [out.brand, out.model, out.variant].filter(Boolean).join(' ');
  const price = toMinor(b.unitPrice);
  if (price === null || price < 100 || price > MAX_PRICE_PAISE) v.add('unitPrice', 'Enter the sale price per unit (₹1 or more, up to 2 decimals)');
  else out.unitPricePaise = price;
  const qty = b.stockQty === '' || b.stockQty === undefined ? 0 : Number(b.stockQty);
  if (!Number.isInteger(qty) || qty < 0 || qty > 1_000_000) v.add('stockQty', 'Enter the quantity as a whole number (0 or more)');
  else out.stockQty = qty;
  out.branch = readBranch(req, v);
  return out;
}

const duplicate = () => new HttpError(409, 'This product (category, brand, model and variant) already exists for this branch', { model: 'This product is already entered for this branch' });

function listFilter(req) {
  const filter = { isDeleted: false, ...scopeOf(req.user) };
  const branch = asString(req.query.branch);
  if (branch === 'ho' && isAdmin(req.user)) filter.branch = null;
  else if (mongoose.isValidObjectId(branch)) {
    if (isAdmin(req.user) || (req.user.branches || []).some((b) => String(b) === branch)) filter.branch = branch;
  }
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;
  const category = asString(req.query.category);
  if (category) filter.category = new RegExp(`^${escapeRegex(category)}$`, 'i');
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }, { category: rx }, { brand: rx }, { model: rx }];
  }
  return filter;
}

export async function listProducts(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = listFilter(req);
  const [items, total] = await Promise.all([
    StockProduct.find(filter).populate(POPULATE).sort({ code: 1 }).skip(skip).limit(limit),
    StockProduct.countDocuments(filter),
  ]);
  res.json({ items: items.map(presentProduct), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

/** Branches that can be chosen on the entry form, and the categories already in use. */
export async function productOptions(req, res) {
  const admin = isAdmin(req.user);
  const branches = await Branch.find({ isDeleted: false, isActive: true, ...(admin ? {} : { _id: { $in: req.user.branches || [] } }) }).select('code name').sort({ code: 1 });
  const used = await StockProduct.distinct('category', { isDeleted: false, ...scopeOf(req.user) });
  const categories = [...new Set([...DEFAULT_CATEGORIES, ...used.filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  res.json({ branches: branches.map((b) => ({ id: b._id, code: b.code, name: b.name })), headOffice: admin, categories });
}

/** Stock report: products, units and value per branch (admin: all branches and head office). */
export async function stockReport(req, res) {
  const rows = await StockProduct.aggregate([
    { $match: { isDeleted: false, ...(isAdmin(req.user) ? {} : { branch: { $in: req.user.branches || [] } }) } },
    { $group: { _id: '$branch', products: { $sum: 1 }, units: { $sum: '$stockQty' }, valuePaise: { $sum: { $multiply: ['$stockQty', '$unitPricePaise'] } } } },
  ]);
  const branches = await Branch.find({ _id: { $in: rows.map((r) => r._id).filter(Boolean) } }).select('code name');
  const label = (id) => (id ? (branches.find((b) => String(b._id) === String(id)) ? `${branches.find((b) => String(b._id) === String(id)).code} — ${branches.find((b) => String(b._id) === String(id)).name}` : 'Branch') : 'Head office');
  const out = rows
    .map((r) => ({ branchId: r._id || null, branch: label(r._id), products: r.products, units: r.units, value: r.valuePaise / 100 }))
    .sort((a, b) => a.branch.localeCompare(b.branch));
  res.json({
    rows: out,
    total: { products: out.reduce((s, r) => s + r.products, 0), units: out.reduce((s, r) => s + r.units, 0), value: out.reduce((s, r) => s + r.value, 0) },
  });
}

export async function createProduct(req, res) {
  const v = createValidator();
  const data = read(req, v);
  v.throwIfAny();
  let doc;
  try {
    doc = await StockProduct.create({ ...data, code: await generateCode('stockProduct'), createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  await doc.populate(POPULATE);
  await audit(req, { action: 'stockProduct.create', entity: 'StockProduct', entityId: doc._id, after: presentProduct(doc) });
  res.status(201).json({ product: presentProduct(doc) });
}

async function load(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Product not found');
  const p = await StockProduct.findOne({ _id: req.params.id, isDeleted: false, ...scopeOf(req.user) });
  if (!p) throw new HttpError(404, 'Product not found');
  return p;
}

export async function updateProduct(req, res) {
  const doc = await load(req);
  const v = createValidator();
  const data = read(req, v);
  v.throwIfAny();
  const before = presentProduct(doc);
  Object.assign(doc, { ...data, updatedBy: req.user._id });
  try {
    await doc.save();
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  await doc.populate(POPULATE);
  await audit(req, { action: 'stockProduct.update', entity: 'StockProduct', entityId: doc._id, before, after: presentProduct(doc) });
  res.json({ product: presentProduct(doc) });
}

export async function setProductStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const doc = await load(req);
  doc.isActive = req.body.isActive;
  doc.updatedBy = req.user._id;
  await doc.save();
  await doc.populate(POPULATE);
  await audit(req, { action: doc.isActive ? 'stockProduct.activate' : 'stockProduct.deactivate', entity: 'StockProduct', entityId: doc._id });
  res.json({ product: presentProduct(doc) });
}

export async function deleteProduct(req, res) {
  const doc = await load(req);
  doc.isDeleted = true;
  doc.isActive = false;
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: 'stockProduct.delete', entity: 'StockProduct', entityId: doc._id });
  res.json({ message: 'Product deleted' });
}

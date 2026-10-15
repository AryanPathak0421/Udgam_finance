import mongoose from 'mongoose';
import { StockProduct } from '../models/StockProduct.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, createValidator, escapeRegex, parsePaging, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';

const MAX_PRICE_PAISE = 10_000_000 * 100; // ₹1 crore per unit

export const presentProduct = (p) => ({
  id: p._id,
  code: p.code,
  name: p.name,
  category: p.category || '',
  unitPrice: p.unitPricePaise / 100,
  stockQty: p.stockQty,
  isActive: p.isActive,
  createdAt: p.createdAt,
});

function read(b, v) {
  const out = {};
  out.name = asString(b.name);
  if (out.name.length < 2 || out.name.length > 100) v.add('name', 'Product name must be 2–100 characters');
  out.category = asString(b.category);
  if (out.category.length > 60) v.add('category', 'Category can be up to 60 characters');
  const price = toMinor(b.unitPrice);
  if (price === null || price < 100 || price > MAX_PRICE_PAISE) v.add('unitPrice', 'Enter the price per unit (₹1 or more, up to 2 decimals)');
  else out.unitPricePaise = price;
  const qty = b.stockQty === '' || b.stockQty === undefined ? 0 : Number(b.stockQty);
  if (!Number.isInteger(qty) || qty < 0 || qty > 1_000_000) v.add('stockQty', 'Enter the stock as a whole number (0 or more)');
  else out.stockQty = qty;
  return out;
}

const duplicate = () => new HttpError(409, 'A product with this name already exists', { name: 'This product name is already used' });

export async function listProducts(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { isDeleted: false };
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }, { category: rx }];
  }
  const [items, total] = await Promise.all([
    StockProduct.find(filter).sort({ code: 1 }).skip(skip).limit(limit),
    StockProduct.countDocuments(filter),
  ]);
  res.json({ items: items.map(presentProduct), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

export async function createProduct(req, res) {
  const v = createValidator();
  const data = read(req.body || {}, v);
  v.throwIfAny();
  if (await StockProduct.exists({ name: data.name, isDeleted: false }).collation({ locale: 'en', strength: 2 })) throw duplicate();
  let doc;
  try {
    doc = await StockProduct.create({ ...data, code: await generateCode('stockProduct'), createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  await audit(req, { action: 'stockProduct.create', entity: 'StockProduct', entityId: doc._id, after: doc });
  res.status(201).json({ product: presentProduct(doc) });
}

async function load(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Product not found');
  const p = await StockProduct.findOne({ _id: req.params.id, isDeleted: false });
  if (!p) throw new HttpError(404, 'Product not found');
  return p;
}

export async function updateProduct(req, res) {
  const doc = await load(req);
  const v = createValidator();
  const data = read(req.body || {}, v);
  v.throwIfAny();
  const before = doc.toObject();
  Object.assign(doc, { ...data, updatedBy: req.user._id });
  try {
    await doc.save();
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  await audit(req, { action: 'stockProduct.update', entity: 'StockProduct', entityId: doc._id, before, after: doc });
  res.json({ product: presentProduct(doc) });
}

export async function setProductStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const doc = await load(req);
  doc.isActive = req.body.isActive;
  doc.updatedBy = req.user._id;
  await doc.save();
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

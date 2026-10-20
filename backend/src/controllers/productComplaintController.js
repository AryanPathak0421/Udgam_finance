import mongoose from 'mongoose';
import { ProductComplaint, COMPLAINT_STATUS } from '../models/ProductComplaint.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { branchFilter } from './groupController.js';
import { asString, escapeRegex, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const IMAGE_RE = /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 1_600_000;
const POPULATE = [{ path: 'branch', select: 'code name' }];
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);

const present = (c, withBill = false) => ({
  id: c._id,
  code: c.code,
  branch: c.branch?._id ? { id: c.branch._id, code: c.branch.code, name: c.branch.name } : null,
  memberCode: c.memberCode,
  memberName: c.memberName || '',
  loanId: c.loanId || '',
  product: c.product ? { code: c.product.code || '', name: c.product.name || '', quantity: c.product.quantity || 1, unitPrice: (c.product.unitPricePaise || 0) / 100 } : null,
  soldOn: c.soldOn || null,
  remark: c.remark || '',
  status: c.status,
  createdAt: c.createdAt,
  createdByCode: c.createdByCode || '',
  resolvedAt: c.resolvedAt || null,
  resolvedByCode: c.resolvedByCode || '',
  resolution: c.resolution || '',
  deliveredAt: c.deliveredAt || null,
  deliveredByCode: c.deliveredByCode || '',
  ...(withBill ? { billPhoto: c.billPhoto || '' } : {}),
});

const LOAN_FIELDS = 'loanId formId branch paidOn loanType kind schemeName lines.member lines.code lines.name lines.productPaise lines.products';

// The products of one borrower's line of a loan. A product loan of the old system has no product list: it is one product named after its scheme.
function productsOf(loan, line) {
  if (line.products?.length) return line.products;
  if (loan.loanType === 'product' || loan.kind === 'product') return [{ code: '', name: `Product (${loan.schemeName || 'old system'})`, quantity: 1, unitPricePaise: line.productPaise || 0 }];
  return [];
}

/** The products that were sold to members with a loan, newest first: what a complaint can be about. */
export async function sales(req, res) {
  const filter = { status: 'paid', ...branchFilter(req.user), $and: [{ $or: [{ 'lines.productPaise': { $gt: 0 } }, { loanType: 'product' }, { kind: 'product' }] }] };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$and.push({ $or: [{ loanId: rx }, { formId: rx }, { 'lines.code': rx }, { 'lines.name': rx }, { 'lines.products.name': rx }] });
  }
  const loans = await LoanPayment.find(filter).select(LOAN_FIELDS).populate(POPULATE).sort({ paidOn: -1 }).limit(60).lean();
  const items = [];
  for (const l of loans) {
    for (const line of l.lines) {
      productsOf(l, line).forEach((p, i) => items.push({
        key: `${l._id}|${line.code}|${i}`, loanPayment: l._id, loanId: l.loanId || l.formId || '', memberCode: line.code, memberName: line.name || '',
        branch: l.branch ? { id: l.branch._id, name: l.branch.name } : null, soldOn: l.paidOn,
        product: { code: p.code || '', name: p.name || '', quantity: p.quantity || 1, unitPrice: (p.unitPricePaise || 0) / 100 }, productIndex: i,
      }));
    }
  }
  res.json({ items: items.slice(0, 100) });
}

async function nextCode() {
  const n = await ProductComplaint.countDocuments({});
  return `CMP${String(n + 1).padStart(5, '0')}`;
}

/** The branch raises a complaint about a sold product, with the bill. */
export async function create(req, res) {
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.loanPayment)) throw invalid({ sale: 'Select the sold product' });
  const loan = await LoanPayment.findOne({ _id: b.loanPayment, status: 'paid', ...branchFilter(req.user) }).select(LOAN_FIELDS);
  if (!loan) throw new HttpError(404, 'Sale not found');
  const line = loan.lines.find((x) => x.code === asString(b.memberCode));
  if (!line) throw invalid({ sale: 'Select the sold product' });
  const idx = Number.isInteger(Number(b.productIndex)) ? Number(b.productIndex) : 0;
  const p = productsOf(loan, line)[idx];
  if (!p) throw invalid({ sale: 'This sale has no product' });

  const errors = {};
  const bill = b.billPhoto;
  if (!bill) errors.billPhoto = 'Upload the bill';
  else if (typeof bill !== 'string' || !IMAGE_RE.test(bill)) errors.billPhoto = 'The bill must be a PNG or JPEG image';
  else if (bill.length > MAX_IMAGE_CHARS) errors.billPhoto = 'The bill image is too large';
  const remark = asString(b.remark).slice(0, 300);
  if (remark.length < 3) errors.remark = 'Write what is wrong with the product (at least 3 characters)';
  if (Object.keys(errors).length) throw invalid(errors);

  const open = await ProductComplaint.findOne({ loanPayment: loan._id, memberCode: line.code, 'product.name': p.name, status: { $ne: 'delivered' } });
  if (open) throw new HttpError(409, `A complaint (${open.code}) about this product is already open`, { sale: 'A complaint about this product is already open' });

  let doc;
  for (let tries = 0; tries < 5 && !doc; tries += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      doc = await ProductComplaint.create({
        code: await nextCode(), branch: loan.branch, member: line.member, memberCode: line.code, memberName: line.name, loanPayment: loan._id, loanId: loan.loanId || loan.formId,
        product: { code: p.code, name: p.name, quantity: p.quantity || 1, unitPricePaise: p.unitPricePaise || 0 }, soldOn: loan.paidOn, billPhoto: bill, remark,
        createdBy: req.user._id, createdByCode: req.user.employeeCode || '',
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  if (!doc) throw new HttpError(409, 'Could not number the complaint. Please try again.');
  await doc.populate(POPULATE);
  await audit(req, { action: 'productComplaint.create', entity: 'ProductComplaint', entityId: doc._id, after: { code: doc.code, member: doc.memberCode, product: p.name } });
  res.status(201).json({ complaint: present(doc) });
}

export async function list(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { ...branchFilter(req.user) };
  if (COMPLAINT_STATUS.includes(req.query.status)) filter.status = req.query.status;
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { memberCode: rx }, { memberName: rx }, { loanId: rx }, { 'product.name': rx }];
  }
  const [items, total, submitted] = await Promise.all([
    ProductComplaint.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ProductComplaint.countDocuments(filter),
    ProductComplaint.countDocuments({ ...branchFilter(req.user), status: 'submitted' }),
  ]);
  res.json({ items: items.map((c) => present(c)), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1), submitted });
}

async function load(req, withBill = false) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Complaint not found');
  let q = ProductComplaint.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (withBill) q = q.select('+billPhoto');
  const c = await q.populate(POPULATE);
  if (!c) throw new HttpError(404, 'Complaint not found');
  return c;
}

export async function getOne(req, res) {
  res.json({ complaint: present(await load(req, true), true) });
}

/** The admin resolves a complaint. */
export async function resolve(req, res) {
  const c = await load(req);
  if (c.status !== 'submitted') throw new HttpError(409, `This complaint is already ${c.status}`);
  const resolution = asString(req.body?.resolution).slice(0, 300);
  if (resolution.length < 3) throw invalid({ resolution: 'Write how the complaint is resolved (at least 3 characters)' });
  c.status = 'resolved';
  c.resolution = resolution;
  c.resolvedAt = new Date();
  c.resolvedByCode = req.user.employeeCode || '';
  await c.save();
  await audit(req, { action: 'productComplaint.resolve', entity: 'ProductComplaint', entityId: c._id, after: { code: c.code, resolution } });
  res.json({ complaint: present(c) });
}

/** The branch confirms that the resolution has reached the member. */
export async function deliver(req, res) {
  const c = await load(req);
  if (c.status !== 'resolved') throw new HttpError(409, c.status === 'submitted' ? 'The admin has not resolved this complaint yet' : 'This complaint is already delivered');
  c.status = 'delivered';
  c.deliveredAt = new Date();
  c.deliveredByCode = req.user.employeeCode || '';
  await c.save();
  await audit(req, { action: 'productComplaint.deliver', entity: 'ProductComplaint', entityId: c._id, after: { code: c.code } });
  res.json({ complaint: present(c) });
}

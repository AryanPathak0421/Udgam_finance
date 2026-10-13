import { Branch } from '../models/Branch.js';
import { INDIA_LOCATIONS } from '../data/indiaLocations.js';
import { asString, createValidator, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const CODE_RE = /^[A-Z0-9-]{2,12}$/;
const SORTABLE = new Set(['code', 'name', 'state', 'city', 'openingDate', 'createdAt']);

const present = (b) => ({
  id: b._id,
  code: b.code,
  name: b.name,
  address: b.address,
  state: b.state,
  city: b.city,
  openingDate: b.openingDate.toISOString().slice(0, 10),
  isActive: b.isActive,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

function validateBranch(b, { requireCode }) {
  const v = createValidator();
  const out = {
    code: asString(b.code).toUpperCase(),
    name: asString(b.name),
    address: asString(b.address),
    state: asString(b.state),
    city: asString(b.city),
    openingDate: parseDateOnly(b.openingDate),
  };
  if (requireCode && !CODE_RE.test(out.code)) v.add('code', 'Code must be 2–12 characters: letters, numbers or hyphen');
  if (out.name.length < 2 || out.name.length > 100) v.add('name', 'Branch name must be 2–100 characters');
  if (out.address.length < 5 || out.address.length > 300) v.add('address', 'Address must be 5–300 characters');
  if (!INDIA_LOCATIONS[out.state]) v.add('state', 'Select a valid state');
  else if (!INDIA_LOCATIONS[out.state].includes(out.city)) v.add('city', 'Select a city from the list for this state');
  if (!out.openingDate) v.add('openingDate', 'Enter a valid opening date');
  v.throwIfAny();
  return out;
}

const duplicateCode = () => new HttpError(409, 'Branch code already exists', { code: 'This branch code is already in use' });

export async function listBranches(req, res) {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { isDeleted: false };

  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }, { city: rx }];
  }
  const state = asString(req.query.state);
  if (state) filter.state = state;
  const status = asString(req.query.status);
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;

  const sortField = SORTABLE.has(req.query.sort) ? req.query.sort : 'createdAt';
  const sortDir = req.query.order === 'asc' ? 1 : -1;

  const [items, total] = await Promise.all([
    Branch.find(filter).sort({ [sortField]: sortDir, _id: 1 }).skip(skip).limit(limit),
    Branch.countDocuments(filter),
  ]);

  res.json({
    items: items.map(present),
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  });
}

// Lightweight list of active branches for dropdowns / multi-selects.
export async function branchOptions(_req, res) {
  const items = await Branch.find({ isDeleted: false, isActive: true }).sort({ code: 1 });
  res.json({ items: items.map((b) => ({ id: b._id, code: b.code, name: b.name })) });
}

export async function getBranch(req, res) {
  const branch = await Branch.findOne({ _id: req.params.id, isDeleted: false });
  if (!branch) throw new HttpError(404, 'Branch not found');
  res.json({ branch: present(branch) });
}

export async function createBranch(req, res) {
  const data = validateBranch(req.body || {}, { requireCode: true });
  if (await Branch.exists({ code: data.code, isDeleted: false })) throw duplicateCode();

  let branch;
  try {
    branch = await Branch.create({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw duplicateCode();
    throw err;
  }
  await audit(req, { action: 'branch.create', entity: 'Branch', entityId: branch._id, after: branch });
  res.status(201).json({ branch: present(branch) });
}

export async function updateBranch(req, res) {
  const branch = await Branch.findOne({ _id: req.params.id, isDeleted: false });
  if (!branch) throw new HttpError(404, 'Branch not found');

  const data = validateBranch(req.body || {}, { requireCode: false });
  const before = branch.toObject();
  // `code` is immutable once created; only the editable fields are applied.
  Object.assign(branch, {
    name: data.name,
    address: data.address,
    state: data.state,
    city: data.city,
    openingDate: data.openingDate,
    updatedBy: req.user._id,
  });
  await branch.save();
  await audit(req, { action: 'branch.update', entity: 'Branch', entityId: branch._id, before, after: branch });
  res.json({ branch: present(branch) });
}

export async function setBranchStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const branch = await Branch.findOne({ _id: req.params.id, isDeleted: false });
  if (!branch) throw new HttpError(404, 'Branch not found');

  const before = branch.toObject();
  branch.isActive = req.body.isActive;
  branch.updatedBy = req.user._id;
  await branch.save();
  await audit(req, {
    action: branch.isActive ? 'branch.activate' : 'branch.deactivate',
    entity: 'Branch',
    entityId: branch._id,
    before,
    after: branch,
  });
  res.json({ branch: present(branch) });
}

// Soft delete: keeps history/audit intact and frees the code for reuse.
export async function deleteBranch(req, res) {
  const branch = await Branch.findOne({ _id: req.params.id, isDeleted: false });
  if (!branch) throw new HttpError(404, 'Branch not found');

  const before = branch.toObject();
  branch.isDeleted = true;
  branch.isActive = false;
  branch.updatedBy = req.user._id;
  await branch.save();
  await audit(req, { action: 'branch.delete', entity: 'Branch', entityId: branch._id, before });
  res.json({ message: 'Branch deleted' });
}

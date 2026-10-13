import { Rank } from '../models/Rank.js';
import { User } from '../models/User.js';
import { asString, createValidator, escapeRegex, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const CODE_RE = /^[A-Z0-9-]{2,10}$/;

const present = (r, userCount) => ({
  id: r._id,
  code: r.code,
  name: r.name,
  level: r.level,
  description: r.description || '',
  isActive: r.isActive,
  ...(userCount !== undefined ? { userCount } : {}),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

function validateRank(b) {
  const v = createValidator();
  const out = {
    code: asString(b.code).toUpperCase(),
    name: asString(b.name),
    level: Number(b.level),
    description: asString(b.description),
  };
  if (!CODE_RE.test(out.code)) v.add('code', 'Code must be 2–10 characters: letters, numbers or hyphen');
  if (out.name.length < 2 || out.name.length > 80) v.add('name', 'Rank name must be 2–80 characters');
  if (!Number.isInteger(out.level) || out.level < 1 || out.level > 99) v.add('level', 'Level must be a whole number from 1 to 99');
  if (out.description.length > 200) v.add('description', 'Description must be 200 characters or fewer');
  v.throwIfAny();
  return out;
}

const duplicate = (err) => {
  const field = Object.keys(err.keyPattern || {})[0] === 'name' ? 'name' : 'code';
  return new HttpError(409, `Rank ${field} already exists`, { [field]: `This rank ${field} is already in use` });
};

export async function listRanks(req, res) {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { isDeleted: false };
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }];
  }
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;

  const [items, total] = await Promise.all([
    Rank.find(filter).sort({ level: 1, name: 1 }).skip(skip).limit(limit),
    Rank.countDocuments(filter),
  ]);
  const counts = await User.aggregate([
    { $match: { rank: { $in: items.map((i) => i._id) } } },
    { $group: { _id: '$rank', n: { $sum: 1 } } },
  ]);
  const byRank = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));

  res.json({
    items: items.map((r) => present(r, byRank[String(r._id)] || 0)),
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  });
}

export async function rankOptions(_req, res) {
  const items = await Rank.find({ isDeleted: false, isActive: true }).sort({ level: 1, name: 1 });
  res.json({ items: items.map((r) => ({ id: r._id, code: r.code, name: r.name, level: r.level })) });
}

export async function createRank(req, res) {
  const data = validateRank(req.body || {});
  let rank;
  try {
    rank = await Rank.create({ ...data, createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw duplicate(err);
    throw err;
  }
  await audit(req, { action: 'rank.create', entity: 'Rank', entityId: rank._id, after: rank });
  res.status(201).json({ rank: present(rank, 0) });
}

export async function updateRank(req, res) {
  const rank = await Rank.findOne({ _id: req.params.id, isDeleted: false });
  if (!rank) throw new HttpError(404, 'Rank not found');
  const data = validateRank(req.body || {});
  const before = rank.toObject();
  Object.assign(rank, { ...data, updatedBy: req.user._id });
  try {
    await rank.save();
  } catch (err) {
    if (err.code === 11000) throw duplicate(err);
    throw err;
  }
  await audit(req, { action: 'rank.update', entity: 'Rank', entityId: rank._id, before, after: rank });
  res.json({ rank: present(rank) });
}

export async function setRankStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const rank = await Rank.findOne({ _id: req.params.id, isDeleted: false });
  if (!rank) throw new HttpError(404, 'Rank not found');
  const before = rank.toObject();
  rank.isActive = req.body.isActive;
  rank.updatedBy = req.user._id;
  await rank.save();
  await audit(req, { action: rank.isActive ? 'rank.activate' : 'rank.deactivate', entity: 'Rank', entityId: rank._id, before, after: rank });
  res.json({ rank: present(rank) });
}

export async function deleteRank(req, res) {
  const rank = await Rank.findOne({ _id: req.params.id, isDeleted: false });
  if (!rank) throw new HttpError(404, 'Rank not found');
  const inUse = await User.countDocuments({ rank: rank._id });
  if (inUse > 0) {
    throw new HttpError(409, `This rank is assigned to ${inUse} user${inUse > 1 ? 's' : ''}. Reassign them or deactivate the rank instead.`);
  }
  const before = rank.toObject();
  rank.isDeleted = true;
  rank.isActive = false;
  rank.updatedBy = req.user._id;
  await rank.save();
  await audit(req, { action: 'rank.delete', entity: 'Rank', entityId: rank._id, before });
  res.json({ message: 'Rank deleted' });
}

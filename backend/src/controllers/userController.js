import mongoose from 'mongoose';
import { User, ROLES } from '../models/User.js';
import { Rank } from '../models/Rank.js';
import { Branch } from '../models/Branch.js';
import { asString, createValidator, escapeRegex, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;

const present = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  mobile: u.mobile || '',
  role: u.role,
  rank: u.rank && u.rank._id ? { id: u.rank._id, code: u.rank.code, name: u.rank.name } : null,
  rankId: u.rank?._id ? String(u.rank._id) : u.rank ? String(u.rank) : '',
  branches: (u.branches || []).map((b) => (b._id ? { id: b._id, code: b.code, name: b.name } : { id: b })),
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt || null,
  hasCustomMenus: Array.isArray(u.menuPermissions),
  createdAt: u.createdAt,
});

const populate = [
  { path: 'rank', select: 'code name' },
  { path: 'branches', select: 'code name' },
];

const isSuper = (user) => user.role === 'super_admin';

// Admins may not create or modify super admins.
function assertCanManage(actor, target) {
  if (target.role === 'super_admin' && !isSuper(actor)) throw new HttpError(403, 'Only a super admin can manage super admin users');
}

async function resolveRefs(body, v) {
  const rankId = asString(body.rank);
  let rank = null;
  if (!mongoose.isValidObjectId(rankId)) v.add('rank', 'Select a rank');
  else {
    rank = await Rank.findOne({ _id: rankId, isDeleted: false });
    if (!rank) v.add('rank', 'Selected rank does not exist');
    else if (!rank.isActive) v.add('rank', 'Selected rank is inactive');
  }

  const rawBranches = Array.isArray(body.branches) ? body.branches.map(String) : [];
  let branches = [];
  if (!rawBranches.length) v.add('branches', 'Select at least one branch');
  else if (!rawBranches.every((id) => mongoose.isValidObjectId(id))) v.add('branches', 'Invalid branch selection');
  else {
    const ids = [...new Set(rawBranches)];
    branches = await Branch.find({ _id: { $in: ids }, isDeleted: false });
    if (branches.length !== ids.length) v.add('branches', 'One or more selected branches no longer exist');
  }
  return { rank, branches };
}

export async function listUsers(req, res) {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = {};
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { mobile: rx }];
  }
  if (mongoose.isValidObjectId(req.query.rank)) filter.rank = req.query.rank;
  if (ROLES.includes(req.query.role)) filter.role = req.query.role;
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;

  const [items, total] = await Promise.all([
    User.find(filter).populate(populate).sort({ createdAt: -1, _id: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ items: items.map(present), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

export async function createUser(req, res) {
  const b = req.body || {};
  const v = createValidator();
  const name = asString(b.name);
  const email = asString(b.email).toLowerCase();
  const mobile = asString(b.mobile);
  const password = typeof b.password === 'string' ? b.password : '';
  const role = asString(b.role);

  if (name.length < 2 || name.length > 100) v.add('name', 'Name must be 2–100 characters');
  if (!EMAIL_RE.test(email)) v.add('email', 'Enter a valid email address');
  if (mobile && !MOBILE_RE.test(mobile)) v.add('mobile', 'Enter a valid 10-digit mobile number');
  if (!PASSWORD_RE.test(password)) v.add('password', 'Password must be 8–64 characters with letters and numbers');
  if (!ROLES.includes(role)) v.add('role', 'Select a role');
  else if (role === 'super_admin' && !isSuper(req.user)) v.add('role', 'Only a super admin can create a super admin');
  const { rank, branches } = await resolveRefs(b, v);
  v.throwIfAny();

  if (await User.exists({ email })) throw new HttpError(409, 'Email already exists', { email: 'This email is already registered' });

  let user;
  try {
    user = await User.create({
      name, email, mobile: mobile || undefined, password, role,
      rank: rank._id, branches: branches.map((x) => x._id),
      isActive: b.isActive !== false, createdBy: req.user._id, updatedBy: req.user._id,
    });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'Email already exists', { email: 'This email is already registered' });
    throw err;
  }
  await user.populate(populate);
  await audit(req, { action: 'user.create', entity: 'User', entityId: user._id, after: { ...user.toObject(), password: undefined } });
  res.status(201).json({ user: present(user) });
}

export async function updateUser(req, res) {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  assertCanManage(req.user, user);

  const b = req.body || {};
  const v = createValidator();
  const name = asString(b.name);
  const mobile = asString(b.mobile);
  const role = asString(b.role);

  if (name.length < 2 || name.length > 100) v.add('name', 'Name must be 2–100 characters');
  if (mobile && !MOBILE_RE.test(mobile)) v.add('mobile', 'Enter a valid 10-digit mobile number');
  if (!ROLES.includes(role)) v.add('role', 'Select a role');
  else if (role !== user.role) {
    if (String(user._id) === String(req.user._id)) v.add('role', 'You cannot change your own role');
    if (role === 'super_admin' && !isSuper(req.user)) v.add('role', 'Only a super admin can assign super admin');
  }
  const { rank, branches } = await resolveRefs(b, v);
  v.throwIfAny();

  const before = { ...user.toObject(), password: undefined };
  Object.assign(user, {
    name, mobile: mobile || undefined, role,
    rank: rank._id, branches: branches.map((x) => x._id), updatedBy: req.user._id,
  });
  await user.save();
  await user.populate(populate);
  await audit(req, { action: 'user.update', entity: 'User', entityId: user._id, before, after: { ...user.toObject(), password: undefined } });
  res.json({ user: present(user) });
}

export async function setUserStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found');
  assertCanManage(req.user, user);
  if (String(user._id) === String(req.user._id)) throw new HttpError(409, 'You cannot deactivate your own account');

  user.isActive = req.body.isActive;
  user.updatedBy = req.user._id;
  await user.save();
  await user.populate(populate);
  await audit(req, { action: user.isActive ? 'user.activate' : 'user.deactivate', entity: 'User', entityId: user._id });
  res.json({ user: present(user) });
}

export async function resetUserPassword(req, res) {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!PASSWORD_RE.test(password)) {
    throw new HttpError(422, 'Please correct the highlighted fields', { password: 'Password must be 8–64 characters with letters and numbers' });
  }
  const user = await User.findById(req.params.id).select('+password');
  if (!user) throw new HttpError(404, 'User not found');
  assertCanManage(req.user, user);

  user.password = password;
  user.failedAttempts = 0;
  user.lockUntil = undefined;
  user.updatedBy = req.user._id;
  await user.save();
  await audit(req, { action: 'user.resetPassword', entity: 'User', entityId: user._id });
  res.json({ message: 'Password reset' });
}

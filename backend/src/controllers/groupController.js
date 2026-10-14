import mongoose from 'mongoose';
import { Group } from '../models/Group.js';
import { Branch } from '../models/Branch.js';
import { GroupDisbursement } from '../models/GroupDisbursement.js';
import { GroupLeaderCommission } from '../models/GroupLeaderCommission.js';
import { generateCode } from '../services/codeSequence.js';
import { loadRuleContext, ruleForMonth, payoutMonths, syncGroupEntries } from '../services/groupLeaderPayout.js';
import { parseMonth } from '../services/groupLeaderCommission.js';
import { asString, createValidator, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const MOBILE_RE = /^[6-9]\d{9}$/;
const ADMIN_ROLES = ['super_admin', 'admin'];
// Who may see a full mobile number (everyone else sees it masked).
const FULL_MOBILE_ROLES = ['super_admin', 'admin', 'accountant'];

export const isAdmin = (user) => ADMIN_ROLES.includes(user.role);
export const maskMobile = (m) => (m ? `XXXXXX${String(m).slice(-4)}` : '');
export const showMobile = (user, m) => (FULL_MOBILE_ROLES.includes(user.role) ? m : maskMobile(m));

// Branch isolation: everyone except admins only sees the branches they are assigned to.
export const branchFilter = (user) => (isAdmin(user) ? {} : { branch: { $in: user.branches || [] } });

const POPULATE = { path: 'branch', select: 'code name' };

const present = (g, user) => ({
  id: g._id,
  code: g.code,
  name: g.name,
  branch: g.branch?._id ? { id: g.branch._id, code: g.branch.code, name: g.branch.name } : null,
  branchId: String(g.branch?._id || g.branch),
  leaderName: g.leaderName,
  leaderMobile: showMobile(user, g.leaderMobile),
  mobileMasked: !FULL_MOBILE_ROLES.includes(user.role),
  formationDate: g.formationDate ? g.formationDate.toISOString().slice(0, 10) : null,
  isActive: g.isActive,
  createdAt: g.createdAt,
});

async function loadGroup(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Group not found');
  const g = await Group.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) });
  if (!g) throw new HttpError(404, 'Group not found');
  return g;
}

export async function listGroups(req, res) {
  const { page, limit, skip } = parsePaging(req.query);
  const filter = { isDeleted: false, ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }, { leaderName: rx }];
  }
  const [items, total] = await Promise.all([
    Group.find(filter).populate(POPULATE).sort({ code: 1 }).skip(skip).limit(limit),
    Group.countDocuments(filter),
  ]);
  res.json({ items: items.map((g) => present(g, req.user)), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

// Branches the caller may use when creating a group.
export async function groupBranchOptions(req, res) {
  const filter = { isDeleted: false, isActive: true };
  if (!isAdmin(req.user)) filter._id = { $in: req.user.branches || [] };
  const items = await Branch.find(filter).sort({ code: 1 });
  res.json({ items: items.map((b) => ({ id: b._id, code: b.code, name: b.name })) });
}

async function readGroup(b, user, v, { current } = {}) {
  const out = {};
  out.name = asString(b.name);
  if (out.name.length < 2 || out.name.length > 80) v.add('name', 'Group name must be 2–80 characters');
  out.leaderName = asString(b.leaderName);
  if (out.leaderName.length < 2 || out.leaderName.length > 80) v.add('leaderName', 'Group leader name must be 2–80 characters');

  const mobile = asString(b.leaderMobile);
  if (!current) {
    // Set when the group is created; after that only an admin can change it.
    if (!MOBILE_RE.test(mobile)) v.add('leaderMobile', 'Enter a valid 10-digit mobile number');
    else out.leaderMobile = mobile;
  } else if (mobile && mobile !== current.leaderMobile && !mobile.startsWith('X')) {
    if (!isAdmin(user)) throw new HttpError(403, 'Only an admin can change the group leader mobile number', { leaderMobile: 'Only an admin can change this number' });
    if (!MOBILE_RE.test(mobile)) v.add('leaderMobile', 'Enter a valid 10-digit mobile number');
    else out.leaderMobile = mobile;
  }

  const branchId = String(b.branch || '');
  let branch = null;
  if (!mongoose.isValidObjectId(branchId)) v.add('branch', 'Select a branch');
  else {
    branch = await Branch.findOne({ _id: branchId, isDeleted: false });
    if (!branch) v.add('branch', 'Selected branch does not exist');
    else if (!isAdmin(user) && !(user.branches || []).some((x) => String(x) === String(branch._id))) {
      v.add('branch', 'You can only use branches assigned to you');
    }
  }
  out.branch = branch?._id;

  if (!isBlankDate(b.formationDate)) {
    const d = parseDateOnly(b.formationDate);
    if (!d) v.add('formationDate', 'Enter a valid date');
    else if (d > new Date()) v.add('formationDate', 'Date cannot be in the future');
    else out.formationDate = d;
  }
  return out;
}
const isBlankDate = (x) => x === undefined || x === null || String(x).trim() === '';

const duplicate = () => new HttpError(409, 'A group with this name already exists in the branch', { name: 'This group name is already used in the branch' });

export async function createGroup(req, res) {
  const v = createValidator();
  const data = await readGroup(req.body || {}, req.user, v);
  v.throwIfAny();

  if (await Group.exists({ branch: data.branch, name: data.name, isDeleted: false }).collation({ locale: 'en', strength: 2 })) throw duplicate();

  let doc;
  try {
    const code = await generateCode('group');
    doc = await Group.create({ ...data, code, createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  await doc.populate(POPULATE);
  await audit(req, { action: 'group.create', entity: 'Group', entityId: doc._id, after: doc });
  res.status(201).json({ group: present(doc, req.user) });
}

export async function updateGroup(req, res) {
  const doc = await loadGroup(req);
  const v = createValidator();
  const data = await readGroup(req.body || {}, req.user, v, { current: doc });
  v.throwIfAny();

  const before = doc.toObject();
  const mobileChanged = data.leaderMobile !== undefined && data.leaderMobile !== doc.leaderMobile;
  Object.assign(doc, { ...data, updatedBy: req.user._id });
  try {
    await doc.save();
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  if (mobileChanged) {
    // An OTP sent to the old number must not be usable any more.
    await GroupLeaderCommission.updateMany(
      { group: doc._id, status: 'pending' },
      { $unset: { otpHash: '', otpExpiresAt: '', otpMobile: '' }, $set: { otpAttempts: 0 } }
    );
  }
  await doc.populate(POPULATE);
  await audit(req, {
    action: mobileChanged ? 'group.leaderMobileChanged' : 'group.update',
    entity: 'Group',
    entityId: doc._id,
    before: { ...before, leaderMobile: maskMobile(before.leaderMobile) },
    after: { ...doc.toObject(), leaderMobile: maskMobile(doc.leaderMobile) },
  });
  res.json({ group: present(doc, req.user) });
}

export async function setGroupStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const doc = await loadGroup(req);
  doc.isActive = req.body.isActive;
  doc.updatedBy = req.user._id;
  await doc.save();
  await doc.populate(POPULATE);
  await audit(req, { action: doc.isActive ? 'group.activate' : 'group.deactivate', entity: 'Group', entityId: doc._id });
  res.json({ group: present(doc, req.user) });
}

export async function deleteGroup(req, res) {
  const doc = await loadGroup(req);
  if (await GroupDisbursement.exists({ group: doc._id })) {
    throw new HttpError(409, 'This group has disbursement history and cannot be deleted. Deactivate it instead.');
  }
  doc.isDeleted = true;
  doc.isActive = false;
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: 'group.delete', entity: 'Group', entityId: doc._id });
  res.json({ message: 'Group deleted' });
}

// ---- disbursements (interim input of the commission) ----------------------------------

export async function listDisbursements(req, res) {
  const g = await loadGroup(req);
  const items = await GroupDisbursement.find({ group: g._id }).sort({ month: -1 });
  res.json({ items: items.map((d) => ({ id: d._id, month: d.month, loans: d.loans })) });
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

/** Sets the number of loans disbursed in a month (0 removes the entry). */
export async function saveDisbursement(req, res) {
  const g = await loadGroup(req);
  const month = asString(req.body?.month);
  const loans = Number(req.body?.loans);
  const v = createValidator();
  if (parseMonth(month) === null) v.add('month', 'Choose a valid month');
  else if (month > currentMonth()) v.add('month', 'Disbursements cannot be entered for a future month');
  if (!Number.isInteger(loans) || loans < 0 || loans > 100000) v.add('loans', 'Enter a whole number of loans (0 removes the month)');
  v.throwIfAny();

  // Commission already paid for these loans must not be rewritten.
  const ctx = await loadRuleContext();
  const rule = ruleForMonth(ctx, month);
  if (rule) {
    const months = payoutMonths(month, rule);
    const paid = await GroupLeaderCommission.exists({ group: g._id, month: { $in: months }, status: 'deposited' });
    if (paid) {
      throw new HttpError(409, 'Commission for these loans has already been deposited, so this month cannot be changed.', {
        month: 'Commission already deposited for this month',
      });
    }
  }

  const existing = await GroupDisbursement.findOne({ group: g._id, month });
  if (loans === 0) {
    if (existing) await existing.deleteOne();
  } else if (existing) {
    existing.loans = loans;
    existing.updatedBy = req.user._id;
    await existing.save();
  } else {
    await GroupDisbursement.create({ group: g._id, month, loans, updatedBy: req.user._id });
  }

  // Keep the group's pending commission in step with the new count.
  const sync = await syncGroupEntries(g, ctx);
  await audit(req, {
    action: 'group.disbursement',
    entity: 'Group',
    entityId: g._id,
    before: { month, loans: existing?.loans ?? 0 },
    after: { month, loans },
  });
  res.json({ message: 'Saved', commission: sync });
}

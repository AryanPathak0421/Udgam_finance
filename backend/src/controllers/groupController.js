import mongoose from 'mongoose';
import { Group } from '../models/Group.js';
import { Branch } from '../models/Branch.js';
import { Member } from '../models/Member.js';
import { User } from '../models/User.js';
import { MEETING_TYPES } from '../models/Group.js';
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
  openingDate: dateOnly(g.openingDate || g.formationDate || g.createdAt),
  employeeCode: g.employeeCode || '',
  employeeName: '',
  meetingType: g.meetingType || '',
  collectionDay: g.collectionDay ?? null,
  meetingTime: g.meetingTime || '',
  memberCount: (g.members || []).length,
  isActive: g.isActive,
  createdAt: g.createdAt,
});

const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// Staff names are looked up from the employee codes (never stored twice).
async function withEmployeeNames(items) {
  const codes = [...new Set(items.map((i) => i.employeeCode).filter(Boolean))];
  if (!codes.length) return items;
  const users = await User.find({ employeeCode: { $in: codes } }).select('name employeeCode');
  const names = new Map(users.map((u) => [u.employeeCode, u.name]));
  return items.map((i) => ({ ...i, employeeName: names.get(i.employeeCode) || '' }));
}

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
  res.json({
    items: await withEmployeeNames(items.map((g) => present(g, req.user))),
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  });
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

  // Opening date: today by default; once created only an Admin may change it.
  if (isBlankDate(b.openingDate)) {
    if (!current) out.openingDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  } else {
    const d = parseDateOnly(asString(b.openingDate));
    if (!d) v.add('openingDate', 'Enter a valid date');
    else if (d > new Date()) v.add('openingDate', 'Opening date cannot be in the future');
    else if (current && dateOnly(current.openingDate || current.formationDate || current.createdAt) !== dateOnly(d)) {
      if (!isAdmin(user)) throw new HttpError(403, 'Only an admin can change the opening date', { openingDate: 'Only an admin can change this date' });
      out.openingDate = d;
    } else if (!current) {
      if (!isAdmin(user) && dateOnly(d) !== new Date().toISOString().slice(0, 10)) {
        throw new HttpError(403, 'Only an admin can set the opening date', { openingDate: 'Only an admin can change this date' });
      }
      out.openingDate = d;
    }
  }

  // Employee looking after the group.
  out.employeeCode = asString(b.employeeCode).toUpperCase();
  if (!out.employeeCode) v.add('employeeCode', 'Select the employee');
  else if (branch) {
    const emp = await User.findOne({ employeeCode: out.employeeCode, isActive: true }).select('role branches');
    const ok = emp && (ADMIN_ROLES.includes(emp.role) || (emp.branches || []).some((x) => String(x) === String(branch._id)));
    if (!emp) v.add('employeeCode', 'Select a valid employee');
    else if (!ok) v.add('employeeCode', 'This employee does not belong to the selected branch');
  }

  // Meeting schedule.
  out.meetingType = asString(b.meetingType);
  if (!MEETING_TYPES.includes(out.meetingType)) v.add('meetingType', 'Select daily, weekly or monthly');
  out.meetingTime = asString(b.meetingTime);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(out.meetingTime)) v.add('meetingTime', 'Enter the meeting time');
  if (out.meetingType === 'weekly') {
    const d = Number(b.collectionDay);
    if (!Number.isInteger(d) || d < 1 || d > 7) v.add('collectionDay', 'Select the collection day');
    else out.collectionDay = d;
  } else if (out.meetingType === 'monthly') {
    const d = Number(b.collectionDay);
    if (!Number.isInteger(d) || d < 1 || d > 28) v.add('collectionDay', 'Select a day of the month (1–28)');
    else out.collectionDay = d;
  } else {
    out.collectionDay = null; // daily: every day
  }
  return out;
}
const isBlankDate = (x) => x === undefined || x === null || String(x).trim() === '';

const duplicate = () => new HttpError(409, 'A group with this name already exists in the branch', { name: 'This group name is already used in the branch' });

const MAX_MEMBERS = 50;

/** Checks a list of member ids can join a group of `branchId` and returns the member documents. */
async function checkMembers(ids, branchId, { groupId, already = [] } = {}) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (list.some((x) => !mongoose.isValidObjectId(x))) throw new HttpError(422, 'Select valid members');
  if (list.length === 0) return [];
  const found = await Member.find({ _id: { $in: list }, isDeleted: false }).select('code name branch isBlocked');
  if (found.length !== list.length) throw new HttpError(422, 'A selected member does not exist');

  const problems = [];
  const taken = await Group.find({ 'members.member': { $in: list }, isDeleted: false, ...(groupId ? { _id: { $ne: groupId } } : {}) }).select('code members.member');
  const takenBy = new Map();
  taken.forEach((g) => g.members.forEach((m) => takenBy.set(String(m.member), g.code)));
  found.forEach((m) => {
    if (String(m.branch) !== String(branchId)) problems.push(`${m.code} belongs to another branch`);
    else if (m.isBlocked) problems.push(`${m.code} is blocked`);
    else if (takenBy.has(String(m._id))) problems.push(`${m.code} is already in group ${takenBy.get(String(m._id))}`);
    else if (already.includes(String(m._id))) problems.push(`${m.code} is already in this group`);
  });
  if (problems.length) throw new HttpError(409, problems.join('; '), { members: problems.join('; ') });
  return found;
}

export async function createGroup(req, res) {
  const v = createValidator();
  const data = await readGroup(req.body || {}, req.user, v);
  v.throwIfAny();
  const members = await checkMembers(req.body?.memberIds, data.branch);
  if (members.length > MAX_MEMBERS) throw new HttpError(422, `A group can have at most ${MAX_MEMBERS} members`);

  if (await Group.exists({ branch: data.branch, name: data.name, isDeleted: false }).collation({ locale: 'en', strength: 2 })) throw duplicate();

  let doc;
  try {
    const code = await generateCode('group');
    doc = await Group.create({
      ...data,
      code,
      members: members.map((m) => ({ member: m._id, addedBy: req.user._id })),
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
  } catch (err) {
    if (err.code === 11000) throw duplicate();
    throw err;
  }
  await doc.populate(POPULATE);
  await audit(req, { action: 'group.create', entity: 'Group', entityId: doc._id, after: doc });
  res.status(201).json({ group: (await withEmployeeNames([present(doc, req.user)]))[0] });
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
  res.json({ group: (await withEmployeeNames([present(doc, req.user)]))[0] });
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

// ---- members of a group --------------------------------------------------------------------------------
const memberRow = (m, user) => ({
  id: m._id,
  code: m.code,
  name: m.name,
  mobile: FULL_MOBILE_ROLES.includes(user.role) ? m.mobile : maskMobile(m.mobile),
  isBlocked: Boolean(m.isBlocked),
});

/** One group with its members. */
export async function getGroup(req, res) {
  const g = await loadGroup(req);
  await g.populate([
    POPULATE,
    { path: 'members.member', select: 'code name mobile isBlocked' },
    { path: 'members.addedBy', select: 'name employeeCode' },
  ]);
  const base = (await withEmployeeNames([present(g, req.user)]))[0];
  res.json({
    group: base,
    members: g.members
      .filter((x) => x.member)
      .map((x) => ({
        ...memberRow(x.member, req.user),
        addedAt: x.addedAt,
        addedBy: x.addedBy ? { name: x.addedBy.name, employeeCode: x.addedBy.employeeCode || '' } : null,
      })),
  });
}

/** Members of the group's branch that are free to join a group. */
export async function memberCandidates(req, res) {
  const branch = req.query.branch;
  if (!mongoose.isValidObjectId(branch)) throw new HttpError(422, 'Select the branch first');
  if (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === String(branch))) {
    throw new HttpError(403, 'You can only use branches assigned to you');
  }
  const used = await Group.find({ isDeleted: false }).select('members.member');
  const usedIds = used.flatMap((g) => g.members.map((m) => m.member));
  const filter = { isDeleted: false, branch, isBlocked: { $ne: true }, _id: { $nin: usedIds } };
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }, { mobile: rx }];
  }
  const items = await Member.find(filter).select('code name mobile isBlocked').sort({ code: 1 }).limit(50);
  res.json({ items: items.map((m) => memberRow(m, req.user)) });
}

/** Adds members to a group (the "confirm and submit" step of the form). */
export async function addGroupMembers(req, res) {
  const g = await loadGroup(req);
  if (!g.isActive) throw new HttpError(409, 'The group is inactive');
  const current = g.members.map((x) => String(x.member));
  const found = await checkMembers(req.body?.memberIds, g.branch, { groupId: g._id, already: current });
  if (found.length === 0) throw new HttpError(422, 'Select at least one member', { members: 'Select at least one member' });
  if (current.length + found.length > MAX_MEMBERS) throw new HttpError(422, `A group can have at most ${MAX_MEMBERS} members`);

  g.members.push(...found.map((m) => ({ member: m._id, addedBy: req.user._id })));
  g.updatedBy = req.user._id;
  await g.save();
  await audit(req, { action: 'group.membersAdded', entity: 'Group', entityId: g._id, after: { code: g.code, members: found.map((m) => m.code) } });
  res.json({ message: `${found.length} member${found.length > 1 ? 's' : ''} added`, memberCount: g.members.length });
}

export async function removeGroupMember(req, res) {
  const g = await loadGroup(req);
  if (!mongoose.isValidObjectId(req.params.memberId)) throw new HttpError(404, 'Member not found');
  const before = g.members.length;
  g.members = g.members.filter((x) => String(x.member) !== req.params.memberId);
  if (g.members.length === before) throw new HttpError(404, 'This member is not in the group');
  g.updatedBy = req.user._id;
  await g.save();
  await audit(req, { action: 'group.memberRemoved', entity: 'Group', entityId: g._id, after: { code: g.code, member: req.params.memberId } });
  res.json({ message: 'Member removed', memberCount: g.members.length });
}

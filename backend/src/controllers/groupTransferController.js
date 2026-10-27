import mongoose from 'mongoose';
import { blockedCodes } from '../services/blockedStaff.js';
import { Group } from '../models/Group.js';
import { Member } from '../models/Member.js';
import { User } from '../models/User.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { LoanRequisition } from '../models/LoanRequisition.js';
import { EmployeeTransfer } from '../models/EmployeeTransfer.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { runningBorrowers } from '../services/loanRunning.js';
import { branchFilter, isAdmin } from './groupController.js';
import { asString, escapeRegex, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const MAX_MEMBERS = 50;
const MAX_ITEMS = 1000;
const ADMIN_ROLES = ['super_admin', 'admin'];
const KIND_LABEL = { personal: 'Personal', group: 'Group', business: 'Business / MSME', msme: 'Business / MSME', product: 'Product' };
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const code = (v) => asString(v).toUpperCase();

/** Employees to choose from: those of the caller's branches (an admin sees everyone). Someone who has left is still listed, to take his work away. */
export async function employees(req, res) {
  // the staff of the chosen branch (an admin is not an employee of a branch); without a branch, those of the caller's branches
  const branch = mongoose.isValidObjectId(req.query.branch) ? String(req.query.branch) : null;
  const own = (req.user.branches || []).map(String);
  if (branch && !isAdmin(req.user) && !own.includes(branch)) throw new HttpError(403, 'You can only use branches assigned to you');
  const filter = { employeeCode: { $exists: true, $ne: '', $nin: await blockedCodes() }, role: { $nin: ADMIN_ROLES } };
  if (branch) filter.branches = branch;
  else if (!isAdmin(req.user)) filter.branches = { $in: own };
  const users = await User.find(filter).select('name employeeCode role isActive legacyImport branches').populate('branches', 'code name').sort({ employeeCode: 1 });
  res.json({ items: users.map((u) => ({ code: u.employeeCode, name: u.name, role: u.role, isActive: u.isActive, migrated: !u.isActive && Boolean(u.legacyImport), branches: (u.branches || []).map((b) => String(b._id)), branchCode: (u.branches || []).map((b) => b.code).join(', '), branchName: (u.branches || []).map((b) => b.name).join(', ') })) });
}

const groupRow = (g, running) => ({
  id: g._id, code: g.code, name: g.name, branch: g.branch?._id ? { id: g.branch._id, code: g.branch.code, name: g.branch.name } : null,
  members: (g.members || []).length, runningLoans: running, isActive: g.isActive,
});

async function runningLoansOfGroups(groups, fromCode) {
  const loans = await LoanPayment.find({ 'group.code': { $in: groups.map((g) => g.code) }, status: 'paid', employeeCode: fromCode }).select('group schedule lines employeeCode').lean();
  const state = await runningBorrowers(loans);
  const per = new Map();
  const ids = new Map();
  for (const l of loans) {
    if (state.get(String(l._id)).size) {
      per.set(l.group.code, (per.get(l.group.code) || 0) + 1);
      if (!ids.has(l.group.code)) ids.set(l.group.code, []);
      ids.get(l.group.code).push(l._id);
    }
  }
  return { per, ids };
}

/** The groups or the loans an employee looks after (the loans that still run, unless `all` is asked). */
export async function items(req, res) {
  const type = asString(req.query.type);
  const from = code(req.query.employee);
  if (!['group', 'loan'].includes(type)) throw invalid({ type: 'Choose Group or Loan' });
  if (!from) throw invalid({ employee: 'Select the employee' });
  const q = asString(req.query.q);
  const rx = q ? new RegExp(escapeRegex(q), 'i') : null;
  const inBranch = mongoose.isValidObjectId(req.query.branch) ? { branch: req.query.branch } : {};

  if (type === 'group') {
    let groups = await Group.find({ isDeleted: false, employeeCode: from, ...inBranch, ...branchFilter(req.user) }).populate('branch', 'code name').sort({ code: 1 });
    if (rx) groups = groups.filter((g) => rx.test(g.code) || rx.test(g.name));
    const { per } = await runningLoansOfGroups(groups, from);
    return res.json({ type, items: groups.map((g) => groupRow(g, per.get(g.code) || 0)), total: groups.length });
  }

  const filter = { status: 'paid', employeeCode: from, ...inBranch, ...branchFilter(req.user) };
  const and = [];
  if (rx) and.push({ $or: [{ loanId: rx }, { formId: rx }, { 'group.code': rx }, { 'group.name': rx }, { 'lines.code': rx }, { 'lines.name': rx }] });
  // one kind of loan only: personal, business, msme, product or group
  const kind = asString(req.query.loanType);
  if (['personal', 'business', 'msme', 'product', 'group'].includes(kind)) and.push({ $or: [{ loanType: kind }, { loanType: { $exists: false }, kind }] });
  if (and.length) filter.$and = and;
  const loans = await LoanPayment.find(filter).select('loanId formId kind loanType group branch paidOn totalAmountPaise lines.code lines.name lines.extraEmiPaise schedule.installmentPaise employeeCode').populate('branch', 'code name').sort({ paidOn: -1 }).limit(MAX_ITEMS).lean();
  const state = await runningBorrowers(loans);
  const all = req.query.all === '1';
  const rows = loans.map((l) => {
    const running = state.get(String(l._id)).size;
    return {
      id: l._id, loanId: l.loanId || '', formId: l.formId || '', type: KIND_LABEL[l.loanType] || KIND_LABEL[l.kind] || l.kind || '',
      group: l.group?.code ? `${l.group.code} — ${l.group.name}` : '', borrowers: l.lines.map((x) => x.name).slice(0, 2).join(', ') + (l.lines.length > 2 ? ` +${l.lines.length - 2}` : ''),
      borrowerCount: l.lines.length, amount: (l.totalAmountPaise || 0) / 100, paidOn: l.paidOn, branch: l.branch?.name || '', running: running > 0,
    };
  }).filter((r) => all || r.running);
  res.json({ type, items: rows, total: rows.length, capped: loans.length >= MAX_ITEMS });
}

async function readTarget(req, from, branchIds) {
  const to = code(req.body?.to);
  if (!to) throw invalid({ to: 'Select the employee who takes over' });
  if (to === from) throw invalid({ to: 'Choose a different employee' });
  const emp = await User.findOne({ employeeCode: { $eq: to, $nin: await blockedCodes() }, $or: [{ isActive: true }, { legacyImport: true }] }).select('name role branches');
  if (!emp) throw invalid({ to: 'Select a valid employee' });
  if (!ADMIN_ROLES.includes(emp.role)) {
    const own = new Set((emp.branches || []).map(String));
    const bad = [...new Set(branchIds.map(String))].filter((b) => !own.has(b));
    if (bad.length) throw new HttpError(409, `${to} does not belong to the branch of ${bad.length === 1 ? 'one of these' : 'some of these'} items. Choose an employee of the same branch.`, { to: 'This employee does not belong to the branch of the selected items' });
  }
  return { to, emp };
}

function readIds(raw) {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(String))];
  if (!ids.length) throw invalid({ ids: 'Select at least one item' });
  if (ids.length > MAX_ITEMS) throw invalid({ ids: `Up to ${MAX_ITEMS} items at a time` });
  if (ids.some((x) => !mongoose.isValidObjectId(x))) throw invalid({ ids: 'Select valid items' });
  return ids;
}

/** Hands the selected groups (and, if asked, their running loans) or the selected loans from one employee to another, in one go. */
export async function transfer(req, res) {
  const type = asString(req.body?.type);
  const from = code(req.body?.from);
  if (!['group', 'loan'].includes(type)) throw invalid({ type: 'Choose Group or Loan' });
  if (!from) throw invalid({ from: 'Select the employee' });
  const ids = readIds(req.body?.ids);

  let moved = 0;
  let loansMoved = 0;
  let labels;
  let branch;
  let to;

  if (type === 'group') {
    const groups = await Group.find({ _id: { $in: ids }, isDeleted: false, employeeCode: from, ...branchFilter(req.user) });
    if (groups.length !== ids.length) throw new HttpError(409, `Some of these groups no longer belong to ${from}. Reload and try again.`);
    ({ to } = await readTarget(req, from, groups.map((g) => g.branch)));
    let loanIds = [];
    if (req.body?.withLoans !== false) {
      const { ids: byCode } = await runningLoansOfGroups(groups, from);
      loanIds = [...byCode.values()].flat();
    }
    await Group.updateMany({ _id: { $in: groups.map((g) => g._id) } }, { $set: { employeeCode: to, updatedBy: req.user._id } });
    if (loanIds.length) loansMoved = await moveLoans(loanIds, from, to);
    moved = groups.length;
    labels = groups.map((g) => ({ id: String(g._id), label: `${g.code} — ${g.name}` }));
    branch = groups[0]?.branch;
  } else {
    const loans = await LoanPayment.find({ _id: { $in: ids }, status: 'paid', employeeCode: from, ...branchFilter(req.user) }).select('loanId formId branch group lines.name');
    if (loans.length !== ids.length) throw new HttpError(409, `Some of these loans no longer belong to ${from}. Reload and try again.`);
    ({ to } = await readTarget(req, from, loans.map((l) => l.branch)));
    loansMoved = await moveLoans(loans.map((l) => l._id), from, to);
    moved = loans.length;
    labels = loans.map((l) => ({ id: String(l._id), label: `${l.loanId || l.formId}${l.group?.code ? ` (${l.group.code})` : ''}` }));
    branch = loans[0]?.branch;
  }

  await EmployeeTransfer.create({ type, fromEmployee: from, toEmployee: to, items: labels.slice(0, 200), count: moved, loansMoved, branch, by: req.user._id, byName: req.user.name });
  await audit(req, { action: `employeeTransfer.${type}`, entity: type === 'group' ? 'Group' : 'LoanPayment', entityId: ids[0], after: { from, to, count: moved, loansMoved } });
  res.json({ moved, loansMoved, to });
}

/** The loan and the requisition it came from take the new employee; EMI collection and the Borrower Synopsis then show the new one. */
async function moveLoans(loanIds, from, to) {
  const loans = await LoanPayment.find({ _id: { $in: loanIds }, employeeCode: from }).select('requisition');
  await LoanPayment.updateMany({ _id: { $in: loans.map((l) => l._id) } }, { $set: { employeeCode: to } });
  await LoanRequisition.updateMany({ _id: { $in: loans.map((l) => l.requisition) }, employeeCode: from }, { $set: { employeeCode: to } });
  return loans.length;
}

// ---- member group transfer ---------------------------------------------------------------------------------------------------------

async function loadGroupFor(req, id, label) {
  if (!mongoose.isValidObjectId(id)) throw invalid({ [label]: 'Select the group' });
  const g = await Group.findOne({ _id: id, isDeleted: false, ...branchFilter(req.user) });
  if (!g) throw new HttpError(404, 'Group not found');
  return g;
}

/**
 * What stands in the way of moving a member of the group: a loan of the group applied for and not paid out yet. A running loan does not stop him:
 * the loan moves to the new group with him. `running` tells who has one.
 */
async function holdBack(group) {
  const memberIds = group.members.map((x) => x.member);
  const loans = await LoanPayment.find({ 'group.code': group.code, status: 'paid' }).select('schedule lines.code lines.extraEmiPaise').lean();
  const state = await runningBorrowers(loans);
  const running = new Set();
  for (const l of loans) for (const c of state.get(String(l._id))) running.add(c);
  const pendingReqs = await LoanRequisition.find({
    isDeleted: false, kind: 'group', 'groupInfo.code': group.code, members: { $in: memberIds }, $or: [{ status: 'pending' }, { status: 'approved', disbursedAt: { $exists: false } }],
  }).select('members').lean();
  const pending = new Set(pendingReqs.flatMap((r) => r.members.map(String)));
  return { running, pending };
}

/** The members of a group, each with the reason (if any) why he cannot be moved now. */
export async function groupMembers(req, res) {
  const g = await loadGroupFor(req, req.query.group, 'group');
  const members = await Member.find({ _id: { $in: g.members.map((x) => x.member) }, isDeleted: false }).select('code name isBlocked').sort({ code: 1 });
  const { running, pending } = await holdBack(g);
  res.json({
    group: { id: g._id, code: g.code, name: g.name, members: g.members.length },
    items: members.map((m) => ({
      id: m._id, code: m.code, name: m.name,
      blocked: m.isBlocked,
      reason: m.isBlocked ? 'Blocked' : pending.has(String(m._id)) ? 'A loan of this group is applied for and not paid out yet' : '',
      runningLoan: running.has(m.code),
    })),
  });
}

/** The groups a member can move to: of the same branch, active, with room. */
export async function targetGroups(req, res) {
  const from = await loadGroupFor(req, req.query.from, 'from');
  const q = asString(req.query.q);
  const filter = { isDeleted: false, isActive: true, branch: from.branch, _id: { $ne: from._id }, ...branchFilter(req.user) };
  if (q) filter.$or = [{ code: new RegExp(escapeRegex(q), 'i') }, { name: new RegExp(escapeRegex(q), 'i') }];
  const groups = await Group.find(filter).sort({ code: 1 }).limit(200);
  res.json({ items: groups.map((g) => ({ id: g._id, code: g.code, name: g.name, members: g.members.length, full: g.members.length >= MAX_MEMBERS, employeeCode: g.employeeCode || '' })) });
}

/** Moves members from one group to another. */
export async function transferMembers(req, res) {
  const from = await loadGroupFor(req, req.body?.fromGroup, 'fromGroup');
  const to = await loadGroupFor(req, req.body?.toGroup, 'toGroup');
  if (String(from._id) === String(to._id)) throw invalid({ toGroup: 'Choose a different group' });
  if (String(from.branch) !== String(to.branch)) throw new HttpError(409, 'Both groups must be of the same branch', { toGroup: 'Choose a group of the same branch' });
  if (!to.isActive) throw new HttpError(409, 'The group the members move to is inactive', { toGroup: 'This group is inactive' });
  const ids = readIds(req.body?.memberIds);
  const inFrom = new Set(from.members.map((x) => String(x.member)));
  if (ids.some((id) => !inFrom.has(id))) throw new HttpError(409, 'A selected member is not in the group any more. Reload and try again.');
  if (to.members.length + ids.length > MAX_MEMBERS) throw new HttpError(422, `The group can have at most ${MAX_MEMBERS} members (it has ${to.members.length})`, { memberIds: `Only ${MAX_MEMBERS - to.members.length} more member(s) fit in the group` });

  const members = await Member.find({ _id: { $in: ids }, isDeleted: false }).select('code name isBlocked');
  if (members.length !== ids.length) throw new HttpError(422, 'A selected member does not exist');
  const { running, pending } = await holdBack(from);
  const problems = [];
  for (const m of members) {
    if (m.isBlocked) problems.push(`${m.code} is blocked`);
    else if (pending.has(String(m._id))) problems.push(`${m.code} has a loan of ${from.code} that is not paid out yet`);
  }
  if (problems.length) throw new HttpError(409, problems.join('; '), { memberIds: problems.join('; ') });

  // the loans of these members in the old group go with them: group, employee and the requisition they came from. A loan shared with other
  // members cannot be split, so it is refused (a group loan is made for one member at a time, so this does not happen in practice).
  const codes = members.map((m) => m.code);
  const loans = await LoanPayment.find({ 'group.code': from.code, status: 'paid', 'lines.code': { $in: codes } }).select('loanId requisition lines.code').lean();
  const shared = loans.filter((l) => l.lines.some((x) => !codes.includes(x.code)));
  if (shared.length) throw new HttpError(409, `Loan ${shared[0].loanId} is shared with members who stay in ${from.code}, so it cannot be moved on its own`, { memberIds: 'A loan of these members is shared with other members of the group' });
  const loanIdsOf = new Map(); // member code -> loan ids
  for (const l of loans) for (const x of l.lines) { if (!loanIdsOf.has(x.code)) loanIdsOf.set(x.code, []); loanIdsOf.get(x.code).push(l.loanId || String(l._id)); }
  let loansMoved = 0;
  if (loans.length) {
    const toEmployee = to.employeeCode || undefined;
    await LoanPayment.updateMany({ _id: { $in: loans.map((l) => l._id) } }, { $set: { 'group.code': to.code, 'group.name': to.name, ...(toEmployee ? { employeeCode: toEmployee } : {}) } });
    await LoanRequisition.updateMany(
      { _id: { $in: loans.map((l) => l.requisition) } },
      { $set: { group: to._id, 'groupInfo.code': to.code, 'groupInfo.name': to.name, 'groupInfo.leaderName': to.leaderName || '', 'groupInfo.employeeCode': to.employeeCode || '', 'groupInfo.meetingType': to.meetingType, ...(toEmployee ? { employeeCode: toEmployee } : {}) } }
    );
    await EmiPayment.updateMany({ loanPayment: { $in: loans.map((l) => l._id) } }, { $set: { group: `${to.code} — ${to.name}` } });
    loansMoved = loans.length;
  }

  // out of one group, into the other (a member is in one group only)
  const moveSet = new Set(ids);
  from.members = from.members.filter((x) => !moveSet.has(String(x.member)));
  from.updatedBy = req.user._id;
  to.members.push(...ids.map((id) => ({ member: id, addedBy: req.user._id })));
  to.updatedBy = req.user._id;
  await from.save();
  await to.save();
  await EmployeeTransfer.create({ type: 'member', fromGroup: from.code, toGroup: to.code, items: members.map((m) => ({ id: String(m._id), label: `${m.code} ${m.name}`, loans: loanIdsOf.get(m.code) || [] })), count: members.length, loansMoved, branch: from.branch, by: req.user._id, byName: req.user.name });
  await audit(req, { action: 'group.memberTransfer', entity: 'Group', entityId: to._id, after: { from: from.code, to: to.code, members: members.map((m) => m.code), loansMoved } });
  res.json({ moved: members.length, loansMoved, from: { code: from.code, members: from.members.length }, to: { code: to.code, members: to.members.length } });
}

/** The transfers made so far, newest first. */
export async function history(req, res) {
  const filter = {};
  if (['group', 'loan', 'member'].includes(req.query.type)) filter.type = req.query.type;
  if (!isAdmin(req.user)) filter.branch = { $in: req.user.branches || [] };
  const rows = await EmployeeTransfer.find(filter).sort({ createdAt: -1 }).limit(50);
  const codes = [...new Set(rows.flatMap((t) => [t.fromEmployee, t.toEmployee]).filter(Boolean))];
  const names = new Map((await User.find({ employeeCode: { $in: codes } }).select('name employeeCode')).map((u) => [u.employeeCode, u.name]));
  const who = (code) => (code ? `${code} — ${names.get(code) || ''}`.replace(/ — $/, '') : '');
  res.json({
    items: rows.map((t) => ({
      id: t._id, type: t.type, from: t.type === 'member' ? t.fromGroup : who(t.fromEmployee), to: t.type === 'member' ? t.toGroup : who(t.toEmployee),
      count: t.count, loansMoved: t.loansMoved, items: t.items.slice(0, 20).map((i) => i.label), by: t.byName || '', at: t.createdAt,
    })),
  });
}

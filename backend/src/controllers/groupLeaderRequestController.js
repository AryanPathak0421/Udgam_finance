import mongoose from 'mongoose';
import { Group } from '../models/Group.js';
import { Member } from '../models/Member.js';
import { GroupLeaderRequest, LEADER_REQUEST_STATUS } from '../models/GroupLeaderRequest.js';
import { branchFilter, isAdmin, maskMobile } from './groupController.js';
import { asString, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const MOBILE_RE = /^[6-9]\d{9}$/;

const present = (r, user) => ({
  id: r._id,
  groupId: String(r.group),
  groupCode: r.groupCode || '',
  groupName: r.groupName || '',
  branch: r.branch?._id ? { id: r.branch._id, code: r.branch.code, name: r.branch.name } : null,
  memberCode: r.memberCode || '',
  memberName: r.memberName || '',
  memberMobile: isAdmin(user) ? r.memberMobile : maskMobile(r.memberMobile),
  oldLeaderName: r.oldLeaderName || '',
  oldLeaderMobile: isAdmin(user) ? r.oldLeaderMobile || '' : maskMobile(r.oldLeaderMobile),
  status: r.status,
  requestedBy: r.requestedByName ? `${r.requestedByName}${r.requestedByCode ? ` (${r.requestedByCode})` : ''}` : r.requestedByCode || '',
  requestedAt: r.createdAt,
  decidedBy: r.decidedByCode || '',
  decidedAt: r.decidedAt || null,
  rejectReason: r.rejectReason || '',
});

/** A branch (or an admin) asks to make one of the group's members its leader. */
export async function requestLeaderChange(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Group not found');
  const g = await Group.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) }).populate('branch', 'code name');
  if (!g) throw new HttpError(404, 'Group not found');
  const memberId = asString(req.body?.memberId);
  if (!mongoose.isValidObjectId(memberId)) throw new HttpError(422, 'Select the member who becomes the leader', { memberId: 'Select a member' });
  if (!g.members.some((x) => String(x.member) === memberId)) throw new HttpError(422, 'The leader has to be a member of this group', { memberId: 'Select a member of this group' });
  const m = await Member.findOne({ _id: memberId, isDeleted: false }).select('code name mobile isBlocked');
  if (!m) throw new HttpError(404, 'Member not found');
  if (m.isBlocked) throw new HttpError(409, `${m.code} is blocked and cannot be the group leader`, { memberId: 'This member is blocked' });
  if (!MOBILE_RE.test(String(m.mobile || ''))) {
    throw new HttpError(409, `${m.code} has no valid mobile number. Add it first (Member Details → Complete details): the commission OTP goes to the leader's mobile`, { memberId: 'This member has no valid mobile number' });
  }
  if (String(g.leaderName || '').trim().toLowerCase() === String(m.name || '').trim().toLowerCase() && String(g.leaderMobile || '') === String(m.mobile)) {
    throw new HttpError(409, `${m.name} is already the leader of this group`, { memberId: 'Already the leader' });
  }
  if (await GroupLeaderRequest.exists({ group: g._id, status: 'pending' })) {
    throw new HttpError(409, 'A leader change request of this group is already waiting for the admin', { memberId: 'A request is already waiting' });
  }
  const r = await GroupLeaderRequest.create({
    group: g._id, groupCode: g.code, groupName: g.name, branch: g.branch._id || g.branch,
    member: m._id, memberCode: m.code, memberName: m.name, memberMobile: m.mobile,
    oldLeaderName: g.leaderName || '', oldLeaderMobile: g.leaderMobile || '',
    requestedBy: req.user._id, requestedByCode: req.user.employeeCode || '', requestedByName: req.user.name || '',
  });
  await audit(req, { action: 'group.leader-request', entity: 'Group', entityId: g._id, after: { member: m.code } });
  res.status(201).json({ request: present(r, req.user) });
}

/** The requests (admin: all; the branch: its own branches), pending first. ?status=pending|approved|rejected|all */
export async function listLeaderRequests(req, res) {
  const status = asString(req.query.status) || 'pending';
  const filter = { ...branchFilter(req.user) };
  if (LEADER_REQUEST_STATUS.includes(status)) filter.status = status;
  const rows = await GroupLeaderRequest.find(filter).populate('branch', 'code name').sort({ createdAt: -1 }).limit(300);
  res.json({ items: rows.map((r) => present(r, req.user)), pending: await GroupLeaderRequest.countDocuments({ ...branchFilter(req.user), status: 'pending' }) });
}

async function loadPending(req) {
  if (!mongoose.isValidObjectId(req.params.rid)) throw new HttpError(404, 'Request not found');
  const r = await GroupLeaderRequest.findById(req.params.rid);
  if (!r) throw new HttpError(404, 'Request not found');
  if (r.status !== 'pending') throw new HttpError(409, `This request was already ${r.status}`);
  return r;
}

/** Admin: the leader name and mobile of the group become the name and mobile of the member. */
export async function approveLeaderRequest(req, res) {
  const r = await loadPending(req);
  const g = await Group.findOne({ _id: r.group, isDeleted: false });
  if (!g) throw new HttpError(404, 'The group no longer exists');
  const m = await Member.findOne({ _id: r.member, isDeleted: false }).select('code name mobile mobileVerifiedAt isBlocked');
  if (!m) throw new HttpError(404, 'The member no longer exists');
  if (!g.members.some((x) => String(x.member) === String(m._id))) throw new HttpError(409, `${m.code} is no longer a member of this group`);
  if (m.isBlocked) throw new HttpError(409, `${m.code} is blocked and cannot be the group leader`);
  if (!MOBILE_RE.test(String(m.mobile || ''))) throw new HttpError(409, `${m.code} has no valid mobile number`);
  const before = { leaderName: g.leaderName, leaderMobile: g.leaderMobile };
  g.leaderName = m.name;
  g.leaderMobile = m.mobile;
  g.leaderMobileVerifiedAt = m.mobileVerifiedAt || undefined; // verified with an OTP only if the member's own number was
  g.updatedBy = req.user._id;
  await g.save();
  r.status = 'approved';
  r.decidedBy = req.user._id;
  r.decidedByCode = req.user.employeeCode || req.user.name || '';
  r.decidedAt = new Date();
  await r.save();
  await audit(req, { action: 'group.leader-approve', entity: 'Group', entityId: g._id, before, after: { leaderName: g.leaderName, leaderMobile: maskMobile(g.leaderMobile) } });
  res.json({ request: present(r, req.user) });
}

/** Admin: the request is turned down; the group keeps its leader. */
export async function rejectLeaderRequest(req, res) {
  const r = await loadPending(req);
  r.status = 'rejected';
  r.rejectReason = asString(req.body?.reason).slice(0, 300);
  r.decidedBy = req.user._id;
  r.decidedByCode = req.user.employeeCode || req.user.name || '';
  r.decidedAt = new Date();
  await r.save();
  await audit(req, { action: 'group.leader-reject', entity: 'Group', entityId: r.group, after: { member: r.memberCode, reason: r.rejectReason } });
  res.json({ request: present(r, req.user) });
}

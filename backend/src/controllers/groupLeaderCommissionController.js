import crypto from 'crypto';
import mongoose from 'mongoose';
import { Group } from '../models/Group.js';
import { GroupLeaderCommission, COMMISSION_STATUS } from '../models/GroupLeaderCommission.js';
import { syncAllGroups } from '../services/groupLeaderPayout.js';
import { issueOtp, takeVerified, consumeChallenge } from '../services/otpChallenges.js';
import { parseMonth } from '../services/groupLeaderCommission.js';
import { sendSms, isDevSms } from '../services/sms.js';
import { branchFilter, maskMobile, showMobile } from './groupController.js';
import { asString, createValidator, escapeRegex, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_GAP_MS = 30 * 1000;
const OTP_MAX_SENDS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

const POPULATE = [{ path: 'group', select: 'code name leaderName leaderMobile isActive' }, { path: 'branch', select: 'code name' }];
const currentMonth = () => new Date().toISOString().slice(0, 7);

const present = (e, user) => ({
  id: e._id,
  month: e.month,
  groupId: String(e.group?._id || e.group),
  groupCode: e.group?.code || '',
  groupName: e.group?.name || '',
  leaderName: e.group?.leaderName || '',
  leaderMobile: showMobile(user, e.group?.leaderMobile),
  branch: e.branch?._id ? { id: e.branch._id, code: e.branch.code, name: e.branch.name } : null,
  loans: e.loans,
  perLoan: e.perLoanPaise === undefined || e.perLoanPaise === null ? null : e.perLoanPaise / 100,
  amount: e.amountPaise / 100,
  status: e.status,
  depositedAt: e.depositedAt || null,
  depositedToMobile: e.depositedToMobile || '',
});

/** Monthly group-wise report. */
export async function report(req, res) {
  const month = asString(req.query.month) || currentMonth();
  if (parseMonth(month) === null) throw new HttpError(422, 'Choose a valid month', { month: 'Choose a valid month' });

  const filter = { month, ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  if (COMMISSION_STATUS.includes(req.query.status)) filter.status = req.query.status;

  let entries = await GroupLeaderCommission.find(filter).populate(POPULATE).sort({ createdAt: 1 });
  const q = asString(req.query.q).toLowerCase();
  if (q) {
    entries = entries.filter((e) => [e.group?.code, e.group?.name, e.group?.leaderName].some((x) => String(x || '').toLowerCase().includes(q)));
  }
  entries.sort((a, b) => String(a.group?.code).localeCompare(String(b.group?.code)));

  const sum = (list) => list.reduce((s, e) => s + e.amountPaise, 0) / 100;
  const pending = entries.filter((e) => e.status === 'pending');
  const deposited = entries.filter((e) => e.status === 'deposited');
  res.json({
    month,
    items: entries.map((e) => present(e, req.user)),
    totals: {
      groups: entries.length,
      loans: entries.reduce((s, e) => s + e.loans, 0),
      pendingAmount: sum(pending),
      pendingCount: pending.length,
      depositedAmount: sum(deposited),
      depositedCount: deposited.length,
      totalAmount: sum(entries),
    },
    smsMode: isDevSms() ? 'dev' : 'live',
  });
}

/** Recomputes commission entries for every group the caller can see. Deposited entries are untouched. */
export async function generate(req, res) {
  const total = await syncAllGroups(branchFilter(req.user));
  await audit(req, { action: 'groupLeaderCommission.generate', entity: 'GroupLeaderCommission', entityId: 'all', after: total });
  res.json(total);
}

// ---- OTP deposit ---------------------------------------------------------------------------

const otpHash = (entryId, otp) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(`${entryId}:${otp}`).digest('hex');

async function loadEntry(req, { withOtp = false } = {}) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Commission entry not found');
  let q = GroupLeaderCommission.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (withOtp) q = q.select('+otpHash +otpExpiresAt +otpAttempts +otpSentCount +otpWindowStart +otpLastSentAt +otpMobile');
  const e = await q.populate(POPULATE);
  if (!e) throw new HttpError(404, 'Commission entry not found');
  return e;
}

/** Sends an OTP to the group leader's registered mobile number. */
export async function sendOtp(req, res) {
  const e = await loadEntry(req, { withOtp: true });
  if (e.status === 'deposited') throw new HttpError(409, 'This commission has already been deposited');
  if (!e.group || e.group.isActive === false) throw new HttpError(409, 'The group is inactive');
  const mobile = e.group.leaderMobile;
  if (!mobile) throw new HttpError(409, 'The group leader has no registered mobile number');

  const now = Date.now();
  if (e.otpLastSentAt && now - e.otpLastSentAt.getTime() < OTP_RESEND_GAP_MS) {
    const wait = Math.ceil((OTP_RESEND_GAP_MS - (now - e.otpLastSentAt.getTime())) / 1000);
    throw new HttpError(429, `Please wait ${wait} seconds before requesting another OTP`);
  }
  if (!e.otpWindowStart || now - e.otpWindowStart.getTime() > HOUR_MS) {
    e.otpWindowStart = new Date(now);
    e.otpSentCount = 0;
  }
  if (e.otpSentCount >= OTP_MAX_SENDS_PER_HOUR) {
    throw new HttpError(429, 'Too many OTP requests for this commission. Please try again after some time.');
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const amount = (e.amountPaise / 100).toFixed(2);
  const text = `Udgam Microfinance: OTP ${otp} to receive your group leader commission of Rs ${amount} for ${e.month}. Valid for 5 minutes. Do not share this OTP.`;

  // Store first, send second: a failed SMS leaves a harmless unused OTP.
  e.otpHash = otpHash(e._id, otp);
  e.otpExpiresAt = new Date(now + OTP_TTL_MS);
  e.otpAttempts = 0;
  e.otpMobile = mobile;
  e.otpLastSentAt = new Date(now);
  e.otpSentCount += 1;
  await e.save();

  const sms = await sendSms({ to: mobile, text });
  await audit(req, {
    action: 'groupLeaderCommission.otpSent',
    entity: 'GroupLeaderCommission',
    entityId: e._id,
    after: { to: maskMobile(mobile), month: e.month, amount },
  });
  res.json({
    sentTo: maskMobile(mobile),
    expiresAt: e.otpExpiresAt,
    // Development only (no SMS provider configured and not production): lets the flow be tested.
    ...(sms.dev && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
  });
}

/** Marks the commission deposited — only reachable with the correct, unexpired OTP. */
export async function verifyOtp(req, res) {
  const e = await loadEntry(req, { withOtp: true });
  const otp = asString(req.body?.otp);
  const v = createValidator();
  if (!/^\d{6}$/.test(otp)) v.add('otp', 'Enter the 6-digit OTP');
  v.throwIfAny();

  if (e.status === 'deposited') throw new HttpError(409, 'This commission has already been deposited');
  if (!e.otpHash || !e.otpExpiresAt) throw new HttpError(409, 'No OTP has been sent. Please send an OTP first.');
  if (e.otpExpiresAt.getTime() < Date.now()) throw new HttpError(410, 'The OTP has expired. Please send a new OTP.');
  if (e.otpAttempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong attempts. Please send a new OTP.');
  // The number must still be the one the OTP went to (it may have been changed by an admin).
  if (e.otpMobile && e.group?.leaderMobile !== e.otpMobile) {
    throw new HttpError(409, 'The leader mobile number has changed. Please send a new OTP.');
  }

  const given = Buffer.from(otpHash(e._id, otp), 'hex');
  const stored = Buffer.from(e.otpHash, 'hex');
  const match = given.length === stored.length && crypto.timingSafeEqual(given, stored);
  if (!match) {
    e.otpAttempts += 1;
    await e.save();
    const left = OTP_MAX_ATTEMPTS - e.otpAttempts;
    await audit(req, { action: 'groupLeaderCommission.otpFailed', entity: 'GroupLeaderCommission', entityId: e._id, after: { attemptsLeft: left } });
    throw new HttpError(422, left > 0 ? `Incorrect OTP. ${left} attempt${left > 1 ? 's' : ''} left.` : 'Incorrect OTP. Please send a new OTP.', {
      otp: 'Incorrect OTP',
    });
  }

  e.status = 'deposited';
  e.depositedAt = new Date();
  e.depositedBy = req.user._id;
  e.depositedToMobile = maskMobile(e.otpMobile || e.group?.leaderMobile);
  e.otpHash = undefined;
  e.otpExpiresAt = undefined;
  e.otpAttempts = 0;
  e.otpMobile = undefined;
  await e.save();
  await audit(req, {
    action: 'groupLeaderCommission.deposited',
    entity: 'GroupLeaderCommission',
    entityId: e._id,
    after: { month: e.month, amount: e.amountPaise / 100, to: e.depositedToMobile },
  });
  res.json({ entry: present(e, req.user) });
}

// ---- due commission of a group, paid with one OTP ----------------------------------------------------------------------------------

/** The commission that is due: pending months up to this month (a later month is not due yet). */
const dueFilter = (user) => ({ status: 'pending', month: { $lte: currentMonth() }, ...branchFilter(user) });

/**
 * Groups with commission due, one row per group with its pending months. `q` finds a group by code, name or leader, so
 * the payment starts from the group code.
 */
export async function dueByGroup(req, res) {
  const filter = dueFilter(req.user);
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const q = asString(req.query.q);
  let entries = await GroupLeaderCommission.find(filter).populate(POPULATE).sort({ month: 1 });
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    entries = entries.filter((e) => [e.group?.code, e.group?.name, e.group?.leaderName].some((x) => rx.test(String(x || ''))));
  }
  const groups = new Map();
  for (const e of entries) {
    const k = String(e.group?._id || e.group);
    if (!groups.has(k)) {
      groups.set(k, {
        groupId: k, groupCode: e.group?.code || '', groupName: e.group?.name || '', leaderName: e.group?.leaderName || '',
        leaderMobile: showMobile(req.user, e.group?.leaderMobile), hasMobile: Boolean(e.group?.leaderMobile), active: e.group?.isActive !== false,
        branch: e.branch?._id ? { id: e.branch._id, code: e.branch.code, name: e.branch.name } : null, entries: [], loans: 0, totalDue: 0,
      });
    }
    const g = groups.get(k);
    g.entries.push({ id: e._id, month: e.month, loans: e.loans, perLoan: e.perLoanPaise == null ? null : e.perLoanPaise / 100, amount: e.amountPaise / 100 });
    g.loans += e.loans;
    g.totalDue += e.amountPaise / 100;
  }
  const items = [...groups.values()].sort((a, b) => a.groupCode.localeCompare(b.groupCode));
  res.json({ items: items.slice(0, 200), total: items.length, totalDue: items.reduce((s, g) => s + g.totalDue, 0), smsMode: isDevSms() ? 'dev' : 'live' });
}

async function loadDueGroup(req) {
  const groupId = req.body?.groupId;
  if (!mongoose.isValidObjectId(groupId)) throw new HttpError(422, 'Choose the group', { groupId: 'Choose the group' });
  const group = await Group.findOne({ _id: groupId, isDeleted: false, ...branchFilter(req.user) });
  if (!group) throw new HttpError(404, 'Group not found');
  const entries = await GroupLeaderCommission.find({ group: group._id, ...dueFilter(req.user) }).sort({ month: 1 });
  if (!entries.length) throw new HttpError(409, 'No commission is due for this group');
  return { group, entries, total: entries.reduce((s, e) => s + e.amountPaise, 0) };
}

/** Sends one OTP to the group leader's registered mobile for everything that is due. */
export async function sendDueOtp(req, res) {
  const { group, entries, total } = await loadDueGroup(req);
  if (group.isActive === false) throw new HttpError(409, 'The group is inactive');
  if (!group.leaderMobile) throw new HttpError(409, 'The group leader has no registered mobile number');
  const { challenge, otp } = await issueOtp({ user: req.user, purpose: 'group_commission', subject: String(group._id), sentTo: maskMobile(group.leaderMobile) });
  const text = `Udgam Microfinance: OTP ${otp} to receive your group leader commission of Rs ${(total / 100).toFixed(2)} (${entries.length} month${entries.length === 1 ? '' : 's'}). Valid for 5 minutes. Do not share this OTP.`;
  const sms = await sendSms({ to: group.leaderMobile, text });
  await audit(req, { action: 'groupLeaderCommission.otpSent', entity: 'Group', entityId: group._id, after: { to: maskMobile(group.leaderMobile), months: entries.length, amount: total / 100 } });
  res.json({ challengeId: challenge._id, sentTo: maskMobile(group.leaderMobile), expiresAt: challenge.expiresAt, ...(sms.dev && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}) });
}

/** Pays everything that is due to the group: needs the OTP that the leader shared (verified first). */
export async function payDue(req, res) {
  const { group, entries, total } = await loadDueGroup(req);
  const ch = await takeVerified(req.body?.challengeId, req.user, 'group_commission', String(group._id));
  if (!ch) throw new HttpError(422, 'Verify the OTP of the group leader first', { otp: 'Verify the OTP first' });
  const claim = await GroupLeaderCommission.updateMany(
    { _id: { $in: entries.map((e) => e._id) }, status: 'pending' },
    { $set: { status: 'deposited', depositedAt: new Date(), depositedBy: req.user._id, depositedToMobile: maskMobile(group.leaderMobile) }, $unset: { otpHash: '', otpExpiresAt: '', otpMobile: '' } }
  );
  if (claim.modifiedCount !== entries.length) throw new HttpError(409, 'Some of this commission was just paid by someone else. Reload and check.');
  await consumeChallenge(ch);
  await audit(req, { action: 'groupLeaderCommission.deposited', entity: 'Group', entityId: group._id, after: { months: entries.map((e) => e.month), amount: total / 100, to: maskMobile(group.leaderMobile) } });
  res.json({ paid: entries.length, amount: total / 100, months: entries.map((e) => e.month) });
}

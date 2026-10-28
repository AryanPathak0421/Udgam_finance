import mongoose from 'mongoose';
import { CivilCheck, BUREAUS } from '../models/CivilCheck.js';
import { Member } from '../models/Member.js';
import { User } from '../models/User.js';
import { branchFilter, isAdmin, maskMobile } from './groupController.js';
import { issueOtp, takeVerified, consumeChallenge } from '../services/otpChallenges.js';
import { sendSms } from '../services/sms.js';
import { civilApiConfigured, fetchCivilScore } from '../services/civilBureau.js';
import { checkPanFormat } from '../services/kycVerify.js';
import { asString, createValidator, parseDateOnly, HttpError, startOfToday } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { AppSetting, CIVIL_FEE_KEY, civilFeePaise } from '../models/AppSetting.js';
import { toMinor } from '../utils/money.js';

const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export const bandOf = (score) => {
  if (score >= 750) return { key: 'excellent', label: 'Excellent' };
  if (score >= 700) return { key: 'good', label: 'Good' };
  if (score >= 650) return { key: 'fair', label: 'Fair' };
  return { key: 'poor', label: 'Poor' };
};

const present = (c) => ({
  id: c._id,
  score: c.score,
  band: bandOf(c.score),
  reportDate: dateOnly(c.reportDate),
  daysOld: Math.floor((Date.now() - new Date(c.reportDate).getTime()) / 86_400_000),
  bureau: c.bureau,
  reportNumber: c.reportNumber || '',
  remark: c.remark || '',
  employeeCode: c.employeeCode || '',
  createdAt: c.createdAt,
  fee: (c.feePaise || 0) / 100,
});

async function loadMember(req, id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Member not found');
  const m = await Member.findOne({ _id: id, isDeleted: false, ...branchFilter(req.user) }).populate('branch', 'code name');
  if (!m) throw new HttpError(404, 'Member not found');
  return m;
}

/** Latest civil check of one member (also used by the requisition forms). */
export async function latestCheck(memberId) {
  return CivilCheck.findOne({ member: memberId, isDeleted: false }).sort({ reportDate: -1, createdAt: -1 });
}

/** A member's civil checks, newest first. */
export async function memberChecks(req, res) {
  const m = await loadMember(req, req.params.memberId);
  const items = await CivilCheck.find({ member: m._id, isDeleted: false }).sort({ reportDate: -1, createdAt: -1 });
  res.json({
    member: { id: m._id, code: m.code, name: m.name, mobile: m.mobile, branch: m.branch ? { id: m.branch._id, name: m.branch.name } : null, isBlocked: Boolean(m.isBlocked) },
    fee: (await civilFeePaise()) / 100,
    // the civil score from the bureau with the PAN number and an OTP to the phone number
    bureau: { connected: civilApiConfigured(), hasPan: Boolean(m.pan), pan: m.pan ? `XXXXX${String(m.pan).slice(5)}` : '', hasMobile: Boolean(m.mobile), mobile: m.mobile ? maskMobile(m.mobile) : '' },
    latest: items[0] ? present(items[0]) : null,
    items: items.map(present),
  });
}

export async function addCheck(req, res) {
  const b = req.body || {};
  const m = await loadMember(req, b.member);
  const v = createValidator();
  const score = Number(b.score);
  if (!Number.isInteger(score) || score < 300 || score > 900) v.add('score', 'Enter the civil score (300 to 900)');
  const reportDate = parseDateOnly(asString(b.reportDate));
  const today = startOfToday();
  if (!reportDate) v.add('reportDate', 'Enter the date of the report');
  else if (reportDate > today) v.add('reportDate', 'The report date cannot be in the future');
  const bureau = asString(b.bureau) || 'CIBIL';
  if (!BUREAUS.includes(bureau)) v.add('bureau', 'Select the bureau');
  const reportNumber = asString(b.reportNumber).slice(0, 40);
  const remark = asString(b.remark).slice(0, 200);
  v.throwIfAny();

  let employeeCode = req.user.employeeCode;
  if (!employeeCode) {
    const u = await User.findById(req.user._id).select('employeeCode');
    employeeCode = u?.employeeCode;
  }
  const doc = await CivilCheck.create({
    member: m._id,
    branch: m.branch._id,
    score,
    reportDate,
    bureau,
    reportNumber: reportNumber || undefined,
    remark: remark || undefined,
    employeeCode,
    feePaise: await civilFeePaise(),
    createdBy: req.user._id,
  });
  await audit(req, { action: 'civilCheck.add', entity: 'CivilCheck', entityId: doc._id, after: { member: m.code, score, bureau, reportDate: dateOnly(reportDate) } });
  res.status(201).json({ check: present(doc) });
}

// ---- the civil score from the bureau: PAN number + an OTP to the member's phone number -------------------------------------------

async function bureauMember(req) {
  const m = await loadMember(req, req.body?.member);
  if (m.isBlocked) throw new HttpError(409, 'This member is blocked.');
  if (!civilApiConfigured()) throw new HttpError(409, 'The civil check service is not connected on the server yet. Record the score by hand for now.');
  if (!m.pan) throw new HttpError(409, 'This member has no PAN number. Add the PAN first (Borrower Synopsis → Edit details).');
  const pc = checkPanFormat(m.pan);
  if (!pc.ok) throw new HttpError(409, `The PAN on record is not valid: ${pc.message}`);
  if (!m.mobile) throw new HttpError(409, 'This member has no phone number to send the OTP to.');
  return m;
}

/** Sends the OTP to the member's phone: the member agrees to the credit check by sharing it. */
export async function bureauSendOtp(req, res) {
  const m = await bureauMember(req);
  const { challenge, otp } = await issueOtp({ user: req.user, purpose: 'civil_check', subject: String(m._id), sentTo: maskMobile(m.mobile) });
  const text = `Udgam Microfinance: OTP ${otp} to allow a civil score check on your PAN XXXXX${String(m.pan).slice(5)}. Valid for 5 minutes. Do not share this OTP with anyone else.`;
  const sms = await sendSms({ to: m.mobile, text });
  await audit(req, { action: 'civilCheck.otpSent', entity: 'Member', entityId: m._id, after: { to: maskMobile(m.mobile) } });
  res.json({ challengeId: challenge._id, sentTo: maskMobile(m.mobile), expiresAt: challenge.expiresAt, ...(sms.dev && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}) });
}

/** After the OTP is verified: asks the bureau with the PAN and phone number and records the score as a civil check. */
export async function bureauFetch(req, res) {
  const m = await bureauMember(req);
  const ch = await takeVerified(req.body?.challengeId, req.user, 'civil_check', String(m._id));
  if (!ch) throw new HttpError(422, "Verify the OTP of the member's phone first", { otp: 'Verify the OTP first' });
  const r = await fetchCivilScore({ pan: m.pan, mobile: m.mobile, name: m.name });
  if (r.status === 'unavailable') throw new HttpError(409, 'The civil check service is not connected on the server yet.');
  if (r.status === 'error') throw new HttpError(424, r.message); // 4xx so that the message reaches the screen
  let employeeCode = req.user.employeeCode;
  if (!employeeCode) employeeCode = (await User.findById(req.user._id).select('employeeCode'))?.employeeCode;
  const today = startOfToday();
  const doc = await CivilCheck.create({
    member: m._id, branch: m.branch._id, score: r.score, reportDate: today, bureau: r.bureau, reportNumber: r.reportNumber || undefined,
    remark: 'Fetched from the bureau with the PAN number and the OTP of the phone number', employeeCode, feePaise: await civilFeePaise(), createdBy: req.user._id,
  });
  await consumeChallenge(ch);
  await audit(req, { action: 'civilCheck.fetch', entity: 'CivilCheck', entityId: doc._id, after: { member: m.code, score: r.score, bureau: r.bureau } });
  res.status(201).json({ check: present(doc) });
}

/** The fee of one civil check. */
export async function getSettings(_req, res) {
  res.json({ fee: (await civilFeePaise()) / 100 });
}

/** Admin: the amount charged for every civil check (0 = no fee). Each check adds it to the Cashbook. */
export async function saveSettings(req, res) {
  if (!isAdmin(req.user)) throw new HttpError(403, 'Only an admin can set the civil check fee');
  const raw = req.body?.fee;
  const paise = raw === '' || raw === undefined || raw === null ? 0 : toMinor(String(raw));
  if (paise === null || paise < 0 || paise > 10_000_00) throw new HttpError(422, 'Please correct the highlighted fields', { fee: 'Enter an amount from 0 to ₹10,000 (up to 2 decimals)' });
  await AppSetting.findOneAndUpdate({ key: CIVIL_FEE_KEY }, { $set: { value: paise, updatedBy: req.user._id } }, { upsert: true, new: true });
  await audit(req, { action: 'civilCheck.fee', entity: 'AppSetting', entityId: CIVIL_FEE_KEY, after: { fee: paise / 100 } });
  res.json({ fee: paise / 100 });
}

/** Only an admin removes a check (e.g. one entered by mistake). */
export async function deleteCheck(req, res) {
  if (!isAdmin(req.user)) throw new HttpError(403, 'Only an admin can delete a civil check');
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Civil check not found');
  const c = await CivilCheck.findOne({ _id: req.params.id, isDeleted: false });
  if (!c) throw new HttpError(404, 'Civil check not found');
  c.isDeleted = true;
  await c.save();
  await audit(req, { action: 'civilCheck.delete', entity: 'CivilCheck', entityId: c._id });
  res.json({ message: 'Civil check deleted' });
}

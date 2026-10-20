import mongoose from 'mongoose';
import { CivilCheck, BUREAUS } from '../models/CivilCheck.js';
import { Member } from '../models/Member.js';
import { User } from '../models/User.js';
import { branchFilter, isAdmin } from './groupController.js';
import { asString, createValidator, parseDateOnly, HttpError } from '../utils/http.js';
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
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
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

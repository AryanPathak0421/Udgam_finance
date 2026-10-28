import mongoose from 'mongoose';
import { CenterSurvey, SURVEY_STATUS } from '../models/CenterSurvey.js';
import { Branch } from '../models/Branch.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, parseDateOnly, HttpError, startOfToday } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { branchFilter, isAdmin } from './groupController.js';

/** New Center Survey: the survey of a place where a new center (group) may be opened, and its status. */
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const present = (s) => ({
  id: s._id, surveyNo: s.surveyNo, branch: s.branch?._id ? { id: s.branch._id, code: s.branch.code, name: s.branch.name } : null, centerName: s.centerName, area: s.area || '', pincode: s.pincode || '', district: s.district || '',
  surveyDate: iso(s.surveyDate), expectedMembers: s.expectedMembers || 0, meetingType: s.meetingType || '', leaderName: s.leaderName || '', leaderMobile: s.leaderMobile || '', remark: s.remark || '',
  status: s.status, history: (s.statusHistory || []).map((h) => ({ status: h.status, remark: h.remark || '', by: h.byCode || '', at: h.at })), surveyedBy: s.surveyedByCode || '',
});

export async function listSurveys(req, res) {
  const filter = { isDeleted: false, ...branchFilter(req.user) };
  const wanted = asString(req.query.branch);
  if (mongoose.isValidObjectId(wanted)) {
    const own = filter.branch?.$in?.map(String);
    filter.branch = own && !own.includes(wanted) ? { $in: [] } : new mongoose.Types.ObjectId(wanted);
  }
  if (SURVEY_STATUS.includes(asString(req.query.status))) filter.status = asString(req.query.status);
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) filter.surveyDate = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const q = asString(req.query.q).toLowerCase();
  const rows = await CenterSurvey.find(filter).sort({ surveyDate: -1, createdAt: -1 }).limit(2000).populate('branch', 'code name');
  const items = rows.map(present).filter((s) => !q || [s.surveyNo, s.centerName, s.area, s.leaderName, s.district].some((v) => String(v).toLowerCase().includes(q)));
  const count = (st) => items.filter((s) => s.status === st).length;
  res.json({ items, summary: { surveys: items.length, expectedMembers: items.reduce((t, s) => t + s.expectedMembers, 0), ...Object.fromEntries(SURVEY_STATUS.map((st) => [st, count(st)])) } });
}

export async function createSurvey(req, res) {
  const b = req.body || {};
  const mine = (req.user.branches || []).map(String);
  const branchId = mongoose.isValidObjectId(asString(b.branch)) ? asString(b.branch) : mine.length === 1 ? mine[0] : '';
  if (!branchId) throw invalid({ branch: 'Select the branch' });
  if (!isAdmin(req.user) && !mine.includes(branchId)) throw new HttpError(403, 'You can only use your own branches');
  if (!(await Branch.exists({ _id: branchId }))) throw invalid({ branch: 'Branch not found' });
  const centerName = asString(b.centerName);
  if (centerName.length < 2 || centerName.length > 100) throw invalid({ centerName: 'Enter the name of the center (2–100 characters)' });
  const surveyDate = b.surveyDate ? parseDateOnly(asString(b.surveyDate)) : startOfToday();
  if (!surveyDate) throw invalid({ surveyDate: 'Enter a valid date' });
  if (surveyDate > startOfToday()) throw invalid({ surveyDate: 'The survey date cannot be in the future' });
  const expected = b.expectedMembers === '' || b.expectedMembers === undefined ? 0 : Number(b.expectedMembers);
  if (!Number.isInteger(expected) || expected < 0 || expected > 1000) throw invalid({ expectedMembers: 'Enter a whole number of members' });
  const meetingType = asString(b.meetingType);
  if (!['', 'daily', 'weekly', 'monthly'].includes(meetingType)) throw invalid({ meetingType: 'Choose daily, weekly or monthly' });
  const mobile = asString(b.leaderMobile);
  if (mobile && !/^[6-9]\d{9}$/.test(mobile)) throw invalid({ leaderMobile: 'Enter a 10-digit mobile number' });
  const pincode = asString(b.pincode);
  if (pincode && !/^\d{6}$/.test(pincode)) throw invalid({ pincode: 'Enter a 6-digit pincode' });
  const s = await CenterSurvey.create({
    surveyNo: await generateCode('centerSurvey'), branch: branchId, centerName, area: asString(b.area).slice(0, 100), pincode, district: asString(b.district).slice(0, 60), surveyDate,
    expectedMembers: expected, meetingType, leaderName: asString(b.leaderName).slice(0, 80), leaderMobile: mobile, remark: asString(b.remark).slice(0, 300), status: 'surveyed',
    statusHistory: [{ status: 'surveyed', remark: 'Survey done', byCode: req.user.employeeCode || '', at: new Date() }], surveyedByCode: req.user.employeeCode || '', createdBy: req.user._id,
  });
  await s.populate('branch', 'code name');
  await audit(req, { action: 'centerSurvey.create', entity: 'CenterSurvey', entityId: s._id, after: { surveyNo: s.surveyNo, center: centerName } });
  res.status(201).json({ survey: present(s) });
}

/** Status update (branch manager / admin): surveyed, under review, approved, rejected, formed. */
export async function updateSurveyStatus(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Survey not found');
  const s = await CenterSurvey.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) }).populate('branch', 'code name');
  if (!s) throw new HttpError(404, 'Survey not found');
  const status = asString(req.body?.status);
  if (!SURVEY_STATUS.includes(status)) throw invalid({ status: 'Choose the status' });
  if (status === s.status) throw invalid({ status: 'The survey is already at this status' });
  const remark = asString(req.body?.remark).slice(0, 300);
  if (status === 'rejected' && remark.length < 3) throw invalid({ remark: 'Enter the reason' });
  s.status = status;
  s.statusHistory.push({ status, remark, byCode: req.user.employeeCode || '', at: new Date() });
  await s.save();
  await audit(req, { action: 'centerSurvey.status', entity: 'CenterSurvey', entityId: s._id, after: { surveyNo: s.surveyNo, status } });
  res.json({ survey: present(s) });
}

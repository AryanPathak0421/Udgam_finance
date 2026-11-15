import mongoose from 'mongoose';
import { CenterSurvey, SURVEY_STATUS } from '../models/CenterSurvey.js';
import { CenterVisit, CgtVisit } from '../modules/employee/employeeAppModel.js';
import { Branch } from '../models/Branch.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, parseDateOnly, HttpError, startOfToday } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { branchFilter, isAdmin } from './groupController.js';

/** New Center Survey: the survey of a place where a new center (group) may be opened, and its status. */
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const present = (s, cgtMap = new Map(), cvMap = new Map()) => {
  const normCenter = (s.centerName || '').trim().toLowerCase();
  const cgt = cgtMap.get(normCenter) || null;
  const cv = cvMap.get(normCenter) || null;

  return {
    id: s._id,
    surveyNo: s.surveyNo,
    branch: s.branch?._id ? { id: s.branch._id, code: s.branch.code, name: s.branch.name } : null,
    centerName: s.centerName,
    area: s.area || cv?.location?.address || '',
    pincode: s.pincode || '',
    district: s.district || '',
    surveyDate: iso(s.surveyDate),
    expectedMembers: s.expectedMembers || 0,
    meetingType: s.meetingType || '',
    leaderName: s.leaderName || '',
    leaderMobile: s.leaderMobile || '',
    remark: s.remark || '',
    status: s.status,
    history: (s.statusHistory || []).map((h) => ({ status: h.status, remark: h.remark || '', by: h.byCode || '', at: h.at })),
    surveyedBy: s.surveyedByCode || '',
    location: cv?.location || s.location || cgt?.day1?.location || cgt?.day2?.location || cgt?.day3?.location || null,
    visitPhoto: cv?.image || s.image || null,
    cgt: cgt
      ? {
          status: cgt.status,
          day1: cgt.day1 ? { date: iso(cgt.day1.date), photo: cgt.day1.photo || null, location: cgt.day1.location || null, members: cgt.day1.members || [] } : null,
          day2: cgt.day2 ? { date: iso(cgt.day2.date), photo: cgt.day2.photo || null, location: cgt.day2.location || null, members: cgt.day2.members || [] } : null,
          day3: cgt.day3 ? { date: iso(cgt.day3.date), photo: cgt.day3.photo || null, location: cgt.day3.location || null, members: cgt.day3.members || [] } : null,
        }
      : null,
  };
};

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
  const toEnd = to ? new Date(to.getTime() + 86400000 - 1) : null;
  if (from || toEnd) filter.surveyDate = { ...(from ? { $gte: from } : {}), ...(toEnd ? { $lte: toEnd } : {}) };

  // Point 21 Fix: Filter by specific employee / surveyedBy so surveys do not bleed across employees
  const empCode = asString(req.query.employeeCode || req.query.surveyedBy);
  if (empCode) {
    filter.surveyedByCode = new RegExp(`^${empCode}$`, 'i');
  } else if (req.user?.employeeCode && ['field_officer', 'collection_officer'].includes(req.user?.role)) {
    filter.surveyedByCode = req.user.employeeCode;
  }

  const q = asString(req.query.q).toLowerCase();
  const rows = await CenterSurvey.find(filter).sort({ surveyDate: -1, createdAt: -1 }).limit(2000).populate('branch', 'code name');

  // Point 14: Also include CenterVisit records recorded via Employee & Supervisor App
  const visitFilter = { ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(wanted)) {
    const own = visitFilter.branch?.$in?.map(String);
    visitFilter.branch = own && !own.includes(wanted) ? { $in: [] } : new mongoose.Types.ObjectId(wanted);
  }
  if (from || toEnd) {
    visitFilter.visitDate = { ...(from ? { $gte: from } : {}), ...(toEnd ? { $lte: toEnd } : {}) };
  }
  if (empCode) {
    visitFilter.employeeCode = new RegExp(`^${empCode}$`, 'i');
  } else if (req.user?.employeeCode && ['field_officer', 'collection_officer'].includes(req.user?.role)) {
    visitFilter.employeeCode = req.user.employeeCode;
  }

  const visitRows = await CenterVisit.find(visitFilter).sort({ visitDate: -1, createdAt: -1 }).limit(1000).populate('branch', 'code name');
  const cgtRows = await CgtVisit.find({}).sort({ updatedAt: -1 }).lean();

  const cgtMap = new Map();
  for (const c of cgtRows) {
    if (c.centerName) {
      cgtMap.set(c.centerName.trim().toLowerCase(), c);
    }
  }

  const cvMap = new Map();
  for (const cv of visitRows) {
    if (cv.centerName) {
      cvMap.set(cv.centerName.trim().toLowerCase(), cv);
    }
  }

  const existingNames = new Set(rows.map((r) => `${(r.centerName || '').trim().toLowerCase()}_${(r.surveyedByCode || '').toUpperCase()}`));

  for (const cv of visitRows) {
    const key = `${(cv.centerName || '').trim().toLowerCase()}_${(cv.employeeCode || '').toUpperCase()}`;
    if (!existingNames.has(key)) {
      existingNames.add(key);
      rows.push({
        _id: cv._id,
        surveyNo: `VIS-${String(cv._id).slice(-6).toUpperCase()}`,
        branch: cv.branch,
        centerName: cv.centerName,
        area: cv.location?.address || '',
        pincode: '',
        district: '',
        surveyDate: cv.visitDate || cv.createdAt,
        expectedMembers: 0,
        meetingType: '',
        leaderName: cv.contactName || '',
        leaderMobile: cv.contactNumber || '',
        remark: cv.notes || (cv.image ? 'Visit with photo from App' : 'App Center Visit'),
        status: cv.status === 'done' ? 'surveyed' : cv.status || 'surveyed',
        statusHistory: [{ status: 'surveyed', remark: cv.notes || 'Recorded via Mobile App', byCode: cv.employeeCode || '', at: cv.visitDate || cv.createdAt }],
        surveyedByCode: cv.employeeCode || cv.employeeName || '',
        location: cv.location,
        image: cv.image,
      });
    }
  }

  // Also include any CGT centers that may have been created directly
  for (const cgt of cgtRows) {
    const key = `${(cgt.centerName || '').trim().toLowerCase()}_${(cgt.employeeCode || '').toUpperCase()}`;
    if (!existingNames.has(key)) {
      existingNames.add(key);
      rows.push({
        _id: cgt._id,
        surveyNo: `CGT-${String(cgt._id).slice(-6).toUpperCase()}`,
        branch: cgt.branch,
        centerName: cgt.centerName,
        area: cgt.day1?.location?.address || '',
        pincode: '',
        district: '',
        surveyDate: cgt.day1?.date || cgt.createdAt,
        expectedMembers: (cgt.day1?.members || []).length,
        meetingType: 'daily',
        leaderName: (cgt.day1?.members || [])[0] || '',
        leaderMobile: '',
        remark: `CGT Progress: ${cgt.status === 'completed' ? 'All 3 Days Completed' : 'In Progress'}`,
        status: cgt.status === 'completed' ? 'formed' : 'under_review',
        statusHistory: [{ status: cgt.status === 'completed' ? 'formed' : 'under_review', remark: 'CGT Training in Progress', byCode: cgt.employeeCode || '', at: cgt.createdAt }],
        surveyedByCode: cgt.employeeCode || '',
        location: cgt.day1?.location || cgt.day2?.location || cgt.day3?.location,
      });
    }
  }

  const items = rows
    .map((s) => present(s, cgtMap, cvMap))
    .filter((s) => !q || [s.surveyNo, s.centerName, s.area, s.leaderName, s.district, s.surveyedBy].some((v) => String(v).toLowerCase().includes(q)));
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

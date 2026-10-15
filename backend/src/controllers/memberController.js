import crypto from 'crypto';
import mongoose from 'mongoose';
import { Member } from '../models/Member.js';
import { Branch } from '../models/Branch.js';
import { OtpChallenge } from '../models/OtpChallenge.js';
import { generateCode } from '../services/codeSequence.js';
import { sendSms } from '../services/sms.js';
import { INDIA_LOCATIONS } from '../data/indiaLocations.js';
import { branchFilter, isAdmin, maskMobile } from './groupController.js';
import { asString, createValidator, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

export const GENDERS = ['male', 'female', 'other'];
export const OCCUPATIONS = ['Farmer', 'Agricultural labour', 'Dairy / animal husbandry', 'Small shop / trader', 'Tailoring / handicraft', 'Daily wage labour', 'Salaried', 'Self employed', 'Homemaker', 'Other'];
export const EDUCATIONS = ['Illiterate', 'Primary', 'Middle school', 'Secondary (10th)', 'Higher secondary (12th)', 'Graduate', 'Post graduate', 'Other'];

const MOBILE_RE = /^[6-9]\d{9}$/;
const AADHAAR_RE = /^[2-9]\d{11}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PINCODE_RE = /^[1-9]\d{5}$/;
const ACCOUNT_RE = /^\d{9,18}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,79}$/;
const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 300_000; // ~220 KB image

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_GAP_MS = 30 * 1000;
const VERIFIED_VALID_MS = 30 * 60 * 1000; // a verified number must be used within 30 minutes

// ---- Aadhaar checksum (Verhoeff) -------------------------------------------------------------
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function verhoeff(num) {
  let c = 0;
  [...num].reverse().forEach((ch, i) => {
    c = D[c][P[i % 8][Number(ch)]];
  });
  return c === 0;
}

// ---- helpers ---------------------------------------------------------------------------------
const MANAGERS = ['super_admin', 'admin', 'branch_manager'];
const maskAadhaar = (a) => (a ? `XXXXXXXX${a.slice(-4)}` : '');
const maskPan = (p) => (p ? `${p.slice(0, 2)}XXXXX${p.slice(-3)}` : '');
const dateOnly = (d) => (d ? d.toISOString().slice(0, 10) : null);

const present = (m, user, { detail = false } = {}) => {
  const full = MANAGERS.includes(user.role);
  const out = {
    id: m._id,
    code: m.code,
    formId: m.formId,
    branch: m.branch?._id ? { id: m.branch._id, code: m.branch.code, name: m.branch.name } : null,
    branchId: String(m.branch?._id || m.branch),
    joiningDate: dateOnly(m.joiningDate),
    name: m.name,
    mobile: m.mobile,
    mobileVerified: Boolean(m.mobileVerifiedAt),
    gender: m.gender,
    occupation: m.occupation,
    state: m.state,
    district: m.district,
    aadhaar: full && detail ? m.aadhaar : maskAadhaar(m.aadhaar),
    pan: m.pan ? (full && detail ? m.pan : maskPan(m.pan)) : '',
    isActive: m.isActive,
    createdAt: m.createdAt,
  };
  if (detail) {
    Object.assign(out, {
      dob: dateOnly(m.dob),
      email: m.email || '',
      husbandName: m.husbandName || '',
      education: m.education,
      address: m.address,
      pincode: m.pincode,
      panVerified: Boolean(m.panVerifiedAt),
      bankName: m.bankName,
      ifsc: m.ifsc,
      accountNumber: full ? m.accountNumber : `XXXXX${m.accountNumber.slice(-4)}`,
      aadhaarPhoto: m.aadhaarPhoto || null,
      panPhoto: m.panPhoto || null,
      memberPhoto: m.memberPhoto || null,
      signaturePhoto: m.signaturePhoto || null,
    });
  }
  return out;
};

const POPULATE = { path: 'branch', select: 'code name' };

// ---- form options ------------------------------------------------------------------------------
export function memberOptions(_req, res) {
  res.json({
    genders: GENDERS,
    occupations: OCCUPATIONS,
    educations: EDUCATIONS,
    states: Object.keys(INDIA_LOCATIONS).sort(),
  });
}

export function districts(req, res) {
  res.json({ cities: [...(INDIA_LOCATIONS[req.query.state] || [])].sort() });
}

// ---- OTP ----------------------------------------------------------------------------------------
const hashOtp = (id, otp) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(`${id}:${otp}`).digest('hex');

/** Sends an OTP to verify a mobile number (to itself) or a PAN (to the member's mobile). */
export async function sendOtp(req, res) {
  const b = req.body || {};
  const purpose = b.purpose === 'pan' ? 'member_pan' : b.purpose === 'mobile' ? 'member_mobile' : null;
  const v = createValidator();
  if (!purpose) throw new HttpError(422, 'Invalid request');
  const mobile = asString(b.mobile);
  if (!MOBILE_RE.test(mobile)) v.add('mobile', 'Enter a valid 10-digit mobile number');
  let subject = mobile;
  if (purpose === 'member_pan') {
    subject = asString(b.pan).toUpperCase();
    if (!PAN_RE.test(subject)) v.add('pan', 'Enter a valid PAN (e.g. ABCDE1234F)');
  }
  v.throwIfAny();

  const last = await OtpChallenge.findOne({ createdBy: req.user._id, purpose, subject, consumedAt: { $exists: false } }).sort({ createdAt: -1 });
  if (last && Date.now() - last.createdAt.getTime() < OTP_RESEND_GAP_MS) {
    const wait = Math.ceil((OTP_RESEND_GAP_MS - (Date.now() - last.createdAt.getTime())) / 1000);
    throw new HttpError(429, `Please wait ${wait} seconds before requesting another OTP`);
  }
  const recent = await OtpChallenge.countDocuments({ createdBy: req.user._id, createdAt: { $gt: new Date(Date.now() - 3600_000) } });
  if (recent >= 20) throw new HttpError(429, 'Too many OTP requests. Please try again after some time.');

  const otp = String(crypto.randomInt(100000, 1000000));
  const ch = new OtpChallenge({
    purpose,
    subject,
    sentTo: mobile,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    createdBy: req.user._id,
  });
  ch.hash = hashOtp(ch._id, otp);
  await ch.save();

  const what = purpose === 'member_pan' ? 'PAN verification' : 'mobile verification';
  const sms = await sendSms({ to: mobile, text: `Udgam Microfinance: OTP ${otp} for ${what}. Valid for 5 minutes. Do not share this OTP.` });
  res.json({
    challengeId: ch._id,
    sentTo: maskMobile(mobile),
    expiresAt: ch.expiresAt,
    ...(sms.dev && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
  });
}

export async function verifyOtp(req, res) {
  const { challengeId } = req.body || {};
  const otp = asString(req.body?.otp);
  if (!mongoose.isValidObjectId(challengeId)) throw new HttpError(422, 'Send an OTP first');
  if (!/^\d{6}$/.test(otp)) throw new HttpError(422, 'Enter the 6-digit OTP', { otp: 'Enter the 6-digit OTP' });

  const ch = await OtpChallenge.findOne({ _id: challengeId, createdBy: req.user._id }).select('+hash');
  if (!ch) throw new HttpError(404, 'OTP request not found. Please send a new OTP.');
  if (ch.consumedAt) throw new HttpError(409, 'This OTP has already been used. Please send a new OTP.');
  if (ch.verifiedAt) return res.json({ verified: true });
  if (ch.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'The OTP has expired. Please send a new OTP.');
  if (ch.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong attempts. Please send a new OTP.');

  const given = Buffer.from(hashOtp(ch._id, otp), 'hex');
  const stored = Buffer.from(ch.hash, 'hex');
  if (!(given.length === stored.length && crypto.timingSafeEqual(given, stored))) {
    ch.attempts += 1;
    await ch.save();
    const left = OTP_MAX_ATTEMPTS - ch.attempts;
    throw new HttpError(422, left > 0 ? `Incorrect OTP. ${left} attempt${left > 1 ? 's' : ''} left.` : 'Incorrect OTP. Please send a new OTP.', {
      otp: 'Incorrect OTP',
    });
  }
  ch.verifiedAt = new Date();
  await ch.save();
  res.json({ verified: true });
}

// A verified challenge for exactly this value, by this user, recent and unused.
async function takeVerified(id, user, purpose, subject) {
  if (!mongoose.isValidObjectId(id)) return null;
  const ch = await OtpChallenge.findOne({ _id: id, createdBy: user._id, purpose, subject, consumedAt: { $exists: false } });
  if (!ch || !ch.verifiedAt || Date.now() - ch.verifiedAt.getTime() > VERIFIED_VALID_MS) return null;
  return ch;
}

// ---- create / list / view -----------------------------------------------------------------------
const age = (dob, on = new Date()) => {
  let a = on.getUTCFullYear() - dob.getUTCFullYear();
  const m = on.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate())) a -= 1;
  return a;
};

function readImage(value, field, label, v, { required }) {
  if (value === undefined || value === null || value === '') {
    if (required) v.add(field, `${label} is required`);
    return undefined;
  }
  if (typeof value !== 'string' || !IMAGE_RE.test(value)) {
    v.add(field, `${label} must be a PNG or JPEG image`);
    return undefined;
  }
  if (value.length > MAX_IMAGE_CHARS) {
    v.add(field, `${label} image is too large`);
    return undefined;
  }
  return value;
}

export async function createMember(req, res) {
  const b = req.body || {};
  const v = createValidator();
  const d = {};

  // Branch
  const branchId = String(b.branch || '');
  let branch = null;
  if (!mongoose.isValidObjectId(branchId)) v.add('branch', 'Select a branch');
  else {
    branch = await Branch.findOne({ _id: branchId, isDeleted: false, isActive: true });
    if (!branch) v.add('branch', 'Selected branch is not available');
    else if (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === String(branch._id))) {
      v.add('branch', 'You can only use branches assigned to you');
    }
  }
  d.branch = branch?._id;

  d.name = asString(b.name).replace(/\s+/g, ' ');
  if (!NAME_RE.test(d.name)) v.add('name', 'Enter the full name (letters only, 2–80 characters)');
  d.husbandName = asString(b.husbandName).replace(/\s+/g, ' ');
  if (d.husbandName && !NAME_RE.test(d.husbandName)) v.add('husbandName', 'Enter a valid name (letters only)');

  const dob = parseDateOnly(asString(b.dob));
  if (!dob) v.add('dob', 'Enter a valid date of birth');
  else if (age(dob) < 18) v.add('dob', 'Borrower must be at least 18 years old');
  else if (age(dob) > 80) v.add('dob', 'Please check the date of birth');
  d.dob = dob;

  d.gender = asString(b.gender);
  if (!GENDERS.includes(d.gender)) v.add('gender', 'Select gender');
  d.occupation = asString(b.occupation);
  if (!OCCUPATIONS.includes(d.occupation)) v.add('occupation', 'Select occupation');
  d.education = asString(b.education);
  if (!EDUCATIONS.includes(d.education)) v.add('education', 'Select education');

  d.mobile = asString(b.mobile);
  if (!MOBILE_RE.test(d.mobile)) v.add('mobile', 'Enter a valid 10-digit mobile number');
  d.email = asString(b.email).toLowerCase();
  if (d.email && !EMAIL_RE.test(d.email)) v.add('email', 'Enter a valid email address');

  d.address = asString(b.address);
  if (d.address.length < 5 || d.address.length > 300) v.add('address', 'Address must be 5–300 characters');
  d.pincode = asString(b.pincode);
  if (!PINCODE_RE.test(d.pincode)) v.add('pincode', 'Enter a valid 6-digit pincode');
  d.state = asString(b.state);
  d.district = asString(b.district);
  if (!INDIA_LOCATIONS[d.state]) v.add('state', 'Select a valid state');
  else if (!INDIA_LOCATIONS[d.state].includes(d.district)) v.add('district', 'Select a district from the list for this state');

  d.aadhaar = asString(b.aadhaar).replace(/\s/g, '');
  if (!AADHAAR_RE.test(d.aadhaar) || !verhoeff(d.aadhaar)) v.add('aadhaar', 'Enter a valid 12-digit Aadhaar number');
  d.pan = asString(b.pan).toUpperCase();
  if (d.pan && !PAN_RE.test(d.pan)) v.add('pan', 'Enter a valid PAN (e.g. ABCDE1234F)');

  d.bankName = asString(b.bankName);
  if (d.bankName.length < 2 || d.bankName.length > 80) v.add('bankName', 'Enter the bank name');
  d.ifsc = asString(b.ifsc).toUpperCase();
  if (!IFSC_RE.test(d.ifsc)) v.add('ifsc', 'Enter a valid IFSC code (e.g. SBIN0001234)');
  d.accountNumber = asString(b.accountNumber);
  if (!ACCOUNT_RE.test(d.accountNumber)) v.add('accountNumber', 'Account number must be 9–18 digits');

  d.memberPhoto = readImage(b.memberPhoto, 'memberPhoto', 'Member photo', v, { required: true });
  d.aadhaarPhoto = readImage(b.aadhaarPhoto, 'aadhaarPhoto', 'Aadhaar photo', v, { required: true });
  d.signaturePhoto = readImage(b.signaturePhoto, 'signaturePhoto', 'Signature photo', v, { required: true });
  d.panPhoto = readImage(b.panPhoto, 'panPhoto', 'PAN photo', v, { required: Boolean(d.pan) });
  v.throwIfAny();

  // OTP verification is mandatory for the mobile number, and for the PAN when one is given.
  const mobileCh = await takeVerified(b.mobileChallengeId, req.user, 'member_mobile', d.mobile);
  if (!mobileCh) v.add('mobile', 'Verify the mobile number with an OTP');
  let panCh = null;
  if (d.pan) {
    panCh = await takeVerified(b.panChallengeId, req.user, 'member_pan', d.pan);
    if (!panCh) v.add('pan', 'Verify the PAN with an OTP');
  }
  v.throwIfAny();

  if (await Member.exists({ aadhaar: d.aadhaar, isDeleted: false })) {
    throw new HttpError(409, 'A member with this Aadhaar number already exists', { aadhaar: 'This Aadhaar number is already registered' });
  }
  if (d.pan && (await Member.exists({ pan: d.pan, isDeleted: false }))) {
    throw new HttpError(409, 'A member with this PAN already exists', { pan: 'This PAN is already registered' });
  }

  let doc;
  try {
    const [code, formId] = [await generateCode('member'), await generateCode('form')];
    doc = await Member.create({
      ...d,
      pan: d.pan || undefined,
      email: d.email || undefined,
      husbandName: d.husbandName || undefined,
      code,
      formId,
      joiningDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
      mobileVerifiedAt: mobileCh.verifiedAt,
      panVerifiedAt: panCh?.verifiedAt,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'This Aadhaar number or PAN is already registered');
    throw err;
  }
  const consumed = new Date();
  await OtpChallenge.updateMany({ _id: { $in: [mobileCh._id, panCh?._id].filter(Boolean) } }, { $set: { consumedAt: consumed } });

  await doc.populate(POPULATE);
  await audit(req, {
    action: 'member.create',
    entity: 'Member',
    entityId: doc._id,
    after: { code: doc.code, formId: doc.formId, name: doc.name, branch: String(doc.branch._id), aadhaar: maskAadhaar(doc.aadhaar), pan: maskPan(doc.pan) },
  });
  res.status(201).json({ member: present(doc, req.user) });
}

export async function listMembers(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { isDeleted: false, ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { formId: rx }, { name: rx }, { mobile: rx }];
  }
  const [items, total] = await Promise.all([
    Member.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Member.countDocuments(filter),
  ]);
  res.json({ items: items.map((m) => present(m, req.user)), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

export async function getMember(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Member not found');
  const m = await Member.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) })
    .select('+aadhaarPhoto +panPhoto +memberPhoto +signaturePhoto')
    .populate(POPULATE);
  if (!m) throw new HttpError(404, 'Member not found');
  res.json({ member: present(m, req.user, { detail: true }) });
}

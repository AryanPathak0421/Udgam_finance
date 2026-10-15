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
import { User } from '../models/User.js';
import { lookupPincode, lookupIfsc } from '../services/lookup.js';
import { checkPanFormat, verifyPan, verifyBankAccount } from '../services/kycVerify.js';
import { AuditLog } from '../models/AuditLog.js';

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
const HISTORY_PHOTOS = ['photo', 'signature', 'aadhaarPhoto', 'panPhoto', 'jointPhoto'].map((f) => `+guarantorHistory.${f}`).join(' ');
const PARTY_PHOTOS = ['guarantor', 'nominee'].flatMap((k) => ['photo', 'signature', 'aadhaarPhoto', 'panPhoto', 'jointPhoto'].map((f) => `+${k}.${f}`)).join(' ');
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
    employeeCode: m.employeeCode || '',
    hasGuarantor: Boolean(m.guarantor?.name),
    hasNominee: Boolean(m.nominee?.name),
    isActive: m.isActive,
    isBlocked: Boolean(m.isBlocked),
    blockReason: m.isBlocked ? (m.blockHistory || []).filter((b) => b.action === 'block').slice(-1)[0]?.reason || '' : '',
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
      pincodeVerified: Boolean(m.pincodeVerified),
      ifscVerified: Boolean(m.ifscVerified),
      accountVerified: Boolean(m.accountVerifiedAt),
      bankName: m.bankName,
      ifsc: m.ifsc,
      accountNumber: full ? m.accountNumber : `XXXXX${m.accountNumber.slice(-4)}`,
      aadhaarPhoto: m.aadhaarPhoto || null,
      panPhoto: m.panPhoto || null,
      memberPhoto: m.memberPhoto || null,
      signaturePhoto: m.signaturePhoto || null,
      guarantor: presentPerson(m.guarantor, full),
      nominee: presentPerson(m.nominee, full),
      guarantorHistory: (m.guarantorHistory || [])
        .map((h) => ({
          ...presentPerson(h, full),
          replacedAt: h.replacedAt,
          replacedByCode: h.replacedByCode || '',
          reason: h.reason || '',
        }))
        .reverse(),
    });
  }
  return out;
};

const presentPerson = (p, full) =>
  p?.name
    ? {
        name: p.name,
        mobile: p.mobile || '',
        mobileVerified: Boolean(p.mobileVerifiedAt),
        aadhaar: full ? p.aadhaar : maskAadhaar(p.aadhaar),
        pan: p.pan ? (full ? p.pan : maskPan(p.pan)) : '',
        panVerified: Boolean(p.panVerifiedAt),
        photo: p.photo || null,
        signature: p.signature || null,
        aadhaarPhoto: p.aadhaarPhoto || null,
        panPhoto: p.panPhoto || null,
        jointPhoto: p.jointPhoto || null,
        sameAsGuarantor: Boolean(p.sameAsGuarantor),
        employeeCode: p.employeeCode || '',
        savedAt: p.savedAt,
      }
    : null;

const POPULATE = { path: 'branch', select: 'code name' };

// Which staff ID goes on a record.
// - Web software: the employee is chosen on the form and sent as `employeeCode`.
// - Mobile app / API without a code: the signed-in employee's own ID is fetched automatically.
async function resolveEmployee(req, v, branchId) {
  const given = asString(req.body?.employeeCode).toUpperCase();
  if (!given) return staffId(req.user);
  const emp = await User.findOne({ employeeCode: given, isActive: true }).select('employeeCode role branches');
  const inBranch = emp && (['super_admin', 'admin'].includes(emp.role) || (emp.branches || []).some((x) => String(x) === String(branchId)));
  if (!emp) v.add('employeeCode', 'Select a valid employee');
  else if (!inBranch) v.add('employeeCode', 'This employee does not belong to the selected branch');
  v.throwIfAny();
  return emp.employeeCode;
}

// The signed-in user's staff ID (assigned on first use for accounts created before staff IDs existed).
async function staffId(user) {
  if (user.employeeCode) return user.employeeCode;
  const code = await generateCode('employee');
  await User.updateOne({ _id: user._id, employeeCode: { $exists: false } }, { $set: { employeeCode: code } });
  const fresh = await User.findById(user._id).select('employeeCode');
  user.employeeCode = fresh.employeeCode;
  return user.employeeCode;
}

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
  const purpose = b.purpose === 'mobile' ? 'member_mobile' : null;
  const v = createValidator();
  if (!purpose) throw new HttpError(422, 'Invalid request');
  const mobile = asString(b.mobile);
  if (!MOBILE_RE.test(mobile)) v.add('mobile', 'Enter a valid 10-digit mobile number');
  const subject = mobile;
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

  const what = 'mobile verification';
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
  if (d.pan) {
    const pc = checkPanFormat(d.pan, d.name);
    if (!pc.ok) v.add('pan', pc.message);
  }

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

  // The mobile number must be verified with an OTP.
  const mobileCh = await takeVerified(b.mobileChallengeId, req.user, 'member_mobile', d.mobile);
  if (!mobileCh) v.add('mobile', 'Verify the mobile number with an OTP');
  v.throwIfAny();

  // Pincode and IFSC are checked against public data when it can be reached (never blocks on an outage).
  const pin = await lookupPincode(d.pincode);
  if (pin.status === 'invalid') v.add('pincode', 'This pincode does not exist');
  else if (pin.status === 'ok' && pin.stateKnown && pin.state !== d.state) v.add('state', `Pincode ${d.pincode} belongs to ${pin.state}`);
  const bank = await lookupIfsc(d.ifsc);
  if (bank.status === 'invalid') v.add('ifsc', 'This IFSC code does not exist');
  v.throwIfAny();

  // PAN holder and bank account verification need a KYC provider; recorded only when really verified.
  const panCheck = d.pan ? await verifyPan(d.pan, d.name) : { status: 'unavailable' };
  if (panCheck.status === 'mismatch') throw new HttpError(422, 'Please correct the highlighted fields', { pan: 'The PAN does not belong to this person' });
  const acctCheck = await verifyBankAccount(d.accountNumber, d.ifsc, d.name);
  if (acctCheck.status === 'mismatch') throw new HttpError(422, 'Please correct the highlighted fields', { accountNumber: 'The account does not match this person' });
  const employeeCode = await resolveEmployee(req, v, d.branch);

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
      panVerifiedAt: panCheck.status === 'verified' ? new Date() : undefined,
      pincodeVerified: pin.status === 'ok',
      ifscVerified: bank.status === 'ok',
      accountVerifiedAt: acctCheck.status === 'verified' ? new Date() : undefined,
      employeeCode,
      kycKeys: ['memberPhoto', 'signaturePhoto', 'aadhaarPhoto', ...(d.panPhoto ? ['panPhoto'] : [])],
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'This Aadhaar number or PAN is already registered');
    throw err;
  }
  const consumed = new Date();
  await OtpChallenge.updateMany({ _id: { $in: [mobileCh._id] } }, { $set: { consumedAt: consumed } });

  await doc.populate(POPULATE);
  await audit(req, {
    action: 'member.create',
    entity: 'Member',
    entityId: doc._id,
    after: { code: doc.code, formId: doc.formId, name: doc.name, branch: String(doc.branch._id), aadhaar: maskAadhaar(doc.aadhaar), pan: maskPan(doc.pan) },
  });
  res.status(201).json({ member: present(doc, req.user) });
}

/**
 * Search box used everywhere a member is looked up. Matches on the member's name, member code,
 * form ID, mobile number, last 4 digits of Aadhaar and PAN number — and on the same details of
 * the guarantor, so a member can be found from a guarantor too.
 */
export function memberSearchFilter(q) {
  const text = asString(q);
  if (!text) return null;
  const rx = new RegExp(escapeRegex(text), 'i');
  const or = [{ code: rx }, { formId: rx }, { name: rx }, { mobile: rx }, { 'guarantor.name': rx }, { 'guarantor.mobile': rx }];
  if (/^\d{4}$/.test(text)) {
    const tail = new RegExp(`${text}$`);
    or.push({ aadhaar: tail }, { 'guarantor.aadhaar': tail });
  }
  if (/^[A-Za-z0-9]{4,10}$/.test(text) && /[A-Za-z]/.test(text)) {
    const pan = new RegExp(`^${escapeRegex(text.toUpperCase())}`);
    or.push({ pan }, { 'guarantor.pan': pan });
  }
  return { $or: or };
}

// How a listed member matched (own details, or via the guarantor).
function matchedVia(m, q) {
  const text = asString(q).toLowerCase();
  if (!text) return '';
  const has = (v) => String(v || '').toLowerCase().includes(text);
  const own = [m.code, m.formId, m.name, m.mobile].some(has) || (/^\d{4}$/.test(text) && String(m.aadhaar || '').endsWith(text)) || String(m.pan || '').toLowerCase().startsWith(text);
  if (own) return '';
  const g = m.guarantor;
  if (g?.name && (has(g.name) || has(g.mobile) || (/^\d{4}$/.test(text) && String(g.aadhaar || '').endsWith(text)) || String(g.pan || '').toLowerCase().startsWith(text))) return 'guarantor';
  return '';
}

export async function listMembers(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { isDeleted: false, ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  if (req.query.blocked === 'true') filter.isBlocked = true;
  if (req.query.blocked === 'false') filter.isBlocked = { $ne: true };
  const q = asString(req.query.q);
  const search = memberSearchFilter(q);
  if (search) Object.assign(filter, search);
  const [items, total] = await Promise.all([
    Member.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Member.countDocuments(filter),
  ]);
  res.json({
    items: items.map((m) => ({ ...present(m, req.user), matchedVia: matchedVia(m, q) })),
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  });
}

export async function getMember(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Member not found');
  const m = await Member.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) })
    .select('+aadhaarPhoto +panPhoto +memberPhoto +signaturePhoto')
    .select(PARTY_PHOTOS)
    .select(HISTORY_PHOTOS)
    .populate(POPULATE);
  if (!m) throw new HttpError(404, 'Member not found');
  res.json({ member: present(m, req.user, { detail: true }) });
}

// ---- guarantor / nominee -----------------------------------------------------------------------
// Both use the same fields. The phone number's OTP verification is optional.
const PARTY_FIELDS = ['photo', 'signature', 'aadhaarPhoto', 'panPhoto', 'jointPhoto'];

async function loadMemberFor(req, { photos = false } = {}) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Member not found');
  let q = Member.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) });
  if (photos) q = q.select(PARTY_PHOTOS).select(HISTORY_PHOTOS);
  const m = await q;
  if (!m) throw new HttpError(404, 'Member not found');
  return m;
}

/** Validates the guarantor / nominee form of the request and returns the person to store. */
async function readPerson(req, kind, m, existing) {
  const label = kind === 'guarantor' ? 'Guarantor' : 'Nominee';
  const b = req.body || {};
  const v = createValidator();
  const d = {};
  d.name = asString(b.name).replace(/\s+/g, ' ');
  if (!NAME_RE.test(d.name)) v.add('name', `Enter the ${label.toLowerCase()}'s full name (letters only)`);
  // Optional phone number; when given it must be OTP-verified (checked below).
  d.mobile = asString(b.mobile);
  if (d.mobile && !MOBILE_RE.test(d.mobile)) v.add('mobile', 'Enter a valid 10-digit mobile number');
  d.aadhaar = asString(b.aadhaar).replace(/\s/g, '');
  if (!AADHAAR_RE.test(d.aadhaar) || !verhoeff(d.aadhaar)) v.add('aadhaar', 'Enter a valid 12-digit Aadhaar number');
  else if (kind === 'guarantor' && d.aadhaar === m.aadhaar) v.add('aadhaar', 'The guarantor cannot be the borrower');
  d.pan = asString(b.pan).toUpperCase();
  if (d.pan) {
    const pc = checkPanFormat(d.pan, d.name);
    if (!pc.ok) v.add('pan', pc.message);
    else if (kind === 'guarantor' && d.pan === m.pan) v.add('pan', 'The guarantor cannot be the borrower');
  }

  d.photo = readImage(b.photo, 'photo', `${label} photo`, v, { required: true });
  d.signature = readImage(b.signature, 'signature', 'Signature', v, { required: true });
  d.aadhaarPhoto = readImage(b.aadhaarPhoto, 'aadhaarPhoto', 'Aadhaar photo', v, { required: true });
  d.panPhoto = readImage(b.panPhoto, 'panPhoto', 'PAN photo', v, { required: Boolean(d.pan) });
  d.jointPhoto = readImage(b.jointPhoto, 'jointPhoto', 'Joint photo', v, { required: false });
  v.throwIfAny();

  // A phone number that is given has to be verified with an OTP. The same number that was already
  // verified when it was saved earlier does not need to be verified again.
  let verifiedAt;
  if (d.mobile) {
    if (existing?.mobile === d.mobile && existing.mobileVerifiedAt) {
      verifiedAt = existing.mobileVerifiedAt;
    } else {
      const ch = await takeVerified(b.mobileChallengeId, req.user, 'member_mobile', d.mobile);
      if (!ch) throw new HttpError(422, 'Please correct the highlighted fields', { mobile: 'Verify the phone number with an OTP' });
      verifiedAt = ch.verifiedAt;
      await OtpChallenge.updateOne({ _id: ch._id }, { $set: { consumedAt: new Date() } });
    }
  }

  // PAN holder verification (needs a KYC provider; recorded only when really verified).
  const panCheck = d.pan ? await verifyPan(d.pan, d.name) : { status: 'unavailable' };
  if (panCheck.status === 'mismatch') throw new HttpError(422, 'Please correct the highlighted fields', { pan: 'The PAN does not belong to this person' });

  const employeeCode = await resolveEmployee(req, v, m.branch);
  return {
    ...d,
    mobile: d.mobile || undefined,
    pan: d.pan || undefined,
    panVerifiedAt: panCheck.status === 'verified' ? new Date() : undefined,
    mobileVerifiedAt: verifiedAt,
    sameAsGuarantor: false,
    employeeCode,
    savedAt: new Date(),
    savedBy: req.user._id,
  };
}

// A new or replaced document goes back to the approval queue.
function resetKyc(m, prefix, person) {
  m.kycDocs = (m.kycDocs || []).filter((x) => !x.key.startsWith(prefix));
  const kept = (m.kycKeys || []).filter((k) => !k.startsWith(prefix));
  const added = person ? PARTY_FIELDS.filter((f) => person[f]).map((f) => prefix + f) : [];
  m.kycKeys = [...kept, ...added];
}

export function savePerson(kind) {
  const label = kind === 'guarantor' ? 'Guarantor' : 'Nominee';
  return async (req, res) => {
    // "Nominee is the guarantor": the nominee details are copied from the guarantor.
    const same = kind === 'nominee' && req.body?.sameAsGuarantor === true;
    const m = await loadMemberFor(req, { photos: same });
    let person;
    if (same) {
      const g = m.guarantor;
      if (!g?.name) throw new HttpError(409, 'Add the guarantor first, then the nominee can be marked as the same person');
      person = {
        name: g.name,
        mobile: g.mobile,
        mobileVerifiedAt: g.mobileVerifiedAt,
        aadhaar: g.aadhaar,
        pan: g.pan,
        panVerifiedAt: g.panVerifiedAt,
        photo: g.photo,
        signature: g.signature,
        aadhaarPhoto: g.aadhaarPhoto,
        panPhoto: g.panPhoto,
        jointPhoto: g.jointPhoto,
        sameAsGuarantor: true,
        employeeCode: await resolveEmployee(req, createValidator(), m.branch),
        savedAt: new Date(),
        savedBy: req.user._id,
      };
    } else {
      person = await readPerson(req, kind, m, m[kind]);
    }
    const before = Boolean(m[kind]?.name);
    m[kind] = person;
    // The guarantor's documents are reviewed once; a copied nominee needs no second review.
    resetKyc(m, `${kind}.`, same ? null : person);
    m.updatedBy = req.user._id;
    await m.save();
    await audit(req, {
      action: `member.${kind}${before ? 'Updated' : 'Added'}`,
      entity: 'Member',
      entityId: m._id,
      after: { code: m.code, [kind]: { name: person.name, aadhaar: maskAadhaar(person.aadhaar), pan: maskPan(person.pan), sameAsGuarantor: Boolean(same) } },
    });
    res.json({ message: same ? 'Nominee set as the guarantor' : `${label} saved`, employeeCode: m[kind].employeeCode });
  };
}

/**
 * Replaces the guarantor. The previous guarantor is kept (with when/who/why it was replaced)
 * so the change history can always be shown.
 */
export async function changeGuarantor(req, res) {
  const m = await loadMemberFor(req, { photos: true });
  if (!m.guarantor?.name) {
    throw new HttpError(409, 'This member has no guarantor yet. Add one under Guarantor Detail first.');
  }
  const reason = asString(req.body?.reason);
  if (reason.length < 3 || reason.length > 200) {
    throw new HttpError(422, 'Please correct the highlighted fields', { reason: 'Enter the reason for the change (3–200 characters)' });
  }
  const person = await readPerson(req, 'guarantor', m);
  if (person.aadhaar === m.guarantor.aadhaar) {
    throw new HttpError(422, 'Please correct the highlighted fields', { aadhaar: 'This is the current guarantor. Enter a different person.' });
  }

  const old = m.guarantor.toObject();
  m.guarantorHistory.push({ ...old, replacedAt: new Date(), replacedBy: req.user._id, replacedByCode: person.employeeCode, reason });
  m.guarantor = person;
  // A nominee that was copied from the old guarantor stays that person; it is no longer "the guarantor".
  if (m.nominee?.sameAsGuarantor) m.nominee.sameAsGuarantor = false;
  resetKyc(m, 'guarantor.', person);
  m.updatedBy = req.user._id;
  await m.save();
  await audit(req, {
    action: 'member.guarantorChanged',
    entity: 'Member',
    entityId: m._id,
    before: { guarantor: { name: old.name, aadhaar: maskAadhaar(old.aadhaar) } },
    after: { code: m.code, reason, guarantor: { name: person.name, aadhaar: maskAadhaar(person.aadhaar) } },
  });
  res.json({ message: 'Guarantor changed', employeeCode: person.employeeCode });
}

// ---- KYC approval ---------------------------------------------------------------------------------
// Every uploaded document is reviewed on its own. A document without a review record is pending.
const cap = (s) => s[0].toUpperCase() + s.slice(1);
export const KYC_DOCS = [
  { key: 'memberPhoto', who: 'Member', label: 'Member photo' },
  { key: 'signaturePhoto', who: 'Member', label: 'Signature' },
  { key: 'aadhaarPhoto', who: 'Member', label: 'Aadhaar' },
  { key: 'panPhoto', who: 'Member', label: 'PAN' },
  ...['guarantor', 'nominee'].flatMap((k) => [
    { key: `${k}.photo`, who: cap(k), label: 'Photo' },
    { key: `${k}.signature`, who: cap(k), label: 'Signature' },
    { key: `${k}.aadhaarPhoto`, who: cap(k), label: 'Aadhaar' },
    { key: `${k}.panPhoto`, who: cap(k), label: 'PAN' },
    { key: `${k}.jointPhoto`, who: cap(k), label: 'Joint photo with member' },
  ]),
];
const KYC_KEYS = new Set(KYC_DOCS.map((d) => d.key));
const pathOf = (m, key) => key.split('.').reduce((o, p) => (o ? o[p] : undefined), m);

// Review state of the given documents (keys); a document with no review record is pending.
function docStates(m, keys) {
  return KYC_DOCS.filter((def) => keys.includes(def.key)).map((def) => {
    const rec = (m.kycDocs || []).find((x) => x.key === def.key);
    return {
      key: def.key,
      who: def.who,
      label: def.label,
      status: rec?.status || 'pending',
      reason: rec?.reason || '',
      reviewedAt: rec?.reviewedAt || null,
      reviewedByCode: rec?.reviewedByCode || '',
      resubmitted: Boolean(rec?.resubmittedAt),
    };
  });
}

// Pending as long as anything is still waiting for a decision (e.g. 5 of 10 reviewed, 5 pending).
// Only when nothing is pending: rejected if any document was rejected, otherwise approved.
function kycStatusOf(docs) {
  if (!docs.length) return 'pending';
  if (docs.some((d) => d.status === 'pending')) return 'pending';
  if (docs.some((d) => d.status === 'rejected')) return 'rejected';
  return 'approved';
}

// KYC state of one person's documents: 'none' when nothing was uploaded for them.
const partyState = (docs, who) => {
  const list = docs.filter((d) => d.who === who);
  if (!list.length) return { status: 'none', total: 0, approved: 0, rejected: 0, pending: 0 };
  const n = (st) => list.filter((d) => d.status === st).length;
  return { status: kycStatusOf(list), total: list.length, approved: n('approved'), rejected: n('rejected'), pending: n('pending') };
};

const kycSummary = (m, keys = m.kycKeys || []) => {
  const docs = docStates(m, keys);
  const count = (st) => docs.filter((d) => d.status === st).length;
  const parties = {
    member: partyState(docs, 'Member'),
    guarantor: partyState(docs, 'Guarantor'),
    nominee: partyState(docs, 'Nominee'),
  };
  // A nominee copied from the guarantor is covered by the guarantor's review.
  if (m.nominee?.sameAsGuarantor) parties.nominee = { status: 'same', total: 0, approved: 0, rejected: 0, pending: 0 };
  return {
    parties,
    id: m._id,
    code: m.code,
    formId: m.formId,
    name: m.name,
    mobile: m.mobile,
    branch: m.branch?._id ? { id: m.branch._id, code: m.branch.code, name: m.branch.name } : null,
    submittedAt: m.createdAt,
    status: kycStatusOf(docs),
    total: docs.length,
    approved: count('approved'),
    rejected: count('rejected'),
    pending: count('pending'),
  };
};

const KYC_PROJECTION = '+aadhaarPhoto +panPhoto +memberPhoto +signaturePhoto';

/** Date-wise queue of members whose documents need approval. */
export async function listKyc(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const filter = { isDeleted: false, ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lt = new Date(to.getTime() + 24 * 3600 * 1000);
  }
  const search = memberSearchFilter(req.query.q);
  if (search) Object.assign(filter, search);
  const status = asString(req.query.status);

  // Status is derived from the documents, so it is applied after loading (member sets are branch-sized).
  const all = await Member.find(filter)
    .select('name code formId mobile branch createdAt kycKeys kycDocs nominee.sameAsGuarantor')
    .populate(POPULATE)
    .sort({ createdAt: -1 });
  let rows = all.map((m) => kycSummary(m));
  const counts = {
    pending: rows.filter((r) => r.status === 'pending').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    approved: rows.filter((r) => r.status === 'approved').length,
  };
  // Optionally look at one person only: borrower (member), guarantor or nominee.
  const party = asString(req.query.party);
  if (['member', 'guarantor', 'nominee'].includes(party)) {
    rows = rows.filter((r) => ['pending', 'rejected', 'approved'].includes(r.parties[party].status));
    if (['pending', 'rejected', 'approved'].includes(status)) rows = rows.filter((r) => r.parties[party].status === status);
  } else if (['pending', 'rejected', 'approved'].includes(status)) rows = rows.filter((r) => r.status === status);
  const total = rows.length;
  res.json({
    items: rows.slice(skip, skip + limit),
    counts,
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  });
}

/** All documents of one member (with images) and their review state. */
export async function getKyc(req, res) {
  const m = await loadMemberFor(req);
  const full = await Member.findById(m._id).select(`${KYC_PROJECTION} ${PARTY_PHOTOS}`).populate(POPULATE);
  const keys = KYC_DOCS.filter((d) => pathOf(full, d.key) && !(d.key.startsWith('nominee.') && full.nominee?.sameAsGuarantor)).map((d) => d.key);
  const docs = docStates(full, keys).map((d) => ({ ...d, image: pathOf(full, d.key) }));
  res.json({ member: { ...kycSummary(full, keys), guarantor: full.guarantor?.name || '', nominee: full.nominee?.name || '' }, documents: docs });
}

/** Approve or reject one document (rejection needs a reason). */
export async function reviewKyc(req, res) {
  const m = await loadMemberFor(req);
  const key = asString(req.body?.key);
  const action = asString(req.body?.action);
  const reason = asString(req.body?.reason);
  if (!KYC_KEYS.has(key)) throw new HttpError(422, 'Unknown document');
  if (!['approve', 'reject'].includes(action)) throw new HttpError(422, 'Choose approve or reject');
  if (action === 'reject' && (reason.length < 3 || reason.length > 200)) {
    throw new HttpError(422, 'Enter the reason for rejection (3–200 characters)', { reason: 'Enter the reason for rejection' });
  }
  const full = await Member.findById(m._id).select(`${KYC_PROJECTION} ${PARTY_PHOTOS}`);
  if (!pathOf(full, key)) throw new HttpError(409, 'This document has not been uploaded');

  const rec = { key, status: action === 'approve' ? 'approved' : 'rejected', reason: action === 'reject' ? reason : '', reviewedAt: new Date(), reviewedBy: req.user._id, reviewedByCode: await staffId(req.user) };
  const list = (m.kycDocs || []).filter((x) => x.key !== key);
  m.kycDocs = [...list, rec];
  await m.save();
  await audit(req, { action: `kyc.${action}`, entity: 'Member', entityId: m._id, after: { code: m.code, document: key, reason: rec.reason } });
  res.json({ message: action === 'approve' ? 'Document approved' : 'Document rejected' });
}

/** Replaces a rejected document; it goes back to pending. */
export async function reuploadKyc(req, res) {
  const m = await loadMemberFor(req);
  const key = asString(req.body?.key);
  if (!KYC_KEYS.has(key)) throw new HttpError(422, 'Unknown document');
  const rec = (m.kycDocs || []).find((x) => x.key === key);
  if (!rec || rec.status !== 'rejected') throw new HttpError(409, 'Only a rejected document can be re-uploaded');
  const v = createValidator();
  const image = readImage(req.body?.image, 'image', 'Document', v, { required: true });
  v.throwIfAny();

  m.set(key, image);
  const resubmitted = new Date();
  m.kycDocs = (m.kycDocs || []).filter((x) => x.key !== key);
  m.kycDocs.push({ key, status: 'pending', resubmittedAt: resubmitted });
  m.updatedBy = req.user._id;
  await m.save();
  await audit(req, { action: 'kyc.reupload', entity: 'Member', entityId: m._id, after: { code: m.code, document: key } });
  res.json({ message: 'Document uploaded again and sent for approval' });
}

// ---- block / unblock ---------------------------------------------------------------------------------
/** Blocks or unblocks a borrower. A reason is required and every change is kept in the member's history. */
export async function setBlocked(req, res) {
  const m = await loadMemberFor(req);
  const action = asString(req.body?.action);
  const reason = asString(req.body?.reason);
  if (!['block', 'unblock'].includes(action)) throw new HttpError(422, 'Choose block or unblock');
  if (reason.length < 3 || reason.length > 200) {
    throw new HttpError(422, 'Please correct the highlighted fields', { reason: 'Enter the reason (3–200 characters)' });
  }
  if (action === 'block' && m.isBlocked) throw new HttpError(409, 'This member is already blocked');
  if (action === 'unblock' && !m.isBlocked) throw new HttpError(409, 'This member is not blocked');

  m.isBlocked = action === 'block';
  m.blockHistory.push({ action, reason, at: new Date(), by: req.user._id, byCode: await staffId(req.user) });
  m.updatedBy = req.user._id;
  await m.save();
  await audit(req, { action: `member.${action}`, entity: 'Member', entityId: m._id, after: { code: m.code, reason } });
  res.json({ message: action === 'block' ? 'Member blocked' : 'Member unblocked', isBlocked: m.isBlocked });
}

// ---- borrower synopsis (A to Z) --------------------------------------------------------------------------
const TIMELINE_LABELS = {
  'member.create': 'Borrower registered',
  'member.guarantorAdded': 'Guarantor added',
  'member.guarantorUpdated': 'Guarantor updated',
  'member.guarantorChanged': 'Guarantor changed',
  'member.nomineeAdded': 'Nominee added',
  'member.nomineeUpdated': 'Nominee updated',
  'member.block': 'Member blocked',
  'member.unblock': 'Member unblocked',
  'kyc.approve': 'Document approved',
  'kyc.reject': 'Document rejected',
  'kyc.reupload': 'Document uploaded again',
};

/** Everything about one member in one response: profile, documents, KYC, guarantor, nominee, history, activity. */
export async function synopsis(req, res) {
  const m = await Member.findOne({ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null, isDeleted: false, ...branchFilter(req.user) })
    .select(`${KYC_PROJECTION} ${PARTY_PHOTOS} ${HISTORY_PHOTOS}`)
    .populate(POPULATE);
  if (!m) throw new HttpError(404, 'Member not found');

  const keys = KYC_DOCS.filter((d) => pathOf(m, d.key) && !(d.key.startsWith('nominee.') && m.nominee?.sameAsGuarantor)).map((d) => d.key);
  const docs = docStates(m, keys);
  const kyc = kycSummary(m, keys);

  const logs = await AuditLog.find({ entity: 'Member', entityId: String(m._id) }).sort({ createdAt: -1 }).limit(100);
  const timeline = logs
    .filter((l) => TIMELINE_LABELS[l.action])
    .map((l) => {
      const a = l.after || {};
      const detail = [a.document ? `Document: ${a.document}` : '', a.reason ? `Reason: ${a.reason}` : ''].filter(Boolean).join(' · ');
      return { at: l.createdAt, label: TIMELINE_LABELS[l.action], by: l.actorEmail || '', detail };
    });

  const base = present(m, req.user, { detail: true });
  res.json({
    member: base,
    kyc: { status: kyc.status, total: kyc.total, approved: kyc.approved, rejected: kyc.rejected, pending: kyc.pending, documents: docs },
    blockHistory: (m.blockHistory || [])
      .map((b) => ({ action: b.action, reason: b.reason, at: b.at, byCode: b.byCode || '' }))
      .reverse(),
    timeline,
  });
}

// Employees (with staff IDs) that can be chosen on the forms for a branch.
export async function employeeOptions(req, res) {
  const branch = mongoose.isValidObjectId(req.query.branch) ? req.query.branch : null;
  if (!branch) return res.json({ items: [], me: await staffId(req.user) });
  if (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === String(branch))) {
    throw new HttpError(403, 'You can only use branches assigned to you');
  }
  const users = await User.find({
    isActive: true,
    employeeCode: { $exists: true },
    $or: [{ branches: branch }, { role: { $in: ['super_admin', 'admin'] } }],
  })
    .select('name employeeCode role')
    .sort({ employeeCode: 1 });
  res.json({
    items: users.map((u) => ({ code: u.employeeCode, name: u.name, role: u.role })),
    me: await staffId(req.user),
  });
}

// ---- lookups used by the registration form ------------------------------------------------------------------
export async function pincodeInfo(req, res) {
  const pin = String(req.params.pin || '');
  if (!PINCODE_RE.test(pin)) throw new HttpError(422, 'Enter a valid 6-digit pincode');
  res.json(await lookupPincode(pin));
}

export async function ifscInfo(req, res) {
  const code = String(req.params.code || '').toUpperCase();
  if (!IFSC_RE.test(code)) throw new HttpError(422, 'Enter a valid IFSC code (e.g. SBIN0001234)');
  res.json(await lookupIfsc(code));
}

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
import { takeVerified } from '../services/otpChallenges.js';
import { checkPanFormat, verifyPan, verifyBankAccount } from '../services/kycVerify.js';
import { AuditLog } from '../models/AuditLog.js';
import { Group } from '../models/Group.js';
import { LoanRequisition } from '../models/LoanRequisition.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { CivilCheck } from '../models/CivilCheck.js';
import { missingDetails } from '../utils/memberDetails.js';

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
    area: m.area || '',
    aadhaar: full && detail ? m.aadhaar : maskAadhaar(m.aadhaar),
    pan: m.pan ? (full && detail ? m.pan : maskPan(m.pan)) : '',
    employeeCode: m.employeeCode || '',
    hasGuarantor: Boolean(m.guarantor?.name),
    hasNominee: Boolean(m.nominee?.name),
    legacyImport: Boolean(m.legacyImport),
    isActive: m.isActive,
    isBlocked: Boolean(m.isBlocked),
    blockReason: m.isBlocked ? (m.blockHistory || []).filter((b) => b.action === 'block').slice(-1)[0]?.reason || '' : '',
    createdAt: m.createdAt,
  };
  if (detail) {
    Object.assign(out, {
      // details a member imported from the old system still has to complete (they stay required)
      missingDetails: missingDetails(m).map(({ key, label }) => ({ key, label })),
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
      accountNumber: full ? m.accountNumber : m.accountNumber ? `XXXXX${m.accountNumber.slice(-4)}` : '',
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
/** A mobile number can be registered to one member only. */
async function assertMobileFree(mobile, exceptId, v) {
  if (!MOBILE_RE.test(mobile || '')) return;
  const taken = await Member.findOne({ mobile, isDeleted: false, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select('code name');
  if (taken) v.add('mobile', `This mobile number is already registered to member ${taken.code}. Use a different number.`);
}

export async function sendOtp(req, res) {
  const b = req.body || {};
  const purpose = b.purpose === 'mobile' ? 'member_mobile' : null;
  const v = createValidator();
  if (!purpose) throw new HttpError(422, 'Invalid request');
  const mobile = asString(b.mobile);
  if (!MOBILE_RE.test(mobile)) v.add('mobile', 'Enter a valid 10-digit mobile number');
  const subject = mobile;
  // The mobile number of a member (registration / edit) must not be in use by another member.
  if (b.forMember === true && MOBILE_RE.test(mobile)) {
    const taken = await Member.findOne({ mobile, isDeleted: false, ...(mongoose.isValidObjectId(b.exceptMember) ? { _id: { $ne: b.exceptMember } } : {}) }).select('code name');
    if (taken) v.add('mobile', `This mobile number is already registered to member ${taken.code}. Use a different number.`);
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

const normName = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

// A district is fine when it is in our list for the state, or when it is the district the pincode itself belongs to.
function checkDistrict(d, pin, v) {
  const inList = (INDIA_LOCATIONS[d.state] || []).includes(d.district);
  if (inList) return;
  const fromPin = pin.status === 'ok' && normName(pin.postalDistrict) === normName(d.district);
  if (!fromPin) v.add('district', 'Select a district from the list for this state');
}

/** Validates the personal / contact / address / KYC / bank fields of a member (shared by create and update). */
function readMemberFields(b, v) {
  const d = {};
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
  d.area = asString(b.area).slice(0, 80);
  // The district must be in our list for the state, or (checked after the pincode lookup) the one the pincode belongs to.
  if (!INDIA_LOCATIONS[d.state]) v.add('state', 'Select a valid state');
  else if (!d.district || d.district.length > 60) v.add('district', 'Select the district');

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

  return d;
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

  Object.assign(d, readMemberFields(b, v));

  d.memberPhoto = readImage(b.memberPhoto, 'memberPhoto', 'Member photo', v, { required: true });
  d.aadhaarPhoto = readImage(b.aadhaarPhoto, 'aadhaarPhoto', 'Aadhaar photo', v, { required: true });
  d.signaturePhoto = readImage(b.signaturePhoto, 'signaturePhoto', 'Signature photo', v, { required: true });
  d.panPhoto = readImage(b.panPhoto, 'panPhoto', 'PAN photo', v, { required: Boolean(d.pan) });
  v.throwIfAny();

  // A mobile number belongs to one member only.
  await assertMobileFree(d.mobile, null, v);
  v.throwIfAny();

  // The mobile number must be verified with an OTP.
  const mobileCh = await takeVerified(b.mobileChallengeId, req.user, 'member_mobile', d.mobile);
  if (!mobileCh) v.add('mobile', 'Verify the mobile number with an OTP');
  v.throwIfAny();

  // Pincode and IFSC are checked against public data when it can be reached (never blocks on an outage).
  const pin = await lookupPincode(d.pincode);
  if (pin.status === 'invalid') v.add('pincode', 'This pincode does not exist');
  else if (pin.status === 'ok' && pin.stateKnown && pin.state !== d.state) v.add('state', `Pincode ${d.pincode} belongs to ${pin.state}`);
  checkDistrict(d, pin, v);
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
  } else if (/^\d{12}$/.test(text)) {
    // a complete Aadhaar number
    or.push({ aadhaar: text }, { 'guarantor.aadhaar': text });
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
  const own = [m.code, m.formId, m.name, m.mobile].some(has) || (/^\d{4}$/.test(text) && String(m.aadhaar || '').endsWith(text)) || (/^\d{12}$/.test(text) && m.aadhaar === text) || String(m.pan || '').toLowerCase().startsWith(text);
  if (own) return '';
  const g = m.guarantor;
  if (g?.name && (has(g.name) || has(g.mobile) || (/^\d{4}$/.test(text) && String(g.aadhaar || '').endsWith(text)) || (/^\d{12}$/.test(text) && g.aadhaar === text) || String(g.pan || '').toLowerCase().startsWith(text))) return 'guarantor';
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
  // Once a number has been verified with an OTP, only an admin may change or remove it.
  // (A different person replacing the old one — e.g. a new nominee — starts fresh.)
  if (existing?.mobile && existing.mobileVerifiedAt && existing.aadhaar === d.aadhaar && existing.mobile !== d.mobile && !isAdmin(req.user)) {
    throw new HttpError(403, 'The verified phone number can only be changed by an admin.', { mobile: 'Only an admin can change a verified phone number' });
  }
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

// A blocked member takes no part in any activity until unblocked.
function assertNotBlocked(m) {
  if (m.isBlocked) throw new HttpError(409, 'This member is blocked. Unblock the member before making any change.');
}

// An approved document is final: only an admin may replace it (or change the identity it belongs to).
function guardApproved(m, kind, old, incoming, user) {
  if (isAdmin(user)) return;
  const prefix = `${kind}.`;
  const approved = (m.kycDocs || []).filter((x) => x.key.startsWith(prefix) && x.status === 'approved').map((x) => x.key);
  if (!old) return;
  if (!approved.length && !(old.panVerifiedAt && (old.pan || '') !== (incoming.pan || ''))) return;
  const photoChanged = PARTY_FIELDS.some((f) => approved.includes(prefix + f) && (old[f] || '') !== (incoming[f] || ''));
  const identityChanged = old.name !== incoming.name || old.aadhaar !== incoming.aadhaar;
  // A PAN whose document is approved (or that was verified) is final too.
  const panLocked = (approved.includes(`${prefix}panPhoto`) || old.panVerifiedAt) && (old.pan || '') !== (incoming.pan || '');
  if (photoChanged || identityChanged || panLocked) {
    throw new HttpError(403, 'These documents are already approved. Only an admin can replace them.', {
      photo: 'Approved documents can only be changed by an admin',
    });
  }
}

// When one person is edited: unchanged, already-reviewed photos keep their review; new or replaced
// photos go back to the approval queue. A change of name / Aadhaar sends everything back.
function syncPartyKyc(m, prefix, old, person) {
  const identityChanged = !old || old.name !== person.name || old.aadhaar !== person.aadhaar;
  if (identityChanged) return resetKyc(m, prefix, person);
  const changed = new Set(PARTY_FIELDS.filter((f) => (old[f] || '') !== (person[f] || '')).map((f) => prefix + f));
  m.kycDocs = (m.kycDocs || []).filter((x) => !(x.key.startsWith(prefix) && changed.has(x.key)));
  const kept = (m.kycKeys || []).filter((k) => !k.startsWith(prefix));
  m.kycKeys = [...kept, ...PARTY_FIELDS.filter((f) => person[f]).map((f) => prefix + f)];
  return undefined;
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
    // Photos are loaded so approved documents can be told apart from changed ones.
    const m = await loadMemberFor(req, { photos: true });
    assertNotBlocked(m);
    // The guarantor can be added by the branch, but once saved only an admin may edit it.
    if (kind === 'guarantor' && m.guarantor?.name && !isAdmin(req.user)) {
      throw new HttpError(403, 'Only an admin can edit the guarantor.');
    }
    const old = m[kind]?.name ? m[kind].toObject() : null;
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
      guardApproved(m, kind, old, person, req.user);
    }
    const before = Boolean(m[kind]?.name);
    m[kind] = person;
    // The guarantor's documents are reviewed once; a copied nominee needs no second review.
    if (same) resetKyc(m, `${kind}.`, null);
    else syncPartyKyc(m, `${kind}.`, old, person);
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
  if (!isAdmin(req.user)) throw new HttpError(403, 'Only an admin can change the guarantor.');
  const m = await loadMemberFor(req, { photos: true });
  assertNotBlocked(m);
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
  if (!list.length) return { status: 'none', total: 0, approved: 0, rejected: 0, pending: 0, hasPending: false, hasRejected: false };
  const n = (st) => list.filter((d) => d.status === st).length;
  return {
    status: kycStatusOf(list),
    total: list.length,
    approved: n('approved'),
    rejected: n('rejected'),
    pending: n('pending'),
    hasPending: n('pending') > 0,
    hasRejected: n('rejected') > 0,
  };
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
  if (m.nominee?.sameAsGuarantor) parties.nominee = { status: 'same', total: 0, approved: 0, rejected: 0, pending: 0, hasPending: false, hasRejected: false };
  const changes = (m.guarantorHistory || []).map((h) => h.replacedAt).filter(Boolean);
  return {
    isBlocked: Boolean(m.isBlocked),
    guarantorChangedAt: changes.length ? new Date(Math.max(...changes.map((d) => new Date(d).getTime()))) : null,
    parties,
    id: m._id,
    code: m.code,
    formId: m.formId,
    name: m.name,
    mobile: m.mobile,
    branch: m.branch?._id ? { id: m.branch._id, code: m.branch.code, name: m.branch.name } : null,
    submittedAt: m.createdAt,
    status: kycStatusOf(docs),
    // A member is listed under Pending while any document waits, and under Rejected while any document
    // is rejected - so both can be true at once (e.g. 1 rejected and 4 pending).
    hasPending: count('pending') > 0,
    hasRejected: count('rejected') > 0,
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
    .select('name code formId mobile branch createdAt kycKeys kycDocs nominee.sameAsGuarantor guarantorHistory.replacedAt isBlocked')
    .populate(POPULATE)
    .sort({ createdAt: -1 });
  let rows = all.map((m) => kycSummary(m));
  const counts = {
    pending: rows.filter((r) => r.hasPending).length,
    rejected: rows.filter((r) => r.hasRejected).length,
    approved: rows.filter((r) => r.status === 'approved').length,
  };
  const matches = (r, st) => (st === 'pending' ? r.hasPending : st === 'rejected' ? r.hasRejected : r.status === 'approved');
  // Optionally look at one person only: borrower (member), guarantor or nominee.
  const party = asString(req.query.party);
  if (['member', 'guarantor', 'nominee'].includes(party)) {
    rows = rows.filter((r) => ['pending', 'rejected', 'approved'].includes(r.parties[party].status));
    if (['pending', 'rejected', 'approved'].includes(status)) {
      rows = rows.filter((r) => {
        const p = r.parties[party];
        return status === 'pending' ? p.hasPending : status === 'rejected' ? p.hasRejected : p.status === 'approved';
      });
    }
  } else if (['pending', 'rejected', 'approved'].includes(status)) rows = rows.filter((r) => matches(r, status));
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
  assertNotBlocked(m);
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
  assertNotBlocked(m);
  const key = asString(req.body?.key);
  if (!KYC_KEYS.has(key)) throw new HttpError(422, 'Unknown document');
  if (!(m.kycKeys || []).includes(key)) throw new HttpError(409, 'This document has not been uploaded');
  const rec = (m.kycDocs || []).find((x) => x.key === key);
  // An approved document is final: it is never uploaded again. Only rejected documents are re-uploaded.
  if (rec?.status === 'approved') throw new HttpError(409, 'This document is already approved and cannot be uploaded again.');
  // The branch can only upload a document again after it was rejected. Replacing a document that is
  // pending or approved is for an admin only.
  if (rec?.status !== 'rejected' && !isAdmin(req.user)) {
    throw new HttpError(403, rec?.status === 'approved'
      ? 'This document is already approved. Only an admin can replace it.'
      : 'Only a rejected document can be uploaded again. Replacing a photo is for an admin only.');
  }
  const v = createValidator();
  const image = readImage(req.body?.image, 'image', 'Document', v, { required: true });
  v.throwIfAny();

  m.set(key, image);
  const resubmitted = new Date();
  m.kycDocs = (m.kycDocs || []).filter((x) => x.key !== key);
  m.kycDocs.push({ key, status: 'pending', resubmittedAt: resubmitted });
  m.updatedBy = req.user._id;
  await m.save();
  await audit(req, { action: 'kyc.reupload', entity: 'Member', entityId: m._id, after: { code: m.code, document: key, previous: rec?.status || 'pending' } });
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
  'member.update': 'Details edited by admin',
  'member.block': 'Member blocked',
  'member.unblock': 'Member unblocked',
  'kyc.approve': 'Document approved',
  'kyc.reject': 'Document rejected',
  'kyc.reupload': 'Document uploaded again',
  'loanRequisition.create': 'Loan requisition made',
  'loanRequisition.topUp': 'Product loan added to a group loan',
};

async function memberGroups(memberId) {
  const groups = await Group.find({ 'members.member': memberId, isDeleted: false })
    .populate('members.addedBy', 'name employeeCode')
    .sort({ createdAt: 1 });
  return groups.map((g) => {
    const row = g.members.find((x) => String(x.member) === String(memberId));
    return {
      id: g._id,
      code: g.code,
      name: g.name,
      leaderName: g.leaderName,
      isActive: g.isActive,
      memberCount: g.members.length,
      addedAt: row?.addedAt || null,
      addedBy: row?.addedBy ? { name: row.addedBy.name, employeeCode: row.addedBy.employeeCode || '' } : null,
    };
  });
}

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
  // Loan requisitions of the member are part of the activity too.
  const loanIds = (await LoanRequisition.find({ isDeleted: false, $or: [{ member: m._id }, { members: m._id }] }).select('_id')).map((x) => String(x._id));
  const loanLogs = loanIds.length ? await AuditLog.find({ entity: 'LoanRequisition', entityId: { $in: loanIds } }).sort({ createdAt: -1 }).limit(100) : [];
  const timeline = [...logs, ...loanLogs]
    .sort((x, y) => y.createdAt - x.createdAt)
    .filter((l) => TIMELINE_LABELS[l.action])
    .map((l) => {
      const a = l.after || {};
      const detail = [
        a.document ? `Document: ${a.document}` : '',
        a.formId ? `Form ${a.formId}${a.scheme ? ` · ${a.scheme}` : ''}${a.amount ? ` · ₹${a.amount}` : ''}` : '',
        a.reason ? `Reason: ${a.reason}` : '',
        Array.isArray(a.changed) && a.changed.length ? `Changed: ${a.changed.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      return { at: l.createdAt, label: TIMELINE_LABELS[l.action], by: l.actorEmail || '', detail };
    });

  const base = present(m, req.user, { detail: true });
  // Every loan requisition of the member (own loans, product loans, and the group loans the member is part of).
  const reqs = await LoanRequisition.find({ isDeleted: false, $or: [{ member: m._id }, { members: m._id }] }).sort({ createdAt: -1 });
  // the Loan ID is given when the loan is paid out; until then the loan has only its form ID
  const paidLoanIds = new Map((await LoanPayment.find({ requisition: { $in: reqs.map((r) => r._id) }, status: 'paid' }).select('requisition loanId').lean()).map((p) => [String(p.requisition), p.loanId || '']));
  const loans = reqs.map((r) => {
    const mine = (r.additionalProducts || []).filter((a) => String(a.member) === String(m._id));
    return {
      id: r._id,
      loanId: paidLoanIds.get(String(r._id)) || '',
      formId: r.formId,
      kind: r.kind || 'personal',
      loanDate: r.loanDate,
      group: r.groupInfo?.code ? `${r.groupInfo.code} — ${r.groupInfo.name}` : '',
      scheme: `${r.schemeCode || ''} ${r.schemeName || ''}`.trim(),
      amount: r.amountPaise / 100,
      cash: r.cashPaise === undefined || r.cashPaise === null ? null : r.cashPaise / 100,
      mode: r.mode,
      term: r.term,
      emi: r.installmentPaise / 100,
      totalPayable: r.totalPayablePaise === undefined ? null : r.totalPayablePaise / 100,
      product: r.product?.name ? `${r.product.name} × ${r.product.quantity}` : '',
      productLoans: mine.map((a) => ({ product: `${a.product?.name} × ${a.product?.quantity}`, value: a.valuePaise / 100, emi: a.installmentPaise / 100 })),
      status: r.status,
      employeeCode: r.employeeCode,
    };
  });
  const civilChecks = (await CivilCheck.find({ member: m._id, isDeleted: false }).sort({ reportDate: -1, createdAt: -1 })).map((c) => ({
    score: c.score,
    bureau: c.bureau,
    reportDate: c.reportDate,
  }));
  res.json({
    member: base,
    loans,
    civilChecks,
    kyc: { status: kyc.status, total: kyc.total, approved: kyc.approved, rejected: kyc.rejected, pending: kyc.pending, documents: docs },
    blockHistory: (m.blockHistory || [])
      .map((b) => ({ action: b.action, reason: b.reason, at: b.at, byCode: b.byCode || '' }))
      .reverse(),
    timeline,
    // Every group the member belongs to, and when (and by whom) the member was added to it.
    groups: await memberGroups(m._id),
    // Every edit an admin made to the member's details, with what changed.
    editHistory: logs
      .filter((l) => l.action === 'member.update')
      .map((l) => ({
        at: l.createdAt,
        by: l.actorEmail || '',
        changes: Array.isArray(l.after?.changes) ? l.after.changes : (l.after?.changed || []).map((f) => ({ field: f, from: '', to: '' })),
      })),
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

// ---- edit all details (admin only) ---------------------------------------------------------------------------
const MEMBER_PHOTOS = [
  ['memberPhoto', 'Member photo', 'memberPhoto'],
  ['signaturePhoto', 'Signature photo', 'signaturePhoto'],
  ['aadhaarPhoto', 'Aadhaar photo', 'aadhaarPhoto'],
  ['panPhoto', 'PAN photo', 'panPhoto'],
];

/**
 * Changes any detail of a member. Only an admin may do this (enforced by the route).
 * The code, form ID, branch and joining date never change. A changed mobile number needs a new OTP;
 * replaced photos (or a change of name / Aadhaar) go back to KYC approval.
 */
export async function updateMember(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Member not found');
  const m = await Member.findOne({ _id: req.params.id, isDeleted: false }).select(KYC_PROJECTION);
  if (!m) throw new HttpError(404, 'Member not found');

  const b = req.body || {};
  const v = createValidator();
  const d = readMemberFields(b, v);

  // Photos: whatever is not sent stays as it is.
  const photos = {};
  for (const [key, label] of MEMBER_PHOTOS) {
    const sent = b[key];
    photos[key] = sent === undefined || sent === null || sent === ''
      ? m[key]
      : readImage(sent, key, label, v, { required: false });
  }
  if (d.pan && !photos.panPhoto) v.add('panPhoto', 'PAN photo is required when a PAN is given');
  if (d.aadhaar && m.guarantor?.aadhaar === d.aadhaar) v.add('aadhaar', 'This Aadhaar number belongs to the guarantor');
  v.throwIfAny();

  // A changed mobile number must be verified again.
  let mobileVerifiedAt = m.mobileVerifiedAt;
  let mobileCh = null;
  if (d.mobile !== m.mobile) {
    await assertMobileFree(d.mobile, m._id, v);
    v.throwIfAny();
    mobileCh = await takeVerified(b.mobileChallengeId, req.user, 'member_mobile', d.mobile);
    if (!mobileCh) throw new HttpError(422, 'Please correct the highlighted fields', { mobile: 'Verify the new mobile number with an OTP' });
    mobileVerifiedAt = mobileCh.verifiedAt;
  }

  // Pincode / IFSC / PAN are checked again only when they were changed.
  let pincodeVerified = m.pincodeVerified;
  if (d.pincode !== m.pincode || d.state !== m.state || d.district !== m.district) {
    const pin = await lookupPincode(d.pincode);
    if (pin.status === 'invalid') v.add('pincode', 'This pincode does not exist');
    else if (pin.status === 'ok' && pin.stateKnown && pin.state !== d.state) v.add('state', `Pincode ${d.pincode} belongs to ${pin.state}`);
    checkDistrict(d, pin, v);
    pincodeVerified = pin.status === 'ok';
  }
  let ifscVerified = m.ifscVerified;
  if (d.ifsc !== m.ifsc) {
    const bank = await lookupIfsc(d.ifsc);
    if (bank.status === 'invalid') v.add('ifsc', 'This IFSC code does not exist');
    ifscVerified = bank.status === 'ok';
  }
  v.throwIfAny();

  let panVerifiedAt = m.panVerifiedAt;
  if ((d.pan || '') !== (m.pan || '')) {
    const pc = d.pan ? await verifyPan(d.pan, d.name) : { status: 'unavailable' };
    if (pc.status === 'mismatch') throw new HttpError(422, 'Please correct the highlighted fields', { pan: 'The PAN does not belong to this person' });
    panVerifiedAt = pc.status === 'verified' ? new Date() : undefined;
  }
  let accountVerifiedAt = m.accountVerifiedAt;
  if (d.accountNumber !== m.accountNumber || d.ifsc !== m.ifsc) {
    const ac = await verifyBankAccount(d.accountNumber, d.ifsc, d.name);
    if (ac.status === 'mismatch') throw new HttpError(422, 'Please correct the highlighted fields', { accountNumber: 'The account does not match this person' });
    accountVerifiedAt = ac.status === 'verified' ? new Date() : undefined;
  }

  // Aadhaar / PAN stay unique.
  if (d.aadhaar !== m.aadhaar && (await Member.exists({ aadhaar: d.aadhaar, isDeleted: false, _id: { $ne: m._id } }))) {
    throw new HttpError(409, 'A member with this Aadhaar number already exists', { aadhaar: 'This Aadhaar number is already registered' });
  }
  if (d.pan && d.pan !== m.pan && (await Member.exists({ pan: d.pan, isDeleted: false, _id: { $ne: m._id } }))) {
    throw new HttpError(409, 'A member with this PAN already exists', { pan: 'This PAN is already registered' });
  }

  // What is changing (for the history and for KYC).
  const fields = ['name', 'husbandName', 'dob', 'gender', 'occupation', 'education', 'mobile', 'email', 'address', 'pincode', 'state', 'district', 'area', 'aadhaar', 'pan', 'bankName', 'ifsc', 'accountNumber'];
  const same = (a, c) => String(a instanceof Date ? a.toISOString().slice(0, 10) : a || '') === String(c instanceof Date ? c.toISOString().slice(0, 10) : c || '');
  const changedFields = fields.filter((f) => !same(m[f], d[f]));
  const changedPhotos = MEMBER_PHOTOS.map(([k]) => k).filter((k) => (m[k] || '') !== (photos[k] || ''));
  const identityChanged = changedFields.includes('name') || changedFields.includes('aadhaar');

  // A readable record of what was changed (identity numbers are masked, photos only say "replaced").
  const LABEL = { name: 'Name', husbandName: 'Husband name', dob: 'Date of birth', gender: 'Gender', occupation: 'Occupation', education: 'Education', mobile: 'Mobile', email: 'Email', address: 'Address', pincode: 'Pincode', state: 'State', district: 'District', area: 'Area', aadhaar: 'Aadhaar', pan: 'PAN', bankName: 'Bank name', ifsc: 'IFSC', accountNumber: 'Account number' };
  const show = (f, x) => {
    const val = x instanceof Date ? x.toISOString().slice(0, 10) : String(x ?? '');
    if (f === 'aadhaar') return val ? maskAadhaar(val) : '';
    if (f === 'pan') return val ? maskPan(val) : '';
    if (f === 'mobile') return val ? maskMobile(val) : '';
    if (f === 'accountNumber') return val ? `XXXXX${val.slice(-4)}` : '';
    return val;
  };
  const changes = [
    ...changedFields.map((f) => ({ field: LABEL[f] || f, from: show(f, m[f]), to: show(f, d[f]) })),
    ...changedPhotos.map((k) => ({ field: MEMBER_PHOTOS.find((p) => p[0] === k)[1], from: '', to: 'replaced' })),
  ];

  const before = { name: m.name, mobile: maskMobile(m.mobile), aadhaar: maskAadhaar(m.aadhaar), pan: maskPan(m.pan) };
  for (const f of fields) m[f] = d[f] === '' ? undefined : d[f];
  Object.assign(m, photos);
  m.mobileVerifiedAt = mobileVerifiedAt;
  m.pincodeVerified = pincodeVerified;
  m.ifscVerified = ifscVerified;
  m.panVerifiedAt = panVerifiedAt;
  m.accountVerifiedAt = accountVerifiedAt;
  m.updatedBy = req.user._id;

  // KYC: replaced photos (or a new identity) are reviewed again.
  const memberKeys = MEMBER_PHOTOS.map(([k]) => k);
  const reset = identityChanged ? memberKeys : changedPhotos;
  m.kycDocs = (m.kycDocs || []).filter((x) => !reset.includes(x.key));
  m.kycKeys = [...(m.kycKeys || []).filter((k) => !memberKeys.includes(k)), ...memberKeys.filter((k) => photos[k])];

  await m.save();
  if (mobileCh) await OtpChallenge.updateOne({ _id: mobileCh._id }, { $set: { consumedAt: new Date() } });
  await audit(req, {
    action: 'member.update',
    entity: 'Member',
    entityId: m._id,
    before,
    after: {
      code: m.code,
      changed: [...changedFields, ...changedPhotos],
      changes,
      name: m.name,
      mobile: maskMobile(m.mobile),
      aadhaar: maskAadhaar(m.aadhaar),
      pan: maskPan(m.pan),
    },
  });
  await m.populate(POPULATE);
  res.json({ member: present(m, req.user), changed: [...changedFields, ...changedPhotos] });
}

/**
 * A member imported from the old system comes without some details. The branch (staff) can fill in the ones that are missing; once a detail
 * is filled in only an admin can change it, and the rest can still be added later. The mobile number must be verified with an OTP, and after
 * that only an admin can change it. Until every required detail is there the member cannot be given a new loan.
 */
export async function completeMember(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Member not found');
  const m = await Member.findOne({ _id: req.params.id, isDeleted: false, ...branchFilter(req.user) }).select(KYC_PROJECTION);
  if (!m) throw new HttpError(404, 'Member not found');
  if (!m.legacyImport) throw new HttpError(409, 'Only a member imported from the old system is completed here. Other details are edited by an admin under Edit details.');
  assertNotBlocked(m);
  const b = req.body || {};
  const admin = isAdmin(req.user);
  const v = createValidator();
  const set = {};
  const given = (f) => asString(b[f]) !== '';
  const lockedErr = (label) => new HttpError(403, `${label} is already filled in. Only an admin can change it.`, { [label]: 'Only an admin can change it' });
  // a filled detail is changed only by an admin; the same value is just left as it is
  const take = (field, label, value) => {
    const had = String(m[field] ?? '').trim();
    if (had && had === String(value)) return;
    if (had && !admin) throw lockedErr(label);
    set[field] = value;
  };

  if (given('occupation')) { const x = asString(b.occupation); if (!OCCUPATIONS.includes(x)) v.add('occupation', 'Select occupation'); else take('occupation', 'Occupation', x); }
  if (given('education')) { const x = asString(b.education); if (!EDUCATIONS.includes(x)) v.add('education', 'Select education'); else take('education', 'Education', x); }
  if (given('address')) { const x = asString(b.address); if (x.length < 5 || x.length > 300) v.add('address', 'Address must be 5–300 characters'); else take('address', 'Address', x); }
  if (given('pincode')) { const x = asString(b.pincode); if (!PINCODE_RE.test(x)) v.add('pincode', 'Enter a valid 6-digit pincode'); else take('pincode', 'Pincode', x); }
  if (given('state')) { const x = asString(b.state); if (!INDIA_LOCATIONS[x]) v.add('state', 'Select a valid state'); else take('state', 'State', x); }
  if (given('district')) { const x = asString(b.district); if (!x || x.length > 60) v.add('district', 'Select the district'); else take('district', 'District', x); }
  if (given('area')) set.area = asString(b.area).slice(0, 80);
  if (given('aadhaar')) {
    const x = asString(b.aadhaar).replace(/\s/g, '');
    if (!AADHAAR_RE.test(x) || !verhoeff(x)) v.add('aadhaar', 'Enter a valid 12-digit Aadhaar number');
    else if (m.guarantor?.aadhaar === x) v.add('aadhaar', 'This Aadhaar number belongs to the guarantor');
    else {
      if (x !== m.aadhaar && (await Member.exists({ aadhaar: x, isDeleted: false, _id: { $ne: m._id } }))) throw new HttpError(409, 'A member with this Aadhaar number already exists', { aadhaar: 'This Aadhaar number is already registered' });
      take('aadhaar', 'Aadhaar number', x);
    }
  }
  if (given('bankName')) { const x = asString(b.bankName); if (x.length < 2 || x.length > 80) v.add('bankName', 'Enter the bank name'); else take('bankName', 'Bank name', x); }
  if (given('ifsc')) { const x = asString(b.ifsc).toUpperCase(); if (!IFSC_RE.test(x)) v.add('ifsc', 'Enter a valid IFSC code (e.g. SBIN0001234)'); else take('ifsc', 'IFSC code', x); }
  if (given('accountNumber')) { const x = asString(b.accountNumber); if (!ACCOUNT_RE.test(x)) v.add('accountNumber', 'Account number must be 9–18 digits'); else take('accountNumber', 'Account number', x); }

  // photos
  const photoSet = {};
  for (const [key, label] of MEMBER_PHOTOS) {
    if (!given(key)) continue;
    const img = readImage(b[key], key, label, v, { required: false });
    if (!img) continue;
    if (m[key] && m[key] !== img && !admin) throw lockedErr(label);
    photoSet[key] = img;
  }

  // the mobile number: verified with an OTP; once verified only an admin changes it
  let mobileCh = null;
  if (given('mobile')) {
    const x = asString(b.mobile);
    if (!MOBILE_RE.test(x)) v.add('mobile', 'Enter a valid 10-digit mobile number');
    else {
      const verified = Boolean(m.mobile && m.mobileVerifiedAt);
      if (verified && x !== m.mobile && !admin) throw lockedErr('Mobile number');
      if (!(verified && x === m.mobile)) {
        await assertMobileFree(x, m._id, v);
        if (!v.has()) {
          mobileCh = await takeVerified(b.mobileChallengeId, req.user, 'member_mobile', x);
          if (!mobileCh) v.add('mobile', 'Verify the mobile number with an OTP');
        }
        if (mobileCh) set.mobile = x;
      }
    }
  }
  v.throwIfAny();
  if (!Object.keys(set).length && !Object.keys(photoSet).length) throw new HttpError(422, 'Nothing to save: fill in at least one of the missing details', { form: 'Nothing to save' });

  // the pincode, state and district have to agree
  if (set.pincode || set.state || set.district) {
    const d = { pincode: set.pincode || m.pincode, state: set.state || m.state, district: set.district || m.district };
    if (d.pincode && d.district) {
      const pin = await lookupPincode(d.pincode);
      if (pin.status === 'invalid') v.add('pincode', 'This pincode does not exist');
      else if (pin.status === 'ok' && pin.stateKnown && pin.state !== d.state) v.add('state', `Pincode ${d.pincode} belongs to ${pin.state}`);
      checkDistrict(d, pin, v);
      v.throwIfAny();
      m.pincodeVerified = pin.status === 'ok';
    }
  }
  if (set.ifsc || set.accountNumber) {
    const ifsc = set.ifsc || m.ifsc; const acc = set.accountNumber || m.accountNumber;
    if (set.ifsc) {
      const bank = await lookupIfsc(ifsc);
      if (bank.status === 'invalid') throw new HttpError(422, 'Please correct the highlighted fields', { ifsc: 'This IFSC code does not exist' });
      m.ifscVerified = bank.status === 'ok';
    }
    if (ifsc && acc) {
      const ac = await verifyBankAccount(acc, ifsc, m.name);
      if (ac.status === 'mismatch') throw new HttpError(422, 'Please correct the highlighted fields', { accountNumber: 'The account does not match this person' });
      m.accountVerifiedAt = ac.status === 'verified' ? new Date() : undefined;
    }
  }

  const changed = [...Object.keys(set), ...Object.keys(photoSet)];
  Object.assign(m, set, photoSet);
  if (mobileCh) m.mobileVerifiedAt = mobileCh.verifiedAt;
  // new or replaced photos go to KYC approval
  const photoKeys = Object.keys(photoSet);
  if (photoKeys.length) {
    const memberKeys = MEMBER_PHOTOS.map(([k]) => k);
    m.kycDocs = (m.kycDocs || []).filter((x) => !photoKeys.includes(x.key));
    m.kycKeys = [...new Set([...(m.kycKeys || []).filter((k) => !memberKeys.includes(k) || photoKeys.includes(k) || m[k]), ...photoKeys])];
  }
  m.updatedBy = req.user._id;
  await m.save();
  if (mobileCh) await OtpChallenge.updateOne({ _id: mobileCh._id }, { $set: { consumedAt: new Date() } });
  await audit(req, { action: 'member.complete', entity: 'Member', entityId: m._id, after: { code: m.code, filled: changed, by: admin ? 'admin' : 'branch' } });
  const full = await Member.findById(m._id).select('+aadhaarPhoto +panPhoto +memberPhoto +signaturePhoto').populate(POPULATE);
  res.json({ member: present(full, req.user, { detail: true }), filled: changed });
}

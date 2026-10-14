import { Company } from '../models/Company.js';
import { INDIA_LOCATIONS } from '../data/indiaLocations.js';
import { asString, createValidator, parseDateOnly } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const PIN_RE = /^\d{6}$/;
const IMAGE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 400_000; // ~300 KB image

const present = (c) => ({
  id: c._id,
  name: c.name,
  cin: c.cin,
  pan: c.pan,
  tan: c.tan,
  incorporationDate: c.incorporationDate.toISOString().slice(0, 10),
  address: c.address,
  state: c.state || '',
  city: c.city || '',
  pincode: c.pincode || '',
  email: c.email,
  mobile: c.mobile,
  stampImage: c.stampImage || null,
  signatureImage: c.signatureImage || null,
  updatedAt: c.updatedAt,
});


// undefined = leave unchanged, null = remove, string = new image (PNG/JPEG data URL, ≤ ~300 KB).
function readImage(value, field, label, v) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !IMAGE_RE.test(value)) {
    v.add(field, `${label} must be a PNG or JPEG image`);
    return undefined;
  }
  if (value.length > MAX_IMAGE_CHARS) {
    v.add(field, `${label} image must be 300 KB or smaller`);
    return undefined;
  }
  return value;
}
export async function getCompany(_req, res) {
  const company = await Company.findOne({ singleton: 'company' });
  res.json({ company: company ? present(company) : null });
}

export async function saveCompany(req, res) {
  const b = req.body || {};
  const v = createValidator();

  const name = asString(b.name);
  const cin = asString(b.cin).toUpperCase();
  const pan = asString(b.pan).toUpperCase();
  const tan = asString(b.tan).toUpperCase();
  const address = asString(b.address);
  const state = asString(b.state);
  const city = asString(b.city);
  const pincode = asString(b.pincode);
  const email = asString(b.email).toLowerCase();
  const mobile = asString(b.mobile);
  const incorporationDate = parseDateOnly(b.incorporationDate);

  if (name.length < 2 || name.length > 150) v.add('name', 'Company name must be 2–150 characters');
  if (!CIN_RE.test(cin)) v.add('cin', 'Enter a valid 21-character CIN (e.g. U65999BR2020PTC012345)');
  if (!PAN_RE.test(pan)) v.add('pan', 'Enter a valid PAN (e.g. ABCDE1234F)');
  if (!TAN_RE.test(tan)) v.add('tan', 'Enter a valid TAN (e.g. ABCD12345E)');
  if (!incorporationDate) v.add('incorporationDate', 'Enter a valid date');
  else if (incorporationDate > new Date()) v.add('incorporationDate', 'Date of incorporation cannot be in the future');
  if (address.length < 5 || address.length > 300) v.add('address', 'Address must be 5–300 characters');
  if (state && !INDIA_LOCATIONS[state]) v.add('state', 'Select a valid state');
  if (city && city.length > 60) v.add('city', 'City is too long');
  if (pincode && !PIN_RE.test(pincode)) v.add('pincode', 'Pincode must be 6 digits');
  if (!EMAIL_RE.test(email)) v.add('email', 'Enter a valid email address');
  if (!MOBILE_RE.test(mobile)) v.add('mobile', 'Enter a valid 10-digit mobile number');

  const stampImage = readImage(b.stampImage, 'stampImage', 'Stamp', v);
  const signatureImage = readImage(b.signatureImage, 'signatureImage', 'Signature', v);
  v.throwIfAny();

  const existing = await Company.findOne({ singleton: 'company' });
  const before = existing ? existing.toObject() : undefined;

  const doc = existing || new Company();
  Object.assign(doc, { name, cin, pan, tan, incorporationDate, address, state, city, pincode, email, mobile });
  if (stampImage !== undefined) doc.stampImage = stampImage === null ? undefined : stampImage;
  if (signatureImage !== undefined) doc.signatureImage = signatureImage === null ? undefined : signatureImage;
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, {
    action: existing ? 'company.update' : 'company.create',
    entity: 'Company',
    entityId: doc._id,
    before,
    after: doc,
  });

  res.status(existing ? 200 : 201).json({ company: present(doc) });
}


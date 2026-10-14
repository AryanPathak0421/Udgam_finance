import { CodeSequence } from '../models/CodeSequence.js';
import { ensureDefaults, formatCode } from '../services/codeSequence.js';
import { asString, createValidator, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const PREFIX_RE = /^[A-Z0-9-]{1,10}$/;
const MAX_CUSTOM = 50;

const present = (s) => ({
  type: s.type,
  label: s.label,
  isSystem: s.isSystem,
  prefix: s.prefix,
  padding: s.padding,
  nextNumber: s.nextNumber,
  nextCode: formatCode(s, s.nextNumber),
  issued: s.issued || 0,
  updatedAt: s.updatedAt,
});

function readFields(b, { withLabel }) {
  const v = createValidator();
  const out = {
    prefix: asString(b.prefix).toUpperCase(),
    padding: Number(b.padding),
    nextNumber: Number(b.nextNumber),
  };
  if (withLabel) {
    out.label = asString(b.label);
    if (out.label.length < 2 || out.label.length > 40) v.add('label', 'Name must be 2–40 characters');
  }
  if (!PREFIX_RE.test(out.prefix)) v.add('prefix', 'Prefix must be 1–10 characters: letters, numbers or hyphen');
  if (!Number.isInteger(out.padding) || out.padding < 3 || out.padding > 10) v.add('padding', 'Number length must be between 3 and 10');
  if (!Number.isInteger(out.nextNumber) || out.nextNumber < 1) v.add('nextNumber', 'Next number must be a whole number of 1 or more');
  else if (Number.isInteger(out.padding) && String(out.nextNumber).length > out.padding) {
    v.add('nextNumber', 'Next number is longer than the number length');
  }
  v.throwIfAny();
  return out;
}

// Maps a duplicate-key error from the unique indexes to a field-level 409.
function duplicateError(err) {
  const key = Object.keys(err.keyPattern || {})[0];
  if (key === 'label') return new HttpError(409, 'A sequence with this name already exists', { label: 'This name is already in use' });
  if (key === 'type') return new HttpError(409, 'A sequence with this key already exists. Please try again.');
  return new HttpError(409, 'This prefix is already used by another sequence', { prefix: 'Choose a different prefix' });
}

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

export async function listSequences(_req, res) {
  await ensureDefaults();
  const items = await CodeSequence.find().sort({ isSystem: -1, createdAt: 1 });
  res.json({ items: items.map(present) });
}

export async function createSequence(req, res) {
  await ensureDefaults();
  const data = readFields(req.body || {}, { withLabel: true });

  if ((await CodeSequence.countDocuments({ isSystem: false })) >= MAX_CUSTOM) {
    throw new HttpError(409, `You can add up to ${MAX_CUSTOM} custom sequences`);
  }
  if (await CodeSequence.exists({ label: new RegExp(`^${data.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) {
    throw new HttpError(409, 'A sequence with this name already exists', { label: 'This name is already in use' });
  }
  // Prefixes must differ, otherwise two sequences could produce the same code.
  if (await CodeSequence.exists({ prefix: data.prefix })) {
    throw new HttpError(409, 'This prefix is already used by another sequence', { prefix: 'Choose a different prefix' });
  }

  const base = slugify(data.label) || 'sequence';
  let type = base;
  for (let n = 2; await CodeSequence.exists({ type }); n += 1) type = `${base}_${n}`;

  let seq;
  try {
    seq = await CodeSequence.create({ ...data, type, isSystem: false, issued: 0, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw duplicateError(err);
    throw err;
  }
  await audit(req, { action: 'codeSequence.create', entity: 'CodeSequence', entityId: type, after: seq });
  res.status(201).json({ item: present(seq) });
}

export async function updateSequence(req, res) {
  await ensureDefaults();
  const current = await CodeSequence.findOne({ type: req.params.type });
  if (!current) throw new HttpError(404, 'Code sequence not found');

  // System sequences keep their name; custom ones can be renamed.
  const data = readFields(req.body || {}, { withLabel: !current.isSystem });

  // Codes are never reused: the counter may only move forward.
  if (data.nextNumber < current.nextNumber) {
    throw new HttpError(409, 'Next number cannot be lower than the current value', {
      nextNumber: `Must be ${current.nextNumber} or higher (codes already issued cannot be reused)`,
    });
  }
  if (String(current.nextNumber).length > data.padding) {
    throw new HttpError(409, 'Number length is shorter than numbers already issued', { padding: 'Increase the number length' });
  }
  if (data.prefix !== current.prefix && (await CodeSequence.exists({ prefix: data.prefix, _id: { $ne: current._id } }))) {
    throw new HttpError(409, 'This prefix is already used by another sequence', { prefix: 'Choose a different prefix' });
  }

  const before = current.toObject();
  Object.assign(current, { ...data, updatedBy: req.user._id });
  try {
    await current.save();
  } catch (err) {
    if (err.code === 11000) throw duplicateError(err);
    throw err;
  }
  await audit(req, { action: 'codeSequence.update', entity: 'CodeSequence', entityId: current.type, before, after: current });
  res.json({ item: present(current) });
}

export async function deleteSequence(req, res) {
  const seq = await CodeSequence.findOne({ type: req.params.type });
  if (!seq) throw new HttpError(404, 'Code sequence not found');
  if (seq.isSystem) throw new HttpError(409, 'Built-in sequences cannot be deleted');
  if (seq.issued > 0) {
    throw new HttpError(409, `${seq.issued} code${seq.issued > 1 ? 's have' : ' has'} already been issued from this sequence, so it cannot be deleted`);
  }
  await seq.deleteOne();
  await audit(req, { action: 'codeSequence.delete', entity: 'CodeSequence', entityId: seq.type, before: seq });
  res.json({ message: 'Code sequence deleted' });
}

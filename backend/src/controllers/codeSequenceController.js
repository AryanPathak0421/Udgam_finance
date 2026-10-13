import { CodeSequence, SEQUENCE_TYPES } from '../models/CodeSequence.js';
import { ensureDefaults, formatCode } from '../services/codeSequence.js';
import { asString, createValidator, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const LABELS = { member: 'Member Code', loan: 'Loan ID', employee: 'Employee Code' };
const PREFIX_RE = /^[A-Z0-9-]{1,10}$/;

const present = (s) => ({
  type: s.type,
  label: LABELS[s.type],
  prefix: s.prefix,
  padding: s.padding,
  nextNumber: s.nextNumber,
  nextCode: formatCode(s, s.nextNumber),
  updatedAt: s.updatedAt,
});

export async function listSequences(_req, res) {
  await ensureDefaults();
  const items = await CodeSequence.find();
  items.sort((a, b) => SEQUENCE_TYPES.indexOf(a.type) - SEQUENCE_TYPES.indexOf(b.type));
  res.json({ items: items.map(present) });
}

export async function updateSequence(req, res) {
  const { type } = req.params;
  if (!SEQUENCE_TYPES.includes(type)) throw new HttpError(404, 'Code sequence not found');
  await ensureDefaults();

  const b = req.body || {};
  const v = createValidator();
  const prefix = asString(b.prefix).toUpperCase();
  const padding = Number(b.padding);
  const nextNumber = Number(b.nextNumber);
  if (!PREFIX_RE.test(prefix)) v.add('prefix', 'Prefix must be 1–10 characters: letters, numbers or hyphen');
  if (!Number.isInteger(padding) || padding < 3 || padding > 10) v.add('padding', 'Number length must be between 3 and 10');
  if (!Number.isInteger(nextNumber) || nextNumber < 1) v.add('nextNumber', 'Next number must be a whole number of 1 or more');
  else if (Number.isInteger(padding) && String(nextNumber).length > padding) v.add('nextNumber', 'Next number is longer than the number length');
  v.throwIfAny();

  const current = await CodeSequence.findOne({ type });
  // Codes are never reused: the counter may only move forward.
  if (nextNumber < current.nextNumber) {
    throw new HttpError(409, 'Next number cannot be lower than the current value', {
      nextNumber: `Must be ${current.nextNumber} or higher (codes already issued cannot be reused)`,
    });
  }
  if (String(current.nextNumber).length > padding) {
    throw new HttpError(409, 'Number length is shorter than numbers already issued', { padding: 'Increase the number length' });
  }

  const before = current.toObject();
  Object.assign(current, { prefix, padding, nextNumber, updatedBy: req.user._id });
  await current.save();
  await audit(req, { action: 'codeSequence.update', entity: 'CodeSequence', entityId: type, before, after: current });
  res.json({ item: present(current) });
}

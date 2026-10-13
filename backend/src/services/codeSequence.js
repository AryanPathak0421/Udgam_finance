import { CodeSequence } from '../models/CodeSequence.js';

export const SEQUENCE_DEFAULTS = {
  member: { prefix: 'MEM', padding: 6, nextNumber: 1 },
  loan: { prefix: 'LN', padding: 8, nextNumber: 1 },
  employee: { prefix: 'EMP', padding: 4, nextNumber: 1 },
};

export const formatCode = ({ prefix, padding }, n) => `${prefix}${String(n).padStart(padding, '0')}`;

export async function ensureDefaults() {
  await Promise.all(
    Object.entries(SEQUENCE_DEFAULTS).map(([type, d]) =>
      CodeSequence.updateOne({ type }, { $setOnInsert: { type, ...d } }, { upsert: true })
    )
  );
}

// Atomically reserves and returns the next code for a type (e.g. 'member' -> 'MEM000042').
// Modules creating members/loans/employees must call this, never compute codes themselves.
export async function generateCode(type) {
  await ensureDefaults();
  const seq = await CodeSequence.findOneAndUpdate({ type }, { $inc: { nextNumber: 1 } }, { new: false });
  if (!seq) throw new Error(`Unknown code sequence: ${type}`);
  return formatCode(seq, seq.nextNumber);
}

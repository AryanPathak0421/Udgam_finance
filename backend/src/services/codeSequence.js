import { CodeSequence } from '../models/CodeSequence.js';

export const SYSTEM_SEQUENCES = {
  member: { label: 'Member Code', prefix: 'MEM', padding: 6, nextNumber: 1 },
  loan: { label: 'Loan ID', prefix: 'LN', padding: 8, nextNumber: 1 },
  employee: { label: 'Employee Code', prefix: 'EMP', padding: 4, nextNumber: 1 },
  group: { label: 'Group Code', prefix: 'GRP', padding: 5, nextNumber: 1 },
  form: { label: 'Form ID', prefix: 'FRM', padding: 6, nextNumber: 1 },
  loanRequisition: { label: 'Loan Requisition Form ID', prefix: 'LRQ', padding: 6, nextNumber: 1 },
  stockProduct: { label: 'Stock Product Code', prefix: 'PRD', padding: 5, nextNumber: 1 },
};

export const formatCode = ({ prefix, padding }, n) => `${prefix}${String(n).padStart(padding, '0')}`;

// Makes sure the built-in sequences exist and are flagged as system sequences.
export async function ensureDefaults() {
  await Promise.all(
    Object.entries(SYSTEM_SEQUENCES).map(async ([type, d]) => {
      try {
        await CodeSequence.updateOne(
          { type },
          {
            $setOnInsert: { type, prefix: d.prefix, padding: d.padding, nextNumber: d.nextNumber, issued: 0 },
            $set: { label: d.label, isSystem: true },
          },
          { upsert: true }
        );
      } catch (err) {
        // Two requests racing to create the same default: the other one won, that's fine.
        if (err.code !== 11000) throw err;
      }
    })
  );
}

// Atomically reserves and returns the next code for a sequence (e.g. 'member' -> 'MEM000042').
// Modules creating members/loans/employees/receipts must call this, never compute codes themselves.
export async function generateCode(type) {
  await ensureDefaults();
  const seq = await CodeSequence.findOneAndUpdate(
    { type },
    { $inc: { nextNumber: 1, issued: 1 } },
    { new: false }
  );
  if (!seq) throw new Error(`Unknown code sequence: ${type}`);
  return formatCode(seq, seq.nextNumber);
}


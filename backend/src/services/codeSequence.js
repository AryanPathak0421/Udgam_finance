import { CodeSequence } from '../models/CodeSequence.js';

export const SYSTEM_SEQUENCES = {
  member: { label: 'Member Code', prefix: 'MEM', padding: 6, nextNumber: 1 },
  loan: { label: 'Loan ID', prefix: 'LN', padding: 8, nextNumber: 1 },
  employee: { label: 'Employee Code', prefix: 'EMP', padding: 4, nextNumber: 1 },
  group: { label: 'Group Code', prefix: 'GRP', padding: 5, nextNumber: 1 },
  form: { label: 'Form ID', prefix: 'FRM', padding: 6, nextNumber: 1 },
  loanRequisition: { label: 'Loan Requisition Form ID', prefix: 'LRQ', padding: 6, nextNumber: 1 },
  stockProduct: { label: 'Stock Product Code', prefix: 'PRD', padding: 5, nextNumber: 1 },
  loanReceipt: { label: 'Loan Payment Receipt No', prefix: 'RCP', padding: 6, nextNumber: 1 },
  emiReceipt: { label: 'EMI Receipt No', prefix: 'EMR', padding: 6, nextNumber: 1 },
  settlementReceipt: { label: 'Settlement Receipt No', prefix: 'STL', padding: 6, nextNumber: 1 },
  securityWithdrawal: { label: 'Security Withdrawal No', prefix: 'SWD', padding: 6, nextNumber: 1 },
  stockTransfer: { label: 'Stock Transfer No', prefix: 'STF', padding: 5, nextNumber: 1 },
  productOrder: { label: 'Product Order No', prefix: 'ORD', padding: 5, nextNumber: 1 },
  centerSurvey: { label: 'Center Survey No', prefix: 'CS', padding: 5, nextNumber: 1 },
  paymentVoucher: { label: 'Payment Voucher No', prefix: 'PV', padding: 6, nextNumber: 1 },
  receiveVoucher: { label: 'Receive Voucher No', prefix: 'RV', padding: 6, nextNumber: 1 },
  bankDeposit: { label: 'Bank Deposit No', prefix: 'BD', padding: 6, nextNumber: 1 },
  bankWithdraw: { label: 'Bank Withdraw No', prefix: 'BW', padding: 6, nextNumber: 1 },
  branchTransfer: { label: 'Branch Transfer No', prefix: 'BT', padding: 6, nextNumber: 1 },
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


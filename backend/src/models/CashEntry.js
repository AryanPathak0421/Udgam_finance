import mongoose from 'mongoose';

export const ENTRY_SIDES = ['receive', 'payment'];
// Cashbook lines that are typed in by hand (everything else is worked out from loans, EMI, settlements and security).
export const ENTRY_CATEGORIES = {
  receive: ['cash_fund', 'npa_receive', 'voucher_receive'],
  payment: ['leader_commission', 'bank_deposit', 'cash_deposit', 'fund_transfer', 'staff_salary', 'other_payment'],
};
export const ENTRY_MODES = ['cash', 'bank', 'upi', 'cheque'];

// A cashbook entry made by hand: cash fund received, bank withdrawal, NPA recovery, voucher, bank / cash deposit, staff salary ...
// `branch` empty = head office.
const cashEntrySchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    date: { type: Date, required: true },
    side: { type: String, enum: ENTRY_SIDES, required: true },
    category: { type: String, required: true },
    amountPaise: { type: Number, required: true, min: 100 },
    mode: { type: String, enum: ENTRY_MODES, default: 'cash' },
    remark: { type: String, trim: true },
    enteredByCode: String,
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
cashEntrySchema.index({ branch: 1, date: -1 });

export const CashEntry = mongoose.model('CashEntry', cashEntrySchema);

import mongoose from 'mongoose';

export const ENTRY_SIDES = ['receive', 'payment'];
// Cashbook lines that are typed in by hand (everything else is worked out from loans, EMI, settlements and security).
export const ENTRY_CATEGORIES = {
  receive: ['cash_fund', 'npa_receive', 'voucher_receive'],
  payment: ['leader_commission', 'bank_deposit', 'cash_deposit', 'fund_transfer', 'staff_salary', 'other_payment'],
};
// Entries made under Accounts (voucher entries, bank deposit / withdraw, branch to branch transfer); the cashbook entries made by hand have no kind.
export const ENTRY_KINDS = ['payment_voucher', 'receive_voucher', 'bank_deposit', 'bank_withdraw', 'branch_transfer'];
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
    kind: { type: String, enum: ENTRY_KINDS },
    voucherNo: String,
    voucherPeriod: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher' }, // the voucher month (Voucher Master) the date falls in
    counterBranch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null }, // branch to branch transfer: the other branch
    transferId: { type: mongoose.Schema.Types.ObjectId }, // both legs of a transfer share it
    ledger: { type: mongoose.Schema.Types.ObjectId, ref: 'Ledger' }, // an entry made for a ledger of the Ledger master (category is then 'ledger')
    bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }, // Account detail: the bank account of a bank transfer
    remark: { type: String, trim: true },
    bill: { type: String, select: false }, // the bill / slip of a voucher or bank entry (optional): a PDF or an image as a data URL
    billName: String,
    hasBill: { type: Boolean, default: false },
    enteredByCode: String,
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
cashEntrySchema.index({ branch: 1, date: -1 });

export const CashEntry = mongoose.model('CashEntry', cashEntrySchema);

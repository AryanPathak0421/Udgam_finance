import mongoose from 'mongoose';

export const WITHDRAWAL_KINDS = ['withdraw', 'adjust'];
export const WITHDRAWAL_STATUS = ['pending', 'approved', 'rejected'];

// A borrower asks for (part of) the security amount kept from the loans: either paid back ("withdraw") or put
// against the EMI of a loan ("adjust"). It is only done once an admin approves it.
const securityWithdrawalSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    memberCode: { type: String, required: true },
    memberName: String,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    kind: { type: String, enum: WITHDRAWAL_KINDS, required: true },
    amountPaise: { type: Number, required: true, min: 100 },
    // withdraw: the interest earned on that security (10% a year, after each full year). The member gets amount + interest.
    interestPaise: { type: Number, default: 0 },
    // adjust: the loan whose EMI the security is put against
    loanPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment' },
    loanId: String,
    // withdraw: how it is paid back
    payMode: { type: String, enum: ['cash', 'bank', 'upi', 'cheque'] },
    reference: String,
    bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' }, // Account detail: the bank account of a bank transfer
    remark: String,
    status: { type: String, enum: WITHDRAWAL_STATUS, default: 'pending' },
    rejectReason: String,
    decidedAt: Date,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedByCode: String,
    // After the admin approves, an OTP goes to the member's phone; the security is paid back / put against the EMI only once it is
    // verified. (Requests made before this step have otpRequired unset and were done on approval.)
    otpRequired: { type: Boolean, default: false },
    otpChallenge: { type: mongoose.Schema.Types.ObjectId, ref: 'OtpChallenge' },
    otpSentAt: Date,
    otpVerifiedAt: Date,
    completedByCode: String,
    emiReceiptNo: String, // adjust: the EMI receipt that was made when the OTP was verified
    requestedByCode: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

securityWithdrawalSchema.index({ receiptNo: 1 }, { unique: true });
securityWithdrawalSchema.index({ member: 1, status: 1 });
securityWithdrawalSchema.index({ branch: 1, status: 1, createdAt: -1 });

export const SecurityWithdrawal = mongoose.model('SecurityWithdrawal', securityWithdrawalSchema);

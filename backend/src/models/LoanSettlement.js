import mongoose from 'mongoose';

// loan: closed early by paying what is left; death: closed because the borrower died; auto: every installment was paid, so the loan closes by itself
export const SETTLEMENT_KINDS = ['loan', 'death', 'auto'];

// The settlement of one borrower's loan: either closed early by paying what is left ("loan"), or closed because the
// borrower died ("death"). After it, no more EMI is due on that borrower's loan.
const loanSettlementSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: SETTLEMENT_KINDS, required: true },
    receiptNo: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    loanPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment', required: true },
    loanId: String,
    formId: String,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
    memberCode: { type: String, required: true },
    memberName: String,
    group: String,
    outstandingPaise: { type: Number, required: true }, // what was still to be paid when it was settled
    amountPaise: { type: Number, default: 0 }, // received at settlement
    waiverPaise: { type: Number, default: 0 }, // outstanding - received: given up (death settlement: all of it)
    payMode: { type: String, enum: ['cash', 'bank', 'upi', 'cheque'] },
    reference: String,
    settledOn: { type: Date, required: true },
    remark: String,
    // death settlement
    deathDate: Date,
    certificate: { type: String, select: false }, // death certificate (PDF or image)
    claimRef: String, // insurance claim reference
    verifier: { code: String, name: String }, // the employee who verified it
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    cancelReason: String,
    cancelledAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

loanSettlementSchema.index({ receiptNo: 1 }, { unique: true });
loanSettlementSchema.index({ loanPayment: 1, memberCode: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
loanSettlementSchema.index({ kind: 1, branch: 1, settledOn: -1 });

export const LoanSettlement = mongoose.model('LoanSettlement', loanSettlementSchema);

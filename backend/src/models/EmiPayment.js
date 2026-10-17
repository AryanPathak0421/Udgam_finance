import mongoose from 'mongoose';

export const EMI_TYPES = ['regular', 'advance'];

// One EMI collection: the installments of one borrower of a paid-out loan that were paid together.
const emiPaymentSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    loanPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment', required: true },
    loanId: String,
    formId: String,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    type: { type: String, enum: EMI_TYPES, required: true }, // regular = installments that are due, advance = ahead of the due date
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
    memberCode: { type: String, required: true },
    memberName: String,
    group: String,
    installments: [Number], // installment numbers paid
    items: [{ _id: false, no: Number, dueDate: Date, amountPaise: Number }],
    amountPaise: { type: Number, required: true, min: 1 },
    paidOn: { type: Date, required: true },
    payMode: { type: String, enum: ['cash', 'bank', 'upi', 'cheque'], required: true },
    reference: String,
    status: { type: String, enum: ['paid', 'cancelled'], default: 'paid' },
    cancelReason: String,
    cancelledAt: Date,
    employeeCode: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByCode: String,
  },
  { timestamps: true }
);

emiPaymentSchema.index({ receiptNo: 1 }, { unique: true });
// An installment of a borrower is paid once (a cancelled payment frees it).
emiPaymentSchema.index({ loanPayment: 1, memberCode: 1, installments: 1 }, { unique: true, partialFilterExpression: { status: 'paid' } });
emiPaymentSchema.index({ branch: 1, paidOn: -1 });

export const EmiPayment = mongoose.model('EmiPayment', emiPaymentSchema);

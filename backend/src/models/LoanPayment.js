import mongoose from 'mongoose';

export const PAYMENT_MODES = ['cash', 'bank', 'upi', 'cheque'];

// The payment (disbursement) of an approved loan. One per requisition. The deductions are copied here, so the
// receipt stays exactly as it was printed even if the scheme or the stock price changes later.
const loanPaymentSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    requisition: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanRequisition', required: true },
    formId: String,
    kind: String,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    group: { code: String, name: String },
    paidOn: { type: Date, required: true },
    emiStartDate: { type: Date, required: true }, // first installment
    emiEndDate: { type: Date, required: true }, // last installment
    installments: Number,
    modeLabel: String, // repayment mode (weekly, monthly ...)
    schemeName: String,
    annualRateBp: Number,
    installmentPaise: Number,
    payMode: { type: String, enum: PAYMENT_MODES, required: true },
    reference: String,
    // one line per borrower (a group loan has one per member)
    lines: [
      {
        _id: false,
        member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
        code: String,
        name: String,
        amountPaise: Number,
        processingFeePaise: Number,
        insuranceFeePaise: Number,
        securityPaise: Number,
        productPaise: Number,
        products: [{ _id: false, code: String, name: String, unitPricePaise: Number, quantity: Number }],
        cashPaise: Number, // balance paid in cash (negative = the borrower pays the difference)
      },
    ],
    totalAmountPaise: Number,
    totalCashPaise: Number,
    status: { type: String, enum: ['paid', 'cancelled'], default: 'paid' },
    cancelReason: String,
    cancelledAt: Date,
    employeeCode: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByCode: String,
  },
  { timestamps: true }
);

loanPaymentSchema.index({ receiptNo: 1 }, { unique: true });
loanPaymentSchema.index({ requisition: 1 }, { unique: true, partialFilterExpression: { status: 'paid' } });
loanPaymentSchema.index({ branch: 1, paidOn: -1 });

export const LoanPayment = mongoose.model('LoanPayment', loanPaymentSchema);

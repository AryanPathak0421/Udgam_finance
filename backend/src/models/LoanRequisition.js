import mongoose from 'mongoose';

export const REQUISITION_STATUS = ['pending', 'approved', 'rejected', 'cancelled'];

// A borrower's request for a loan under a scheme. Everything shown on the form is copied here,
// so the record stays exactly as it was submitted even if the borrower or scheme changes later.
const loanRequisitionSchema = new mongoose.Schema(
  {
    formId: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    loanDate: { type: Date, required: true },

    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    borrower: {
      code: String,
      name: String,
      dob: Date,
      age: Number,
      gender: String,
      address: String,
      pincode: String,
      district: String,
      state: String,
      mobile: String,
      guarantorName: String,
    },
    previousLoanPaise: { type: Number, default: 0 },

    scheme: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanScheme', required: true },
    schemeCode: String,
    schemeName: String,
    amountPaise: { type: Number, required: true, min: 100 },
    mode: { type: String, required: true },
    term: { type: Number, required: true, min: 1 },
    annualRateBp: { type: Number, required: true, min: 0 },
    calculationType: String,
    emiType: String,
    installmentPaise: { type: Number, required: true }, // EMI
    totalInterestPaise: Number,
    totalPayablePaise: Number,
    processingFeePaise: Number,

    employeeCode: { type: String, required: true },
    status: { type: String, enum: REQUISITION_STATUS, default: 'pending' },

    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

loanRequisitionSchema.index({ formId: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
loanRequisitionSchema.index({ member: 1, createdAt: -1 });
loanRequisitionSchema.index({ branch: 1, createdAt: -1 });

export const LoanRequisition = mongoose.model('LoanRequisition', loanRequisitionSchema);

import mongoose from 'mongoose';

export const REQUISITION_STATUS = ['pending', 'approved', 'rejected', 'cancelled'];
export const REQUISITION_KINDS = ['personal', 'group', 'business', 'product'];

// Extra details of a business / MSME loan.
const businessSchema = new mongoose.Schema(
  {
    loanType: { type: String, enum: ['business', 'msme'], required: true },
    businessName: String,
    gstNumber: String,
    udgamNumber: String,
    civilScore: Number,
    shopPhoto: { type: String, select: false },
    bankStatement: { type: String, select: false }, // PDF or image data URL
  },
  { _id: false }
);

// A request for a loan under a scheme. Everything shown on the form is copied here, so the
// record stays exactly as it was submitted even if the borrower, group or scheme changes later.
const loanRequisitionSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: REQUISITION_KINDS, default: 'personal' },
    formId: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    loanDate: { type: Date, required: true },

    // personal / business / product: one borrower
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
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

    // group: every member of the group gets a loan of `amountPaise`
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
    groupInfo: {
      code: String,
      name: String,
      leaderName: String,
      employeeCode: String,
      members: [{ _id: false, code: String, name: String }],
    },
    memberCount: Number,
    totalAmountPaise: Number,

    business: { type: businessSchema },

    scheme: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanScheme', required: true },
    schemeCode: String,
    schemeName: String,
    amountPaise: { type: Number, required: true, min: 100 }, // per borrower
    mode: { type: String, required: true },
    term: { type: Number, required: true, min: 1 },
    annualRateBp: { type: Number, required: true, min: 0 },
    calculationType: String,
    emiType: String,
    installmentPaise: { type: Number, required: true }, // EMI per borrower
    totalInterestPaise: Number,
    totalPayablePaise: Number,
    processingFeePaise: Number,
    insuranceFeePaise: Number, // the scheme's "cost" (insurance / other)
    securityAmountPaise: Number,
    securityType: String,

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
loanRequisitionSchema.index({ group: 1, createdAt: -1 });
loanRequisitionSchema.index({ branch: 1, createdAt: -1 });

export const LoanRequisition = mongoose.model('LoanRequisition', loanRequisitionSchema);

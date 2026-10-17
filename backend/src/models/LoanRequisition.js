import mongoose from 'mongoose';

export const REQUISITION_STATUS = ['pending', 'approved', 'rejected', 'cancelled'];
export const REQUISITION_KINDS = ['personal', 'group', 'business', 'product'];

// Extra details of a business / MSME loan.
const businessSchema = new mongoose.Schema(
  {
    loanType: { type: String, enum: ['business', 'msme'], required: true },
    businessName: String,
    gstNumber: String,
    gstStateCode: String,
    gstVerifiedAt: Date, // set only when the GST network confirmed the number
    udgamNumber: String,
    civilScore: Number,
    shopPhoto: { type: String, select: false },
    bankStatement: { type: String, select: false }, // PDF or image data URL
    itr: { type: String, select: false }, // income tax return (PDF or image)
    agreement: { type: String, select: false }, // shop / business agreement
    udyamCertificate: { type: String, select: false },
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
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Member' }], // group loan: the members who get the loan
    memberCount: Number,
    totalAmountPaise: Number,

    business: { type: businessSchema },

    // group loan: a product (goods) a member takes on top of the loan, up to a share of the loan
    additionalProducts: [
      {
        _id: false,
        member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
        memberCode: String,
        memberName: String,
        product: { code: String, name: String, unitPricePaise: Number, quantity: Number },
        valuePaise: Number,
        installmentPaise: Number,
        totalInterestPaise: Number,
        totalPayablePaise: Number,
      },
    ],

    // product loan: the stock product (a snapshot) and how many units
    product: {
      code: String,
      name: String,
      unitPricePaise: Number,
      quantity: Number,
    },

    // The borrower's latest civil check when the requisition was made.
    civilCheck: { score: Number, reportDate: Date, bureau: String },

    // Business / MSME: what was verified at requisition time (nothing is claimed that was not checked).
    verification: {
      panPresent: Boolean,
      panFormatOk: Boolean,
      panVerified: Boolean,
      aadhaarOtp: { type: String, enum: ['verified', 'not_available'] }, // UIDAI Aadhaar e-KYC
      aadhaarMatched: Boolean, // the Aadhaar number entered is the one on the member record
      otpVerifiedAt: Date, // OTP sent to the borrower's registered mobile was confirmed
    },

    // group loan: the filled-in application form of each member, front and back
    memberForms: [
      {
        _id: false,
        member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
        memberCode: String,
        front: { type: String, select: false },
        back: { type: String, select: false },
        topUp: Boolean, // the form of a product top-up added later
        addedAt: Date,
      },
    ],

    // The filled-in application form, front and back.
    formFrontPhoto: { type: String, select: false },
    formBackPhoto: { type: String, select: false },

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
    cashPaise: Number, // loan amount - security - processing fee - insurance fee (per borrower)
    securityType: String,

    employeeCode: { type: String, required: true },
    // Loan approval (branch manager / admin): who decided and when, the amount first asked for when it was edited,
    // and the reason of a rejection.
    requestedAmountPaise: Number,
    decidedAt: Date,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedByCode: String,
    rejectReason: String,
    disbursedAt: Date, // set when the loan has been paid out (Loan Payment)
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
loanRequisitionSchema.index({ members: 1 });
loanRequisitionSchema.index({ branch: 1, createdAt: -1 });

export const LoanRequisition = mongoose.model('LoanRequisition', loanRequisitionSchema);

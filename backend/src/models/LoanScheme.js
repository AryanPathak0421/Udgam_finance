import mongoose from 'mongoose';

export const LOAN_TYPES = ['group', 'personal', 'product', 'msme', 'business'];
// How a late fine is counted once the grace period is over.
export const FINE_COUNTING = ['per_day', 'per_month', 'one_time'];
export const ROUNDING_OPTIONS = [0, 1, 5, 10]; // rupees; 0 = exact installment amount
export const TERM_UNITS = ['days', 'weeks', 'months'];
export const SECURITY_TYPES = ['none', 'group_guarantee', 'guarantor', 'fixed_deposit', 'gold', 'property', 'vehicle'];
export const CHARGE_TYPES = ['percentage', 'fixed'];

const chargeSchema = new mongoose.Schema(
  {
    type: { type: String, enum: CHARGE_TYPES, required: true },
    // percentage -> basis points (1.5% = 150); fixed -> paise
    value: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// A loan product definition: the limits and charges a loan must satisfy.
const loanSchemeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    name: { type: String, required: true, trim: true },
    loanType: { type: String, enum: LOAN_TYPES, required: true },

    amountMinPaise: { type: Number, required: true, min: 100 },
    amountMaxPaise: { type: Number, required: true, min: 100 },

    termUnit: { type: String, enum: TERM_UNITS, required: true },
    termMin: { type: Number, required: true, min: 1 },
    termMax: { type: Number, required: true, min: 1 },

    ageMin: { type: Number, required: true, min: 18, max: 100 },
    ageMax: { type: Number, required: true, min: 18, max: 100 },

    roiMinBp: { type: Number, required: true, min: 0, max: 10000 }, // basis points p.a.
    roiMaxBp: { type: Number, required: true, min: 0, max: 10000 },

    modes: { type: [String], required: true, validate: (v) => Array.isArray(v) && v.length > 0 },
    calculationType: { type: String, enum: ['flat', 'reducing'], required: true },
    emiType: { type: String, enum: ['equal', 'equal_principal'], default: 'equal' },

    securityType: { type: String, enum: SECURITY_TYPES, default: 'none' },
    securityBp: { type: Number, default: 0, min: 0, max: 10000 }, // security amount as % of loan
    processingFee: { type: chargeSchema, required: true },
    cost: { type: chargeSchema, required: true },

    // Round every installment to a multiple of this many rupees (1 = whole rupee).
    installmentRounding: { type: Number, enum: ROUNDING_OPTIONS, default: 1 },

    // Late payment: no fine for `gracePeriodDays` after the due date; after that a fine
    // (percent of the overdue installment, or a fixed amount) is counted per day / month / once.
    gracePeriodDays: { type: Number, default: 0, min: 0, max: 365 },
    fine: {
      type: { type: String, enum: CHARGE_TYPES, default: 'fixed' },
      value: { type: Number, default: 0, min: 0 }, // bp for percentage, paise for fixed
      counting: { type: String, enum: FINE_COUNTING, default: 'per_day' },
    },

    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

loanSchemeSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
loanSchemeSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isDeleted: false } }
);

export const LoanScheme = mongoose.model('LoanScheme', loanSchemeSchema);

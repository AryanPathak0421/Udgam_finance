import mongoose from 'mongoose';
import { ALL_TYPES, BASES, UNITS, FREQUENCIES, LOAN_SCOPES, RATE_APPLIES } from '../config/commissionTypes.js';

export const COMMISSION_FOR = ALL_TYPES;
export const COMMISSION_TYPES = ['percentage', 'fixed'];

// One commission slab: what it is paid for, in which financial year, to which rank,
// over which target range, and how much.
const commissionSchema = new mongoose.Schema(
  {
    commissionFor: { type: String, enum: COMMISSION_FOR, required: true },
    financialYear: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialYear', required: true },
    rank: { type: mongoose.Schema.Types.ObjectId, ref: 'Rank' }, // empty = all ranks

    // What the value is applied to, and what the target range is measured in.
    basis: { type: String, enum: Object.keys(BASES) },
    targetUnit: { type: String, enum: Object.keys(UNITS) },
    // Whose activity is counted: own, the whole branch's, or supervised branches'.
    scope: { type: String, enum: LOAN_SCOPES, default: 'own' },
    // Reached a slab: its rate applies to all units counted, or only to the units inside it.
    rateAppliesTo: { type: String, enum: RATE_APPLIES, default: 'all' },

    // Target range, inclusive; either end may be empty (empty "from" = 0, empty "to" = no limit).
    // Amount unit: paise. Other units: a plain count. (Field names kept from the first version.)
    targetFromPaise: { type: Number, min: 0 },
    targetToPaise: { type: Number, min: 0 },
    // Nothing is paid until this much is reached (same unit as the target).
    minEligibilityValue: { type: Number, min: 0 },
    // Upper limit of what can be paid per frequency period.
    maxCommissionPaise: { type: Number, min: 1 },
    frequency: { type: String, enum: FREQUENCIES, default: 'monthly' },

    commissionType: { type: String, enum: COMMISSION_TYPES, required: true },
    // percentage -> basis points (2.5% = 250); fixed -> paise.
    commissionValue: { type: Number, required: true, min: 1 },

    // Group leader commission only: paid per disbursed loan per month, for durationMonths,
    // starting startDelayMonths after the disbursement month (1 = next month).
    durationMonths: { type: Number, min: 1, max: 36 },
    startDelayMonths: { type: Number, enum: [0, 1] },

    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

commissionSchema.index({ financialYear: 1, commissionFor: 1, isDeleted: 1 });

export const Commission = mongoose.model('Commission', commissionSchema);

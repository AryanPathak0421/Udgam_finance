import mongoose from 'mongoose';
import { ALL_TYPES } from '../config/commissionTypes.js';

export const COMMISSION_FOR = ALL_TYPES;
export const COMMISSION_TYPES = ['percentage', 'fixed'];

// One commission slab: what it is paid for, in which financial year, to which rank,
// over which target range, and how much.
const commissionSchema = new mongoose.Schema(
  {
    commissionFor: { type: String, enum: COMMISSION_FOR, required: true },
    financialYear: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialYear', required: true },
    rank: { type: mongoose.Schema.Types.ObjectId, ref: 'Rank' }, // empty = all ranks
    // Target range, inclusive; both empty = applies at any target. The unit depends on the
    // commission type (config/commissionTypes.js): paise for amount types, a plain count
    // for count types. (Field names kept from the first version.)
    targetFromPaise: { type: Number, min: 0 },
    targetToPaise: { type: Number, min: 0 },
    commissionType: { type: String, enum: COMMISSION_TYPES, required: true },
    // percentage -> basis points (2.5% = 250); fixed -> paise.
    commissionValue: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

commissionSchema.index({ financialYear: 1, commissionFor: 1, isDeleted: 1 });

export const Commission = mongoose.model('Commission', commissionSchema);

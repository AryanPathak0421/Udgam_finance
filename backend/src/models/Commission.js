import mongoose from 'mongoose';

export const COMMISSION_FOR = ['employee', 'group_leader'];
export const COMMISSION_TYPES = ['percentage', 'fixed'];

// One commission slab. Employee commission is target-wise (a slab per target range);
// group leader commission is per financial year.
const commissionSchema = new mongoose.Schema(
  {
    commissionFor: { type: String, enum: COMMISSION_FOR, required: true },
    financialYear: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialYear', required: true },
    rank: { type: mongoose.Schema.Types.ObjectId, ref: 'Rank' }, // employee only; empty = all ranks
    // Target range (paise, inclusive). Both empty = applies at any target.
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

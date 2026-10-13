import mongoose from 'mongoose';

const financialYearSchema = new mongoose.Schema(
  {
    financialYearId: { type: String, required: true, unique: true, immutable: true }, // e.g. FY2025-26
    name: { type: String, required: true }, // e.g. 2025-26
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Database-level guarantee: at most one active financial year.
financialYearSchema.index({ isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
financialYearSchema.index({ startDate: 1, endDate: 1 });

export const FinancialYear = mongoose.model('FinancialYear', financialYearSchema);

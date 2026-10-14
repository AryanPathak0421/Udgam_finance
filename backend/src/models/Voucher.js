import mongoose from 'mongoose';

// A voucher period: a named month with a from–to date window inside a financial year.
const voucherSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    financialYear: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialYear', required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// One voucher per month per financial year, and one name per financial year.
voucherSchema.index({ financialYear: 1, month: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
voucherSchema.index(
  { financialYear: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isDeleted: false } }
);

export const Voucher = mongoose.model('Voucher', voucherSchema);

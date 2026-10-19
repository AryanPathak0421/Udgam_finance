import mongoose from 'mongoose';

// The commission an employee earned for one period (a day, a week, a month or a financial year, as the Commission Master rule says),
// worked out from what the employee did (collections, loans, new members ...) and the rule slabs. Made by Commission Generate; making it
// again for the same month replaces it.
const entrySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    employeeCode: { type: String, required: true },
    employeeName: { type: String },
    rank: { type: mongoose.Schema.Types.ObjectId, ref: 'Rank' },
    branches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],

    commissionFor: { type: String, required: true },
    basis: { type: String },
    unit: { type: String },
    scope: { type: String },
    frequency: { type: String },

    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // the month it was generated for
    periodFrom: { type: Date, required: true },
    periodTo: { type: Date, required: true }, // exclusive
    periodLabel: { type: String },

    measure: { type: Number, required: true }, // what was achieved, in `unit` (a count, or paise)
    count: { type: Number, default: 0 },
    amountBasePaise: { type: Number, default: 0 },
    amountPaise: { type: Number, required: true, min: 1 },
    capped: { type: Boolean, default: false },
    breakdown: { type: [mongoose.Schema.Types.Mixed], default: [] },
    status: { type: String, enum: ['generated'], default: 'generated' },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

entrySchema.index({ employeeCode: 1, commissionFor: 1, scope: 1, basis: 1, periodFrom: 1, periodTo: 1 }, { unique: true });
entrySchema.index({ month: 1, employeeCode: 1 });

export const EmployeeCommission = mongoose.model('EmployeeCommission', entrySchema);

import mongoose from 'mongoose';

// Loans disbursed in a group in a month. This is the input of the group leader commission.
// Interim source: entered by hand until the Loans module posts disbursements itself.
const groupDisbursementSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // 'YYYY-MM'
    loans: { type: Number, required: true, min: 1, validate: Number.isInteger },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

groupDisbursementSchema.index({ group: 1, month: 1 }, { unique: true });

export const GroupDisbursement = mongoose.model('GroupDisbursement', groupDisbursementSchema);

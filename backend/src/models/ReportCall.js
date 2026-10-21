import mongoose from 'mongoose';

// "Call done" on a row of a report: the borrower (or member) of that row was called. One record per report row; calling again updates it.
const reportCallSchema = new mongoose.Schema(
  {
    report: { type: String, required: true },
    key: { type: String, required: true }, // identifies the row (loan + borrower, requisition, receipt, member)
    count: { type: Number, default: 1 },
    lastCalledAt: { type: Date, required: true },
    lastCalledByCode: String,
    lastCalledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String,
  },
  { timestamps: true }
);

reportCallSchema.index({ report: 1, key: 1 }, { unique: true });

export const ReportCall = mongoose.model('ReportCall', reportCallSchema);

import mongoose from 'mongoose';

// "Call done" on a row of a report: the borrower (or member) of that row was called. One record per report row; calling again updates it.
const reportCallSchema = new mongoose.Schema(
  {
    report: { type: String, required: true },
    key: { type: String, required: true }, // identifies the row (loan + borrower, requisition, receipt, member)
    date: { type: String, default: '' }, // YYYY-MM-DD: the date of the report the call was marked on (a call on one date is not a call on another)
    count: { type: Number, default: 1 },
    lastCalledAt: { type: Date, required: true },
    lastCalledByCode: String,
    lastCalledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String,
  },
  { timestamps: true }
);

reportCallSchema.index({ report: 1, key: 1, date: 1 }, { unique: true });

export const ReportCall = mongoose.model('ReportCall', reportCallSchema);
// the older index (report, key) allowed one call per row for ever: it is dropped and the one with the date is built
ReportCall.syncIndexes().catch((err) => console.error('ReportCall indexes', err.message));

import mongoose from 'mongoose';

// The notes and coins of the cash a branch holds at the end of a day.
export const DENOMINATIONS = [
  { key: 'n2000', label: '₹2000 note', value: 2000 },
  { key: 'n500', label: '₹500 note', value: 500 },
  { key: 'n200', label: '₹200 note', value: 200 },
  { key: 'n100', label: '₹100 note', value: 100 },
  { key: 'n50', label: '₹50 note', value: 50 },
  { key: 'n20', label: '₹20 note', value: 20 },
  { key: 'n10', label: '₹10 note', value: 10 },
  { key: 'c10', label: '₹10 coin', value: 10 },
  { key: 'c5', label: '₹5 coin', value: 5 },
  { key: 'c2', label: '₹2 coin', value: 2 },
  { key: 'c1', label: '₹1 coin', value: 1 },
];
// revoked: an approved day taken back by the admin; the branch is back on that date and makes the denomination again
export const CLOSE_STATUS = ['submitted', 'approved', 'rejected', 'revoked'];

// The day close of one branch for one date: the denomination (count of every note and coin) next to the cash closing of the Cashbook.
// The branch makes it; the day is closed from then on. Only when the admin approves it (and the two match) does the branch move on to the next date.
const dayCloseSchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    date: { type: Date, required: true },
    counts: { type: Map, of: Number, default: {} },
    denominationPaise: { type: Number, required: true },
    // the cash Cashbook of that day when the denomination was made
    openingPaise: { type: Number, default: 0 },
    receiptsPaise: { type: Number, default: 0 },
    paymentsPaise: { type: Number, default: 0 },
    closingPaise: { type: Number, required: true },
    differencePaise: { type: Number, required: true }, // denomination - cashbook closing
    status: { type: String, enum: CLOSE_STATUS, default: 'submitted' },
    remark: String,
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    submittedByCode: String,
    submittedAt: Date,
    decidedByCode: String,
    decidedAt: Date,
    rejectReason: String,
  },
  { timestamps: true }
);

dayCloseSchema.index({ branch: 1, date: 1 }, { unique: true });
dayCloseSchema.index({ status: 1, date: -1 });

export const DayClose = mongoose.model('DayClose', dayCloseSchema);

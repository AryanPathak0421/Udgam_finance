import mongoose from 'mongoose';

export const COMMISSION_STATUS = ['pending', 'deposited'];

// One month's commission for one group. Generated from the group's disbursements and the
// group leader rule; "deposited" can only be reached through OTP verification.
const entrySchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // payout month
    loans: { type: Number, required: true, min: 1 }, // loans earning commission this month
    perLoanPaise: { type: Number, min: 0 }, // empty when loans from different rules are mixed
    amountPaise: { type: Number, required: true, min: 1 },
    status: { type: String, enum: COMMISSION_STATUS, default: 'pending' },

    depositedAt: { type: Date },
    depositedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    depositedToMobile: { type: String }, // masked, for the audit trail

    // OTP state (never returned by the API). The OTP itself is stored only as a keyed hash.
    otpHash: { type: String, select: false },
    otpExpiresAt: { type: Date, select: false },
    otpAttempts: { type: Number, default: 0, select: false },
    otpSentCount: { type: Number, default: 0, select: false },
    otpWindowStart: { type: Date, select: false },
    otpLastSentAt: { type: Date, select: false },
    otpMobile: { type: String, select: false }, // the number the OTP was sent to
  },
  { timestamps: true }
);

entrySchema.index({ group: 1, month: 1 }, { unique: true });
entrySchema.index({ month: 1, status: 1 });

export const GroupLeaderCommission = mongoose.model('GroupLeaderCommission', entrySchema);

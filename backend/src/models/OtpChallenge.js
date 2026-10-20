import mongoose from 'mongoose';

// A one-time code sent to verify a value (a mobile number, or a PAN via the member's mobile).
const otpChallengeSchema = new mongoose.Schema(
  {
    purpose: { type: String, enum: ['member_mobile', 'member_pan', 'security_withdrawal', 'group_commission', 'civil_check'], required: true },
    subject: { type: String, required: true }, // the mobile number or PAN being verified
    sentTo: { type: String, required: true }, // mobile the code was sent to
    hash: { type: String, select: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    verifiedAt: { type: Date },
    consumedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now, expires: 3600 },
  },
  { versionKey: false }
);

export const OtpChallenge = mongoose.model('OtpChallenge', otpChallengeSchema);

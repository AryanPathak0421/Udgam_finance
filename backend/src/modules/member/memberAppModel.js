import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Member mPIN Authentication Schema
const memberMpinSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true, unique: true },
    memberCode: { type: String, required: true, uppercase: true, trim: true, unique: true },
    mobile: { type: String, required: true, trim: true },
    mpinHash: { type: String, required: true, select: false },
    failedAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

memberMpinSchema.methods.compareMpin = async function (enteredMpin) {
  return bcrypt.compare(String(enteredMpin), this.mpinHash);
};

memberMpinSchema.statics.hashMpin = async function (plainMpin) {
  return bcrypt.hash(String(plainMpin), 10);
};

export const MemberMpin = mongoose.model('MemberMpin', memberMpinSchema);

// Member Loan Requisition Request Schema
const memberLoanInquirySchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    memberCode: { type: String, required: true, uppercase: true },
    memberName: { type: String, required: true },
    mobile: { type: String, required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    loanType: { type: String, enum: ['group', 'personal', 'business', 'msme', 'product'], default: 'personal' },
    requestedAmountPaise: { type: Number, required: true, min: 100000 }, // min 1000 Rs
    purpose: { type: String, required: true, trim: true },
    tenureMonths: { type: Number, default: 12 },
    status: { type: String, enum: ['pending', 'reviewed', 'approved', 'rejected'], default: 'pending' },
    staffRemark: { type: String, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

memberLoanInquirySchema.index({ member: 1, createdAt: -1 });
memberLoanInquirySchema.index({ branch: 1, status: 1 });

export const MemberLoanInquiry = mongoose.model('MemberLoanInquiry', memberLoanInquirySchema);


import mongoose from 'mongoose';

const phoneUpdateRequestSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    memberCode: { type: String, required: true, uppercase: true, trim: true },
    memberName: { type: String, required: true, trim: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    targetType: { type: String, enum: ['member', 'guarantor'], required: true },
    oldNumber: { type: String, required: true, trim: true },
    newNumber: { type: String, required: true, trim: true },
    reason: { type: String, trim: true, default: '' },
    otpVerified: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedByCode: { type: String, default: '' },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedByCode: { type: String, default: '' },
    decidedAt: { type: Date },
    rejectReason: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

phoneUpdateRequestSchema.index({ member: 1, status: 1 });
phoneUpdateRequestSchema.index({ branch: 1, status: 1, createdAt: -1 });

export const PhoneUpdateRequest = mongoose.model('PhoneUpdateRequest', phoneUpdateRequestSchema);

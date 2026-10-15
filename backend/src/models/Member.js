import mongoose from 'mongoose';

// A borrower (member). Photos are stored as small PNG/JPEG data URLs.
const memberSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    formId: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    joiningDate: { type: Date, required: true },
    name: { type: String, required: true, trim: true },
    dob: { type: Date, required: true },
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    mobile: { type: String, required: true, trim: true },
    mobileVerifiedAt: { type: Date },
    email: { type: String, trim: true, lowercase: true },
    husbandName: { type: String, trim: true },
    occupation: { type: String, required: true, trim: true },
    education: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    pincode: { type: String, required: true },
    state: { type: String, required: true },
    district: { type: String, required: true },
    aadhaar: { type: String, required: true },
    pan: { type: String, uppercase: true, trim: true },
    panVerifiedAt: { type: Date },
    bankName: { type: String, required: true, trim: true },
    ifsc: { type: String, required: true, uppercase: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    aadhaarPhoto: { type: String, required: true, select: false },
    panPhoto: { type: String, select: false },
    memberPhoto: { type: String, required: true, select: false },
    signaturePhoto: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

const live = { isDeleted: false };
memberSchema.index({ code: 1 }, { unique: true, partialFilterExpression: live });
memberSchema.index({ formId: 1 }, { unique: true, partialFilterExpression: live });
memberSchema.index({ aadhaar: 1 }, { unique: true, partialFilterExpression: live });
memberSchema.index({ pan: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, pan: { $type: 'string' } } });
memberSchema.index({ branch: 1, createdAt: -1 });

export const Member = mongoose.model('Member', memberSchema);

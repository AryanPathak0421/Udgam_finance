import mongoose from 'mongoose';

// Guarantor / nominee of a member. Photos are small PNG/JPEG data URLs.
const personSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // The phone number is optional; when given it has to be verified with an OTP.
    mobile: { type: String, trim: true },
    mobileVerifiedAt: { type: Date },
    aadhaar: { type: String, required: true },
    pan: { type: String, uppercase: true, trim: true },
    panVerifiedAt: { type: Date },
    // Nominee only: ticked when the nominee is the guarantor (details are copied from the guarantor).
    sameAsGuarantor: { type: Boolean, default: false },
    // Photo of the member together with the guarantor / nominee (optional).
    jointPhoto: { type: String, select: false },
    photo: { type: String, required: true, select: false },
    signature: { type: String, required: true, select: false },
    aadhaarPhoto: { type: String, required: true, select: false },
    panPhoto: { type: String, select: false },
    employeeCode: { type: String },
    savedAt: { type: Date, default: Date.now },
    savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Guarantor only: recorded under Death Settlement. A member whose guarantor has died needs a new guarantor before a new loan.
    deceasedOn: { type: Date },
    deathCertificate: { type: String, select: false },
    deathRemark: { type: String },
    deathRecordedAt: { type: Date },
    deathRecordedByCode: { type: String },
  },
  { _id: false }
);

// A guarantor that was replaced, with when / by whom / why.
const historySchema = new mongoose.Schema(
  {
    name: String,
    mobile: String,
    mobileVerifiedAt: Date,
    aadhaar: String,
    pan: String,
    panVerifiedAt: Date,
    jointPhoto: { type: String, select: false },
    photo: { type: String, select: false },
    signature: { type: String, select: false },
    aadhaarPhoto: { type: String, select: false },
    panPhoto: { type: String, select: false },
    employeeCode: String,
    savedAt: Date,
    savedBy: mongoose.Schema.Types.ObjectId,
    replacedAt: { type: Date, required: true },
    replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    replacedByCode: String,
    reason: String,
  },
  { _id: false }
);

// Review state of one uploaded document (no record = pending).
const kycDocSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reason: String,
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedByCode: String,
    resubmittedAt: Date,
  },
  { _id: false }
);

// One block / unblock decision.
const blockSchema = new mongoose.Schema(
  {
    action: { type: String, enum: ['block', 'unblock'], required: true },
    reason: { type: String, required: true },
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byCode: String,
  },
  { _id: false }
);

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
    area: { type: String, trim: true }, // post office / locality, filled in from the pincode
    aadhaar: { type: String, required: true },
    pan: { type: String, uppercase: true, trim: true },
    panVerifiedAt: { type: Date },
    pincodeVerified: { type: Boolean, default: false },
    ifscVerified: { type: Boolean, default: false },
    accountVerifiedAt: { type: Date },
    bankName: { type: String, required: true, trim: true },
    ifsc: { type: String, required: true, uppercase: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    aadhaarPhoto: { type: String, required: true, select: false },
    panPhoto: { type: String, select: false },
    memberPhoto: { type: String, required: true, select: false },
    signaturePhoto: { type: String, required: true, select: false },
    // Staff ID of the user who registered the member.
    employeeCode: { type: String },
    guarantor: { type: personSchema },
    guarantorHistory: { type: [historySchema], default: [] },
    // Which documents exist (kept in step with the uploads) and how each was reviewed.
    kycKeys: { type: [String], default: [] },
    kycDocs: { type: [kycDocSchema], default: [] },
    nominee: { type: personSchema },
    // A blocked borrower is kept on record but must not be given new loans or services.
    isBlocked: { type: Boolean, default: false },
    blockHistory: { type: [blockSchema], default: [] },
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
// (a member of the old system may have no Aadhaar number yet: only a number that is there has to be unique)
memberSchema.index({ aadhaar: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, aadhaar: { $type: 'string' } } });
memberSchema.index({ pan: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, pan: { $type: 'string' } } });
memberSchema.index({ branch: 1, createdAt: -1 });

export const Member = mongoose.model('Member', memberSchema);

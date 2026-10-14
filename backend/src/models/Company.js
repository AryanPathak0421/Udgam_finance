import mongoose from 'mongoose';

// Singleton: exactly one document represents the primary company.
const companySchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'company', unique: true, immutable: true },
    name: { type: String, required: true, trim: true },
    cin: { type: String, required: true, uppercase: true, trim: true },
    pan: { type: String, required: true, uppercase: true, trim: true },
    tan: { type: String, required: true, uppercase: true, trim: true },
    incorporationDate: { type: Date, required: true },
    address: { type: String, required: true, trim: true },
    state: { type: String, trim: true },
    city: { type: String, trim: true },
    pincode: { type: String, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    stampImage: { type: String }, // data URL (png/jpeg), size-limited by the controller
    signatureImage: { type: String }, // authorised signatory signature, same rules as the stamp
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const Company = mongoose.model('Company', companySchema);

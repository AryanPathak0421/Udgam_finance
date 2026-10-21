import mongoose from 'mongoose';

// A staff member who may use the mobile app. The app signs in with the staff member's own login; what the staff member registers or collects in the
// app waits for approval (new members: Member Joining Approval, EMI: Loan EMI Collection Approval).
const appUserSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    employeeCode: { type: String, required: true, uppercase: true, trim: true },
    name: String,
    note: String, // for example the phone the app is installed on
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByCode: String,
    deactivatedAt: Date,
  },
  { timestamps: true }
);

appUserSchema.index({ user: 1 }, { unique: true });

export const AppUser = mongoose.model('AppUser', appUserSchema);

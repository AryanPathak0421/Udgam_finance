import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = [
  'super_admin',
  'admin',
  'branch_manager',
  'loan_officer',
  'field_officer',
  'collection_officer',
  'accountant',
  'viewer',
];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    mobile: { type: String, trim: true },
    // Staff ID (from the Employee Code sequence); stamped on the records this user creates.
    employeeCode: { type: String, trim: true, uppercase: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ROLES, default: 'viewer' },
    // Menu permissions are defined per rank (see Rank.menuPermissions).
    rank: { type: mongoose.Schema.Types.ObjectId, ref: 'Rank' },
    branches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    isActive: { type: Boolean, default: true },
    failedAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLoginAt: { type: Date },
    // Tokens issued before this moment are rejected (set on every password change).
    passwordChangedAt: { type: Date },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

userSchema.index({ rank: 1 });
userSchema.index({ employeeCode: 1 }, { unique: true, sparse: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

export const User = mongoose.model('User', userSchema);

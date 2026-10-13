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

const menuPermissionSchema = new mongoose.Schema(
  {
    menu: { type: String, required: true },
    view: { type: Boolean, default: false },
    add: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    mobile: { type: String, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ROLES, default: 'viewer' },
    rank: { type: mongoose.Schema.Types.ObjectId, ref: 'Rank' },
    branches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    // undefined = use role defaults; an array (even empty) = explicit menu whitelist.
    menuPermissions: { type: [menuPermissionSchema], default: undefined },
    isActive: { type: Boolean, default: true },
    failedAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLoginAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

userSchema.index({ rank: 1 });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

export const User = mongoose.model('User', userSchema);

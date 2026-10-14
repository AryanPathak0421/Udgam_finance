import mongoose from 'mongoose';

export const NATURES = ['asset', 'liability', 'income', 'expense'];

// A node in the chart of accounts. Ledgers sit under a group; groups can nest.
const accountGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nature: { type: String, enum: NATURES, required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountGroup' },
    isSystem: { type: Boolean, default: false }, // built-in: cannot be edited or deleted
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

accountGroupSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isDeleted: false } }
);
accountGroupSchema.index({ parent: 1 });

export const AccountGroup = mongoose.model('AccountGroup', accountGroupSchema);

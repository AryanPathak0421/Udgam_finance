import mongoose from 'mongoose';

const branchSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    openingDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Code must be unique among non-deleted branches.
branchSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
branchSchema.index({ state: 1, city: 1 });

export const Branch = mongoose.model('Branch', branchSchema);

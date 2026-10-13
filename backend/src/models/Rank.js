import mongoose from 'mongoose';

// A post/designation in the company hierarchy (level 1 = highest).
const rankSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    level: { type: Number, required: true, min: 1, max: 99 },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

rankSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
rankSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isDeleted: false } }
);

export const Rank = mongoose.model('Rank', rankSchema);

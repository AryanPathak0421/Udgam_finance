import mongoose from 'mongoose';

// A borrowing group (JLG). The leader is the person who earns the group leader commission.
const groupSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    name: { type: String, required: true, trim: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    leaderName: { type: String, required: true, trim: true },
    // OTPs go here. After a group is created only an Admin may change it (enforced in the API).
    leaderMobile: { type: String, required: true, trim: true },
    formationDate: { type: Date },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

groupSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
groupSchema.index(
  { branch: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isDeleted: false } }
);

export const Group = mongoose.model('Group', groupSchema);

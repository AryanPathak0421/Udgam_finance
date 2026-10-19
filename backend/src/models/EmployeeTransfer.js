import mongoose from 'mongoose';

// A transfer made from Group Master: groups or loans handed from one employee to another, or members moved from one group to another.
const transferSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['group', 'loan', 'member'], required: true },
    fromEmployee: { type: String }, // group / loan transfer
    toEmployee: { type: String },
    fromGroup: { type: String }, // member transfer: group codes
    toGroup: { type: String },
    items: [{ _id: false, id: String, label: String }], // what was moved, as it was named at the time
    count: { type: Number, required: true },
    loansMoved: { type: Number, default: 0 },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String },
  },
  { timestamps: true }
);

transferSchema.index({ createdAt: -1 });

export const EmployeeTransfer = mongoose.model('EmployeeTransfer', transferSchema);

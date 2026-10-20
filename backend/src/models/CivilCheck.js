import mongoose from 'mongoose';

export const BUREAUS = ['CIBIL', 'Equifax', 'Experian', 'CRIF High Mark', 'Other'];

// One civil (credit bureau) score check of a borrower. Checks are kept as a history; the newest counts.
const civilCheckSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    score: { type: Number, required: true, min: 300, max: 900 },
    reportDate: { type: Date, required: true },
    bureau: { type: String, enum: BUREAUS, default: 'CIBIL' },
    reportNumber: { type: String, trim: true },
    remark: { type: String, trim: true },
    employeeCode: { type: String },
    // The fee of this civil check (set by the admin); it shows on the receive side of the Cashbook.
    feePaise: { type: Number, default: 0, min: 0 },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

civilCheckSchema.index({ member: 1, reportDate: -1, createdAt: -1 });

export const CivilCheck = mongoose.model('CivilCheck', civilCheckSchema);

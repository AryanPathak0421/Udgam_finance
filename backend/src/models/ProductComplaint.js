import mongoose from 'mongoose';

export const COMPLAINT_STATUS = ['submitted', 'resolved', 'delivered'];

// A complaint about a product that was sold to a member (with a loan). The branch raises it with the bill; the admin resolves it;
// the branch then marks that the resolution (e.g. the replacement) has been delivered to the member.
const complaintSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
    memberCode: { type: String, required: true },
    memberName: { type: String },
    loanPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment', required: true },
    loanId: { type: String },
    product: { code: String, name: String, quantity: Number, unitPricePaise: Number },
    soldOn: { type: Date },
    billPhoto: { type: String, select: false }, // PNG / JPEG data URL
    remark: { type: String, trim: true },
    status: { type: String, enum: COMPLAINT_STATUS, default: 'submitted' },
    resolvedAt: Date,
    resolvedByCode: String,
    resolution: String,
    deliveredAt: Date,
    deliveredByCode: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByCode: String,
  },
  { timestamps: true }
);
complaintSchema.index({ branch: 1, status: 1, createdAt: -1 });
complaintSchema.index({ loanPayment: 1, memberCode: 1 });

export const ProductComplaint = mongoose.model('ProductComplaint', complaintSchema);

import mongoose from 'mongoose';

export const PAYMENT_MODES = ['cash', 'bank', 'upi', 'cheque'];

// A payment a branch made to head office against the products it bought (approved product orders).
const productPaymentSchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    amountPaise: { type: Number, required: true, min: 100 },
    paidOn: { type: Date, required: true },
    mode: { type: String, enum: PAYMENT_MODES, required: true },
    reference: String,
    note: String,
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByCode: String,
  },
  { timestamps: true }
);
productPaymentSchema.index({ branch: 1, paidOn: -1 });

export const ProductPayment = mongoose.model('ProductPayment', productPaymentSchema);

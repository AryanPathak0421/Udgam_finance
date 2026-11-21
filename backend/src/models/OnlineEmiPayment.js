import mongoose from 'mongoose';

// An EMI that a member pays online (Razorpay). created: the order is made; posted: the payment is confirmed and the EMI receipt is made;
// received: the money has come but the EMI could not be posted at once (for example a holiday): it waits in the EMI collection approval of the branch.
export const ONLINE_EMI_STATUS = ['created', 'posted', 'received', 'failed'];

const onlineEmiSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    memberCode: { type: String, required: true },
    loanPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment', required: true },
    loanId: String,
    amountPaise: { type: Number, required: true, min: 100 },
    orderId: { type: String, required: true },
    paymentId: String,
    status: { type: String, enum: ONLINE_EMI_STATUS, default: 'created' },
    receiptNo: String, // the EMI receipt (or the collection waiting for approval)
    note: String,
  },
  { timestamps: true }
);

onlineEmiSchema.index({ orderId: 1 }, { unique: true });
onlineEmiSchema.index({ paymentId: 1 }, { unique: true, sparse: true });
onlineEmiSchema.index({ member: 1, createdAt: -1 });

export const OnlineEmiPayment = mongoose.model('OnlineEmiPayment', onlineEmiSchema);

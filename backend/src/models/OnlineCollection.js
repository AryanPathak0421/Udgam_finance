import mongoose from 'mongoose';

/**
 * EMIs of members (one group, or any loans) that the staff collects with one Razorpay QR: the QR is for the total of the members chosen, and when it is
 * paid every member's EMI is made as an online (UPI) payment with the payment id. created: the QR is waiting; processing / done: the payment is received
 * and the EMIs are being / have been made. A member whose EMI could not be made at once (a holiday, a closed day, ...) waits as a collection in the
 * EMI collection approval of the branch: the money is never lost.
 */
const itemSchema = new mongoose.Schema(
  {
    loanPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment', required: true },
    loanId: String,
    memberCode: String,
    memberName: String,
    amountPaise: { type: Number, required: true, min: 100 },
    status: { type: String, enum: ['waiting', 'posted', 'pending', 'failed'], default: 'waiting' },
    receiptNo: String,
    note: String,
  },
  { _id: false }
);

const onlineCollectionSchema = new mongoose.Schema(
  {
    linkId: { type: String, required: true },
    shortUrl: String,
    paymentId: String,
    amountPaise: { type: Number, required: true, min: 100 },
    date: { type: Date, required: true }, // the day of the collection (the day the staff chose)
    collectedByCode: String,
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['created', 'processing', 'done'], default: 'created' },
    items: [itemSchema],
  },
  { timestamps: true }
);

onlineCollectionSchema.index({ linkId: 1 }, { unique: true });
onlineCollectionSchema.index({ paymentId: 1 }, { unique: true, sparse: true });

export const OnlineCollection = mongoose.model('OnlineCollection', onlineCollectionSchema);

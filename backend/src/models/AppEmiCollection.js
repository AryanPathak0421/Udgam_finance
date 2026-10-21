import mongoose from 'mongoose';

export const APP_EMI_STATUS = ['pending', 'approved', 'rejected'];

// EMI collected in the mobile app. It is only a request until it is approved: then it becomes a normal EMI receipt (and only then it counts anywhere).
const appEmiSchema = new mongoose.Schema(
  {
    loanPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'LoanPayment', required: true },
    loanId: String,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    memberCode: { type: String, required: true },
    memberName: String,
    group: String,
    amountPaise: { type: Number, required: true, min: 100 },
    collectedOn: { type: Date, required: true },
    type: { type: String, enum: ['regular', 'advance'] }, // when it was collected by number of installments
    installments: Number, // how many installments (count) it covers, when collected that way
    payMode: { type: String, enum: ['cash', 'bank', 'upi', 'cheque'], required: true },
    bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' },
    reference: String,
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    collectedByCode: String,
    status: { type: String, enum: APP_EMI_STATUS, default: 'pending' },
    decidedByCode: String,
    decidedAt: Date,
    rejectReason: String,
    receiptNo: String, // the EMI receipt made on approval
  },
  { timestamps: true }
);

appEmiSchema.index({ status: 1, createdAt: -1 });
appEmiSchema.index({ loanPayment: 1, memberCode: 1, status: 1 });
appEmiSchema.index({ branch: 1, status: 1 });

export const AppEmiCollection = mongoose.model('AppEmiCollection', appEmiSchema);

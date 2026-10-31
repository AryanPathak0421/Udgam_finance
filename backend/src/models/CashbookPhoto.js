import mongoose from 'mongoose';

const cashbookPhotoSchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    receivePhoto: { type: String, default: '' }, // side 1 (receive side)
    paymentPhoto: { type: String, default: '' }, // side 2 (payment side)
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByCode: { type: String, default: '' },
  },
  { timestamps: true }
);

cashbookPhotoSchema.index({ branch: 1, date: 1 }, { unique: true });

export const CashbookPhoto = mongoose.model('CashbookPhoto', cashbookPhotoSchema);

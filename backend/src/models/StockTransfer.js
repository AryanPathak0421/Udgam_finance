import mongoose from 'mongoose';

// The admin moves units of a product from one place to another (head office or a branch, e.g. BR01 -> BR02).
const stockTransferSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    fromBranch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }, // none = head office
    toBranch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    category: String,
    brand: String,
    model: String,
    variant: String,
    name: String,
    quantity: { type: Number, required: true, min: 1 },
    unitPricePaise: Number,
    remark: String,
    byCode: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
stockTransferSchema.index({ code: 1 }, { unique: true });
stockTransferSchema.index({ createdAt: -1 });

export const StockTransfer = mongoose.model('StockTransfer', stockTransferSchema);

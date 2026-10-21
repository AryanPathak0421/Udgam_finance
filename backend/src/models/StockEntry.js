import mongoose from 'mongoose';

// Stock received: units added to a product (head office or a branch), with the bill it came with. It raises the stock of the product; cancelling it takes the units out again.
const stockEntrySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'StockProduct', required: true },
    productCode: String,
    productName: String,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null }, // empty = head office
    quantity: { type: Number, required: true, min: 1 },
    stockBefore: Number,
    stockAfter: Number,
    purchaseRatePaise: Number,
    entryDate: { type: Date, required: true },
    supplier: String,
    billNo: String,
    remark: String,
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    cancelReason: String,
    byCode: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
stockEntrySchema.index({ code: 1 }, { unique: true });
stockEntrySchema.index({ product: 1, entryDate: -1 });
stockEntrySchema.index({ branch: 1, entryDate: -1 });

export const StockEntry = mongoose.model('StockEntry', stockEntrySchema);

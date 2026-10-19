import mongoose from 'mongoose';

export const ORDER_STATUS = ['pending', 'approved', 'rejected', 'cancelled'];

// A branch (the buyer) asks the admin for products from the head-office stock. The admin approves it and can
// change the quantities; on approval the approved units move from head office to the branch's stock.
const productOrderSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'StockProduct', required: true },
        category: String,
        brand: String,
        model: String,
        variant: String,
        name: String,
        unitPricePaise: Number,
        requestedQty: { type: Number, required: true, min: 1 },
        approvedQty: Number, // set by the admin when approving
        sourceBranch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }, // the branch the goods were taken from (none = head office)
      },
    ],
    note: String,
    status: { type: String, enum: ORDER_STATUS, default: 'pending' },
    rejectReason: String,
    decidedAt: Date,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedByCode: String,
    requestedByCode: String,
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

productOrderSchema.index({ code: 1 }, { unique: true });
productOrderSchema.index({ branch: 1, createdAt: -1 });
productOrderSchema.index({ status: 1, createdAt: -1 });

export const ProductOrder = mongoose.model('ProductOrder', productOrderSchema);

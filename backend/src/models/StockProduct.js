import mongoose from 'mongoose';

// A product in stock that a product loan can be taken for.
const stockProductSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    unitPricePaise: { type: Number, required: true, min: 100 },
    stockQty: { type: Number, required: true, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

stockProductSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
stockProductSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isDeleted: false } }
);

export const StockProduct = mongoose.model('StockProduct', stockProductSchema);

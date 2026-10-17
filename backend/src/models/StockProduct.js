import mongoose from 'mongoose';

// A product kept in stock. `branch` is the branch that holds the stock; no branch = head office (the admin's
// own stock, which the branches order from). Product loans are given from the stock of the requisition's branch.
const stockProductSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    category: { type: String, required: true, trim: true }, // e.g. Electronics, Furniture
    brand: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    variant: { type: String, trim: true, default: '' },
    name: { type: String, required: true, trim: true }, // brand + model + variant, kept for lists and loans
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    unitPricePaise: { type: Number, required: true, min: 100 }, // sale price
    stockQty: { type: Number, required: true, min: 0, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

stockProductSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
// The same product (category, brand, model, variant) is one entry per branch.
stockProductSchema.index(
  { branch: 1, category: 1, brand: 1, model: 1, variant: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isDeleted: false } }
);

export const StockProduct = mongoose.model('StockProduct', stockProductSchema);

import mongoose from 'mongoose';

export const BALANCE_TYPES = ['debit', 'credit'];

const ledgerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountGroup', required: true },
    // Side of the opening balance: debit (Dr) or credit (Cr).
    type: { type: String, enum: BALANCE_TYPES, required: true },
    openingDate: { type: Date, required: true },
    // Integer paise; never floats.
    openingAmountPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isSafeInteger, message: 'Opening amount must be a whole number of paise' },
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

ledgerSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isDeleted: false } }
);
ledgerSchema.index({ group: 1, isDeleted: 1 });

export const Ledger = mongoose.model('Ledger', ledgerSchema);

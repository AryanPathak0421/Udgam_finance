import mongoose from 'mongoose';

const bankAccountSchema = new mongoose.Schema(
  {
    accountHolderName: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    ifsc: { type: String, uppercase: true, trim: true },
    address: { type: String, required: true, trim: true },
    // Money is stored as integer paise (never floats). The API exposes rupees.
    openingAmountPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isSafeInteger, message: 'Opening amount must be a whole number of paise' },
    },
    openDate: { type: Date, required: true },
    branches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

bankAccountSchema.index(
  { bankName: 1, accountNumber: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isDeleted: false } }
);

export const BankAccount = mongoose.model('BankAccount', bankAccountSchema);

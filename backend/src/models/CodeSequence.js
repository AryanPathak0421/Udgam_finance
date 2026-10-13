import mongoose from 'mongoose';

export const SEQUENCE_TYPES = ['member', 'loan', 'employee'];

const codeSequenceSchema = new mongoose.Schema(
  {
    type: { type: String, enum: SEQUENCE_TYPES, required: true, unique: true, immutable: true },
    prefix: { type: String, required: true, uppercase: true, trim: true },
    padding: { type: Number, required: true, min: 3, max: 10 },
    nextNumber: { type: Number, required: true, min: 1 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const CodeSequence = mongoose.model('CodeSequence', codeSequenceSchema);

import mongoose from 'mongoose';

// Numbering scheme for generated codes (member code, loan ID, employee code, plus
// any custom sequences the admin adds, e.g. receipt no.).
const codeSequenceSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, unique: true, immutable: true }, // slug key
    label: { type: String, required: true, trim: true },
    isSystem: { type: Boolean, default: false }, // built-in: cannot be deleted
    prefix: { type: String, required: true, uppercase: true, trim: true },
    padding: { type: Number, required: true, min: 3, max: 10 },
    nextNumber: { type: Number, required: true, min: 1 },
    issued: { type: Number, default: 0 }, // codes handed out so far
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Two sequences must never share a prefix (they could issue identical codes) or a name.
// Enforced by the database so concurrent requests cannot slip past the app-level check.
codeSequenceSchema.index({ prefix: 1 }, { unique: true });
codeSequenceSchema.index(
  { label: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { label: { $type: 'string' } } }
);

export const CodeSequence = mongoose.model('CodeSequence', codeSequenceSchema);

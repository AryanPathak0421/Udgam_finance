import mongoose from 'mongoose';

// One menu grant: which page, and what the holder may do there.
export const menuPermissionSchema = new mongoose.Schema(
  {
    menu: { type: String, required: true },
    view: { type: Boolean, default: false },
    add: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
  },
  { _id: false }
);

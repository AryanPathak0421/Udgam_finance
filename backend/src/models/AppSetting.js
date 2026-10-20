import mongoose from 'mongoose';

// Small settings an admin sets once (key -> value), e.g. the fee of one civil check.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const AppSetting = mongoose.model('AppSetting', settingSchema);

export const CIVIL_FEE_KEY = 'civilCheckFeePaise';
export async function civilFeePaise() {
  const s = await AppSetting.findOne({ key: CIVIL_FEE_KEY });
  return Number.isInteger(s?.value) && s.value > 0 ? s.value : 0;
}

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

export const SMS_CONFIG_KEY = 'smsGatewayConfig';

export const DEFAULT_SMS_CONFIG = {
  provider: process.env.SMS_PROVIDER || 'jdsms',
  apiKey: process.env.SMS_API_KEY || '',
  senderId: process.env.SMS_SENDER_ID || 'UDGAMF',
  peId: process.env.SMS_PE_ID || '1701171990575365167',
  routeId: process.env.SMS_ROUTE_ID || '7',
  campaign: process.env.SMS_CAMPAIGN || '4',
  url: process.env.SMS_API_URL || 'https://jdsms.co.in/app/smsapi/index.php',
};

export async function getSmsConfig() {
  try {
    const s = await AppSetting.findOne({ key: SMS_CONFIG_KEY });
    if (!s?.value) return { ...DEFAULT_SMS_CONFIG };
    return {
      ...DEFAULT_SMS_CONFIG,
      ...s.value,
      provider: s.value.provider || 'jdsms',
      apiKey: s.value.apiKey || DEFAULT_SMS_CONFIG.apiKey,
      senderId: s.value.senderId || DEFAULT_SMS_CONFIG.senderId,
      peId: s.value.peId || DEFAULT_SMS_CONFIG.peId,
      routeId: s.value.routeId || DEFAULT_SMS_CONFIG.routeId,
      campaign: s.value.campaign || DEFAULT_SMS_CONFIG.campaign,
      url: s.value.url || DEFAULT_SMS_CONFIG.url,
    };
  } catch {
    return { ...DEFAULT_SMS_CONFIG };
  }
}

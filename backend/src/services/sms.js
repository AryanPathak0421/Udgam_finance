import { HttpError } from '../utils/http.js';
import { getSmsConfig, DEFAULT_SMS_CONFIG } from '../models/AppSetting.js';

/**
 * Approved DLT Templates for UDGAM URBAN AND GRAMIN MICROFINANCE
 * Entity ID (pe_id): 1701171990575365167
 * Sender ID: UDGAMF
 */
export const DLT_TEMPLATES = {
  // 1. Mobile number verification OTP
  MOBILE_OTP: {
    id: '1707175068319936045',
    name: 'Mobile number verification otp',
    format: (p) => `Dear customer your OTP is ${p.otp || ''} for mobile number verification. UDGAM URBAN and GRAMIN MICROFINANCE`,
  },

  // 2. Loan Approval (Hindi)
  LOAN_APPROVAL_HI: {
    id: '1707174807452064093',
    name: 'LOAN APPROVAL (Hindi)',
    format: (p) => `प्रिय ${p.name || 'ऋणधारक'},हमें यह बताते हुए खुशी हो रही है कि आपका ${p.amount || ''} का ऋण राशि उदगम माइक्रोफ़ाइनेंस के द्वारा स्वीकृत किया गया है.कृपया अपने नजदीकी साखा पे जाए और ऋण प्राप्त करें.`,
  },

  // 3. Civil Check SMS (Hindi)
  CIVIL_CHECK_SMS_HI: {
    id: '1707174807407154047',
    name: 'CIVIL CHECK SMS (Hindi)',
    format: (p) => `प्रिय ${p.name || 'ग्राहक'} उद्गम माइक्रोफाइनेंस के तरफ से आपका क्रेडिट स्कोर जाँच करने के लिए आपका ओटीपी ${p.otp || ''} है।`,
  },

  // 4. Holiday SMS (Hindi)
  HOLIDAY_HI: {
    id: '1707173270319350947',
    name: 'Holiday SMS (Hindi)',
    format: (p) => `प्रिय ग्राहक, उदगम माइक्रोफाइनेंस से जुड़े रहने के लिए आपका धन्यवाद। ${p.occasion || 'पर्व'} के शुभ अवसर पर बैंक ${p.fromDate || p.from || p.date || ''} से ${p.toDate || p.to || ''} तक बंद रहेगा। इन दिनों आपको किसी भी तरह के किश्त का भुगतान नहीं करना है। अधिक जानकारी या सिकायत के लिए - 1800-203-3364`,
  },

  // 5. Holiday SMS (English)
  HOLIDAY_EN: {
    id: '1707173270238284989',
    name: 'Holiday SMS (English)',
    format: (p) => `Dear Valuable Customers, We would like to inform you that our office will remain closed on ${p.date || p.fromDate || ''} for ${p.occasion || 'Holiday'}. UDGAM URBAN AND GRAMIN MICRO FINANCE`,
  },

  // 6. Forget password OTP
  FORGET_PASSWORD_OTP: {
    id: '1707171991583986254',
    name: 'Forget password OTP',
    format: (p) => `Dear ${p.name || 'User'}, your OTP is ${p.otp || ''} for Change password. UDGAM URBAN AND GRAMIN MICRO`,
  },

  // 7. Cibil OTP
  CIBIL_OTP: {
    id: '1707171991576132830',
    name: 'Cibil OTP',
    format: (p) => `Dear ${p.name || 'Customer'}, your OTP is ${p.otp || ''} for CREDIT SCORE Check. UDGAM URBAN AND GRAMIN MICRO`,
  },

  // 8. Loan settle
  LOAN_SETTLE: {
    id: '1707171991571825057',
    name: 'Loan settle',
    format: (p) => `Dear borrower, Your Loan Account ${p.loanId || ''} was successfully settled with Amount Rs. ${p.amount || ''}. UDGAM URBAN AND GRAMIN MICRO`,
  },

  // 9. EMI Collect
  EMI_COLLECT: {
    id: '1707171991568653270',
    name: 'EMI Collect',
    format: (p) => `Dear borrower, Your loan EMI of Rs. ${p.amount || ''} has been successfully received against your loan id ${p.loanId || ''}. UDGAM URBAN AND GRAMIN MICRO`,
  },

  // 10. Loan Disburse
  LOAN_DISBURSE: {
    id: '1707171991564592048',
    name: 'Loan Disburse',
    format: (p) => `Dear borrower, Your loan Amount of Rs. ${p.amount || ''} has been successfully disbursed against Loan ID ${p.loanId || ''}. UDGAM URBAN AND GRAMIN MICRO`,
  },

  // 11. Loan Approval
  LOAN_APPROVAL: {
    id: '1707171991560568327',
    name: 'Loan Approval',
    format: (p) => `Dear borrower, Your loan Amount of Rs. ${p.amount || ''} has been approved. Your Loan ID is ${p.loanId || ''}. UDGAM URBAN AND GRAMIN MICRO`,
  },

  // 12. Loan Requisition
  LOAN_REQUISITION: {
    id: '1707171991556474139',
    name: 'Loan Requisition',
    format: (p) => `Dear borrower, Your requisition for Loan Amount of Rs. ${p.amount || ''} has been received against Loan ID ${p.loanId || ''}. UDGAM URBAN AND GRAMIN MICRO`,
  },

  // 13. New collector
  NEW_COLLECTOR: {
    id: '1707171991552957976',
    name: 'New collector',
    format: (p) => `Dear ${p.name || 'Collector'}, Your requisition for collector has been successfully accepted. Your Collector Code is ${p.code || p.collectorCode || ''}. UDGAM URBAN AND GRAMIN MICRO`,
  },

  // 14. New member
  NEW_MEMBER: {
    id: '1707171991549583948',
    name: 'New member',
    format: (p) => `Dear ${p.name || 'Member'}, You have successfully joined as a borrower in UDGAM URBAN AND GRAMIN MICRO. Your borrower id is ${p.memberId || p.borrowerId || p.code || ''}`,
  },
};

/**
 * Resolves a DLT template ID and formats exact matching text according to carrier approvals.
 */
export function resolveDltTemplate(p) {
  const type = String(p.type || '').toLowerCase();
  const rawText = String(p.text || '');
  const otp = p.otp || (rawText.match(/\b\d{4,6}\b/) || [])[0] || '';

  // 1. Explicit template ID given
  if (p.templateId) {
    const entry = Object.values(DLT_TEMPLATES).find((t) => t.id === p.templateId);
    if (entry) {
      return { templateId: entry.id, text: entry.format({ ...p, otp }) };
    }
    return { templateId: p.templateId, text: rawText };
  }

  // 2. Type based resolution
  if (type === 'cibil' || type === 'cibil_otp') {
    return { templateId: DLT_TEMPLATES.CIBIL_OTP.id, text: DLT_TEMPLATES.CIBIL_OTP.format({ ...p, otp }) };
  }
  if (type === 'cibil_hi' || type === 'cibil_otp_hi') {
    return { templateId: DLT_TEMPLATES.CIVIL_CHECK_SMS_HI.id, text: DLT_TEMPLATES.CIVIL_CHECK_SMS_HI.format({ ...p, otp }) };
  }
  if (type === 'password' || type === 'reset_otp' || type === 'password_otp' || type === 'mpin_reset') {
    return { templateId: DLT_TEMPLATES.FORGET_PASSWORD_OTP.id, text: DLT_TEMPLATES.FORGET_PASSWORD_OTP.format({ ...p, otp }) };
  }
  if (type === 'emi' || type === 'emi_collect') {
    return { templateId: DLT_TEMPLATES.EMI_COLLECT.id, text: DLT_TEMPLATES.EMI_COLLECT.format(p) };
  }
  if (type === 'disburse' || type === 'loan_disburse') {
    return { templateId: DLT_TEMPLATES.LOAN_DISBURSE.id, text: DLT_TEMPLATES.LOAN_DISBURSE.format(p) };
  }
  if (type === 'approval' || type === 'loan_approval') {
    return { templateId: DLT_TEMPLATES.LOAN_APPROVAL.id, text: DLT_TEMPLATES.LOAN_APPROVAL.format(p) };
  }
  if (type === 'approval_hi' || type === 'loan_approval_hi') {
    return { templateId: DLT_TEMPLATES.LOAN_APPROVAL_HI.id, text: DLT_TEMPLATES.LOAN_APPROVAL_HI.format(p) };
  }
  if (type === 'requisition' || type === 'loan_requisition') {
    return { templateId: DLT_TEMPLATES.LOAN_REQUISITION.id, text: DLT_TEMPLATES.LOAN_REQUISITION.format(p) };
  }
  if (type === 'settle' || type === 'loan_settle') {
    return { templateId: DLT_TEMPLATES.LOAN_SETTLE.id, text: DLT_TEMPLATES.LOAN_SETTLE.format(p) };
  }
  if (type === 'collector' || type === 'new_collector') {
    return { templateId: DLT_TEMPLATES.NEW_COLLECTOR.id, text: DLT_TEMPLATES.NEW_COLLECTOR.format(p) };
  }
  if (type === 'member' || type === 'new_member') {
    return { templateId: DLT_TEMPLATES.NEW_MEMBER.id, text: DLT_TEMPLATES.NEW_MEMBER.format(p) };
  }
  if (type === 'holiday') {
    return { templateId: DLT_TEMPLATES.HOLIDAY_EN.id, text: DLT_TEMPLATES.HOLIDAY_EN.format(p) };
  }
  if (type === 'holiday_hi') {
    return { templateId: DLT_TEMPLATES.HOLIDAY_HI.id, text: DLT_TEMPLATES.HOLIDAY_HI.format(p) };
  }

  // 3. Heuristic content analysis from text
  const lower = rawText.toLowerCase();
  if (lower.includes('credit score') || lower.includes('cibil')) {
    return { templateId: DLT_TEMPLATES.CIBIL_OTP.id, text: DLT_TEMPLATES.CIBIL_OTP.format({ ...p, otp }) };
  }
  if (rawText.includes('क्रेडिट स्कोर')) {
    return { templateId: DLT_TEMPLATES.CIVIL_CHECK_SMS_HI.id, text: DLT_TEMPLATES.CIVIL_CHECK_SMS_HI.format({ ...p, otp }) };
  }
  if (lower.includes('password') || lower.includes('mpin')) {
    return { templateId: DLT_TEMPLATES.FORGET_PASSWORD_OTP.id, text: DLT_TEMPLATES.FORGET_PASSWORD_OTP.format({ ...p, otp }) };
  }
  if (lower.includes('emi') && (lower.includes('received') || lower.includes('collected'))) {
    return { templateId: DLT_TEMPLATES.EMI_COLLECT.id, text: DLT_TEMPLATES.EMI_COLLECT.format(p) };
  }
  if (lower.includes('disbursed') || lower.includes('disbursement')) {
    return { templateId: DLT_TEMPLATES.LOAN_DISBURSE.id, text: DLT_TEMPLATES.LOAN_DISBURSE.format(p) };
  }
  if (lower.includes('approved') || lower.includes('approval')) {
    return { templateId: DLT_TEMPLATES.LOAN_APPROVAL.id, text: DLT_TEMPLATES.LOAN_APPROVAL.format(p) };
  }
  if (lower.includes('requisition')) {
    return { templateId: DLT_TEMPLATES.LOAN_REQUISITION.id, text: DLT_TEMPLATES.LOAN_REQUISITION.format(p) };
  }
  if (lower.includes('settle')) {
    return { templateId: DLT_TEMPLATES.LOAN_SETTLE.id, text: DLT_TEMPLATES.LOAN_SETTLE.format(p) };
  }
  if (lower.includes('collector') && (lower.includes('accepted') || lower.includes('code'))) {
    return { templateId: DLT_TEMPLATES.NEW_COLLECTOR.id, text: DLT_TEMPLATES.NEW_COLLECTOR.format(p) };
  }
  if (lower.includes('joined as a borrower') || lower.includes('borrower id')) {
    return { templateId: DLT_TEMPLATES.NEW_MEMBER.id, text: DLT_TEMPLATES.NEW_MEMBER.format(p) };
  }
  if (lower.includes('remain closed') || lower.includes('closed on')) {
    return { templateId: DLT_TEMPLATES.HOLIDAY_EN.id, text: DLT_TEMPLATES.HOLIDAY_EN.format(p) };
  }
  if (rawText.includes('बंद रहेगा')) {
    return { templateId: DLT_TEMPLATES.HOLIDAY_HI.id, text: DLT_TEMPLATES.HOLIDAY_HI.format(p) };
  }

  // 4. Default for any numeric OTP -> Mobile number verification OTP
  if (otp) {
    return { templateId: DLT_TEMPLATES.MOBILE_OTP.id, text: DLT_TEMPLATES.MOBILE_OTP.format({ ...p, otp }) };
  }

  // Fallback to raw text without template
  return { templateId: '', text: rawText };
}

/**
 * Dispatches SMS directly to JDSMS HTTP API.
 */
export async function dispatchJdsms({ to, text, templateId, apiKey, senderId, peId, routeId, campaign, url }) {
  const cleanTo = String(to || '').replace(/\D/g, '').slice(-10);
  const endpoint = url || 'https://jdsms.co.in/app/smsapi/index.php';
  const postKey = apiKey || DEFAULT_SMS_CONFIG.apiKey;
  const postSender = senderId || DEFAULT_SMS_CONFIG.senderId;
  const postPeId = peId || DEFAULT_SMS_CONFIG.peId;
  const postRouteId = String(routeId || DEFAULT_SMS_CONFIG.routeId);
  const postCampaign = String(campaign || DEFAULT_SMS_CONFIG.campaign);

  const params = new URLSearchParams();
  params.append('key', postKey);
  params.append('campaign', postCampaign);
  params.append('routeid', postRouteId);
  params.append('type', 'text');
  params.append('contacts', cleanTo);
  params.append('senderid', postSender);
  params.append('msg', text);
  if (templateId) params.append('template_id', templateId);
  if (postPeId) params.append('pe_id', postPeId);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const responseText = (await res.text()).trim();
    const shootMatch = responseText.match(/<sms_shoot_id>(.*?)<\/sms_shoot_id>/i) || responseText.match(/SMS-SHOOT-ID\/(.+)/i);
    const errMatch = responseText.match(/<err>(.*?)<\/err>/i) || (responseText.startsWith('ERR') ? [null, responseText] : null);

    if (shootMatch && shootMatch[1]) {
      console.log(`[sendSms:JDSMS] Success! Shoot ID: ${shootMatch[1]} sent to ${cleanTo}`);
      return { sent: true, shootId: shootMatch[1], response: responseText, dev: false, provider: 'jdsms' };
    }

    if (errMatch && errMatch[1]) {
      console.warn(`[sendSms:JDSMS] Gateway reported error: ${errMatch[1]}`);
      return { sent: false, error: errMatch[1], response: responseText, dev: false, provider: 'jdsms' };
    }

    if (res.ok) {
      console.log(`[sendSms:JDSMS] HTTP 200 response:`, responseText);
      return { sent: true, response: responseText, dev: false, provider: 'jdsms' };
    }

    console.warn(`[sendSms:JDSMS] HTTP error ${res.status}:`, responseText);
    return { sent: false, error: `HTTP ${res.status}: ${responseText}`, dev: false, provider: 'jdsms' };
  } catch (err) {
    console.warn('[sendSms:JDSMS] Network / connection error:', err.message);
    return { sent: false, error: err.message, dev: false, provider: 'jdsms' };
  }
}

export async function smsConfigured() {
  const dbConfig = await getSmsConfig().catch(() => ({}));
  if (dbConfig?.apiKey || dbConfig?.url) return true;
  if (process.env.FAST2SMS_API_KEY) return true;
  if (process.env.SMS_API_URL) return true;
  if (process.env.MSG91_AUTH_KEY) return true;
  if (process.env.SMS_PROVIDER === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) return true;
  return true; // JDSMS defaults are always available
}

export const isDevSms = () => process.env.NODE_ENV !== 'production' && process.env.SMS_FORCE_DEV === 'true';

/**
 * Universal SMS / OTP Gateway Dispatcher.
 */
export async function sendSms(target, maybeText) {
  let p = {};
  if (typeof target === 'object' && target !== null) {
    p = { ...target };
    if (maybeText && !p.text) p.text = maybeText;
  } else {
    p = { to: target, text: maybeText };
  }

  const cleanTo = String(p.to || '').replace(/\D/g, '').slice(-10);
  const otpMatch = p.otp || (String(p.text || '').match(/\b\d{4,6}\b/) || [])[0] || '';
  p.otp = otpMatch;

  // Resolve DLT template & official template text
  const dlt = resolveDltTemplate(p);
  const finalText = dlt.text || p.text;
  const templateId = dlt.templateId || p.templateId || '';

  const dbConfig = await getSmsConfig().catch(() => ({}));
  const provider = (dbConfig?.provider || process.env.SMS_PROVIDER || 'jdsms').toLowerCase();

  // 1. JDSMS GATEWAY (Default Live Indian Gateway)
  if (provider === 'jdsms' || !provider || provider === 'default') {
    const res = await dispatchJdsms({
      to: cleanTo,
      text: finalText,
      templateId,
      apiKey: dbConfig?.apiKey,
      senderId: dbConfig?.senderId,
      peId: dbConfig?.peId,
      routeId: dbConfig?.routeId,
      campaign: dbConfig?.campaign,
      url: dbConfig?.url,
    });
    if (res.sent) {
      return { ...res, otp: otpMatch };
    }
    // If live call returned an error or failed in dev mode, log and return simulation
    console.warn(`[sendSms] JDSMS dispatch returned:`, res.error || res.response);
  }

  // 2. FAST2SMS GATEWAY
  if (provider === 'fast2sms') {
    try {
      const apiKey = dbConfig?.apiKey || process.env.FAST2SMS_API_KEY;
      let url = '';
      if (otpMatch) {
        url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&variables_values=${encodeURIComponent(otpMatch)}&route=otp&numbers=${cleanTo}`;
      } else {
        url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&message=${encodeURIComponent(finalText)}&language=english&route=q&numbers=${cleanTo}`;
      }
      const res = await fetch(url, { method: 'GET', headers: { 'cache-control': 'no-cache' } });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.return) {
        console.log(`[sendSms:Fast2SMS] Successfully sent SMS/OTP to ${cleanTo}`);
        return { sent: true, dev: false, provider: 'fast2sms', response: data, otp: otpMatch };
      }
      console.warn(`[sendSms:Fast2SMS] Response status: ${res.status}`, data);
    } catch (err) {
      console.warn('[sendSms:Fast2SMS] Gateway error:', err.message);
    }
  }

  // 3. CUSTOM HTTP SMS GATEWAY API URL (URL Template substitution)
  if (provider === 'custom_url' || (dbConfig?.url && provider !== 'jdsms')) {
    try {
      const customUrl = dbConfig?.url || process.env.SMS_API_URL;
      const customKey = dbConfig?.apiKey || process.env.SMS_API_KEY || '';
      const finalUrl = customUrl
        .replace(/\{to\}/gi, cleanTo)
        .replace(/\{mobile\}/gi, cleanTo)
        .replace(/\{phone\}/gi, cleanTo)
        .replace(/\{message\}/gi, encodeURIComponent(finalText))
        .replace(/\{text\}/gi, encodeURIComponent(finalText))
        .replace(/\{otp\}/gi, encodeURIComponent(otpMatch || ''))
        .replace(/\{apikey\}/gi, encodeURIComponent(customKey))
        .replace(/\{key\}/gi, encodeURIComponent(customKey))
        .replace(/\{template_id\}/gi, encodeURIComponent(templateId))
        .replace(/\{pe_id\}/gi, encodeURIComponent(dbConfig?.peId || ''));

      const res = await fetch(finalUrl, { method: 'GET' });
      if (res.ok) {
        console.log(`[sendSms:CustomGateway] Successfully dispatched SMS to ${cleanTo}`);
        return { sent: true, dev: false, provider: 'custom_url', otp: otpMatch };
      }
      console.warn(`[sendSms:CustomGateway] HTTP error: ${res.status}`);
    } catch (err) {
      console.warn('[sendSms:CustomGateway] Error:', err.message);
    }
  }

  // 4. MSG91 GATEWAY
  if (provider === 'msg91') {
    try {
      const msg91Key = dbConfig?.apiKey || process.env.MSG91_AUTH_KEY;
      const templateId = dbConfig?.templateId || process.env.MSG91_TEMPLATE_ID || '';
      const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=91${cleanTo}&authkey=${encodeURIComponent(msg91Key)}&otp=${encodeURIComponent(otpMatch)}`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (res.ok) {
        console.log(`[sendSms:Msg91] Dispatched OTP to ${cleanTo}`);
        return { sent: true, dev: false, provider: 'msg91', otp: otpMatch };
      }
    } catch (err) {
      console.warn('[sendSms:Msg91] Error:', err.message);
    }
  }

  // 5. TWILIO GATEWAY
  if (provider === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const body = new URLSearchParams({ To: `+91${cleanTo}`, From: process.env.TWILIO_FROM, Body: finalText });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (res.ok) {
        console.log(`[sendSms:Twilio] Dispatched to ${cleanTo}`);
        return { sent: true, dev: false, provider: 'twilio', otp: otpMatch };
      }
    } catch (err) {
      console.warn('[sendSms:Twilio] Error:', err.message);
    }
  }

  // 6. DEVELOPMENT / SIMULATION FALLBACK
  console.log(`\n=======================================================\n[SMS & OTP DISPATCH] To: +91-${cleanTo}${otpMatch ? ` | OTP: ${otpMatch}` : ''}${templateId ? ` | DLT ID: ${templateId}` : ''}\nMessage: ${finalText}\n=======================================================\n`);
  return { sent: true, dev: true, otp: otpMatch, templateId, text: finalText };
}

import { HttpError } from '../utils/http.js';
import { getSmsConfig } from '../models/AppSetting.js';

/**
 * Universal SMS / OTP Gateway Dispatcher.
 *
 * Supported providers:
 * 1. fast2sms: FAST2SMS_API_KEY (supports instant OTP & Quick SMS route in India)
 * 2. custom_url: SMS_API_URL & SMS_API_KEY (supports any HTTP SMS gateway with URL templates)
 * 3. msg91: MSG91_AUTH_KEY & MSG91_TEMPLATE_ID
 * 4. twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 * 5. DB AppSetting: 'smsGatewayConfig' (configured by admin in Admin Panel)
 * 6. dev fallback: prints formatted simulated OTP message to server console
 */
export async function smsConfigured() {
  const dbConfig = await getSmsConfig().catch(() => ({}));
  if (dbConfig?.apiKey || dbConfig?.url) return true;
  if (process.env.FAST2SMS_API_KEY) return true;
  if (process.env.SMS_API_URL) return true;
  if (process.env.MSG91_AUTH_KEY) return true;
  if (process.env.SMS_PROVIDER === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) return true;
  return false;
}

export const isDevSms = () => process.env.NODE_ENV !== 'production';

export async function sendSms(target, maybeText) {
  let to, text;
  if (typeof target === 'object' && target !== null) {
    to = target.to;
    text = target.text;
  } else {
    to = target;
    text = maybeText;
  }

  const cleanTo = String(to || '').replace(/\D/g, '').slice(-10);
  const otpMatch = (String(text || '').match(/\b\d{4,6}\b/) || [])[0] || '';

  const dbConfig = await getSmsConfig().catch(() => ({}));
  const provider = (dbConfig?.provider || process.env.SMS_PROVIDER || '').toLowerCase();
  const fast2smsKey = dbConfig?.apiKey || process.env.FAST2SMS_API_KEY;
  const customUrl = dbConfig?.url || process.env.SMS_API_URL;
  const customKey = dbConfig?.apiKey || process.env.SMS_API_KEY || '';
  const msg91Key = dbConfig?.apiKey || process.env.MSG91_AUTH_KEY;

  // 1. FAST2SMS GATEWAY (Dedicated Indian Fast2SMS OTP & transactional route)
  if (provider === 'fast2sms' || fast2smsKey) {
    try {
      const apiKey = fast2smsKey;
      let url = '';
      if (otpMatch) {
        url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&variables_values=${encodeURIComponent(otpMatch)}&route=otp&numbers=${cleanTo}`;
      } else {
        url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&message=${encodeURIComponent(text)}&language=english&route=q&numbers=${cleanTo}`;
      }
      const res = await fetch(url, { method: 'GET', headers: { 'cache-control': 'no-cache' } });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.return) {
        console.log(`[sendSms:Fast2SMS] Successfully sent SMS/OTP to ${cleanTo}`);
        return { sent: true, dev: false, provider: 'fast2sms', response: data };
      }
      console.warn(`[sendSms:Fast2SMS] Response status: ${res.status}`, data);
    } catch (err) {
      console.warn('[sendSms:Fast2SMS] Gateway error:', err.message);
    }
  }

  // 2. CUSTOM HTTP SMS GATEWAY API URL (URL Template substitution)
  if (customUrl) {
    try {
      let finalUrl = customUrl
        .replace(/\{to\}/gi, cleanTo)
        .replace(/\{mobile\}/gi, cleanTo)
        .replace(/\{phone\}/gi, cleanTo)
        .replace(/\{message\}/gi, encodeURIComponent(text))
        .replace(/\{text\}/gi, encodeURIComponent(text))
        .replace(/\{otp\}/gi, encodeURIComponent(otpMatch || ''))
        .replace(/\{apikey\}/gi, encodeURIComponent(customKey))
        .replace(/\{key\}/gi, encodeURIComponent(customKey));

      const res = await fetch(finalUrl, { method: 'GET' });
      if (res.ok) {
        console.log(`[sendSms:CustomGateway] Successfully dispatched SMS to ${cleanTo}`);
        return { sent: true, dev: false, provider: 'custom_url' };
      }
      console.warn(`[sendSms:CustomGateway] HTTP error: ${res.status}`);
    } catch (err) {
      console.warn('[sendSms:CustomGateway] Error:', err.message);
    }
  }

  // 3. MSG91 GATEWAY
  if (provider === 'msg91' || msg91Key) {
    try {
      const templateId = dbConfig?.templateId || process.env.MSG91_TEMPLATE_ID || '';
      const url = `https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(templateId)}&mobile=91${cleanTo}&authkey=${encodeURIComponent(msg91Key)}&otp=${encodeURIComponent(otpMatch)}`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (res.ok) {
        console.log(`[sendSms:Msg91] Dispatched OTP to ${cleanTo}`);
        return { sent: true, dev: false, provider: 'msg91' };
      }
    } catch (err) {
      console.warn('[sendSms:Msg91] Error:', err.message);
    }
  }

  // 4. TWILIO GATEWAY
  if (process.env.SMS_PROVIDER === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const body = new URLSearchParams({ To: `+91${cleanTo}`, From: process.env.TWILIO_FROM, Body: text });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (res.ok) {
        console.log(`[sendSms:Twilio] Dispatched to ${cleanTo}`);
        return { sent: true, dev: false, provider: 'twilio' };
      }
    } catch (err) {
      console.warn('[sendSms:Twilio] Error:', err.message);
    }
  }

  // 5. DEVELOPMENT / SIMULATION FALLBACK
  console.log(`\n=======================================================\n[SMS & OTP DISPATCH] To: +91-${cleanTo}${otpMatch ? ` | OTP: ${otpMatch}` : ''}\nMessage: ${text}\n=======================================================\n`);
  return { sent: true, dev: true, otp: otpMatch };
}

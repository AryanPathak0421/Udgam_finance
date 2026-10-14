import { HttpError } from '../utils/http.js';

/**
 * Sends a text message.
 *
 * SMS_PROVIDER=twilio  needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 * (anything else)      development: the message is printed to the console and NOT sent.
 *
 * In production an unconfigured provider is an error — an OTP flow must never "succeed"
 * without a message really being sent.
 *
 * Note for India: transactional SMS must go through a DLT-registered sender and template.
 * Register the OTP template with your provider and use its exact wording.
 */
export function smsConfigured() {
  return process.env.SMS_PROVIDER === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM;
}

export const isDevSms = () => !smsConfigured() && process.env.NODE_ENV !== 'production';

export async function sendSms({ to, text }) {
  if (smsConfigured()) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const body = new URLSearchParams({ To: `+91${to}`, From: process.env.TWILIO_FROM, Body: text });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      console.error('SMS provider error', res.status, (await res.text()).slice(0, 200));
      throw new HttpError(502, 'The SMS could not be sent. Please try again.');
    }
    return { sent: true, dev: false };
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n[sms:dev] To: ${to}\n${text}\n`);
    return { sent: false, dev: true };
  }
  throw new HttpError(503, 'SMS service is not configured, so OTPs cannot be sent.');
}

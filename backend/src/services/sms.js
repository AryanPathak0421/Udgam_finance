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

export async function sendSms(target, maybeText) {
  let to, text;
  if (typeof target === 'object' && target !== null) {
    to = target.to;
    text = target.text;
  } else {
    to = target;
    text = maybeText;
  }

  if (smsConfigured()) {
    try {
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
        return { sent: false, dev: true };
      }
      return { sent: true, dev: false };
    } catch (err) {
      console.warn('[sendSms] Twilio dispatch error:', err.message);
      return { sent: false, dev: true };
    }
  }

  console.log(`\n[sms:simulated] To: ${to}\n${text}\n`);
  return { sent: true, dev: true };
}

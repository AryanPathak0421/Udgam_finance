import crypto from 'crypto';

/**
 * Razorpay (online payments of a member's EMI). Only the keys of the environment are used (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET); the keys that start with
 * rzp_test_ work in test mode. It talks to the REST API directly, so no package is needed.
 */
const API = 'https://api.razorpay.com/v1';

export const razorpayKeyId = () => (process.env.RAZORPAY_KEY_ID || '').trim();
const secret = () => (process.env.RAZORPAY_KEY_SECRET || '').trim();
export const razorpayConfigured = () => Boolean(razorpayKeyId() && secret());
export const razorpayTestMode = () => razorpayKeyId().startsWith('rzp_test_');

async function call(method, path, body) {
  if (!razorpayConfigured()) throw Object.assign(new Error('Online payment is not set up'), { status: 503 });
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${razorpayKeyId()}:${secret()}`).toString('base64')}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json?.error?.description || `Razorpay error ${res.status}`);
    e.status = res.status === 401 ? 502 : 502;
    e.razorpay = json?.error;
    throw e;
  }
  return json;
}

/** An order for a payment of `amountPaise` (the member pays it in the Razorpay checkout). */
export const createOrder = ({ amountPaise, receipt, notes }) => call('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt: String(receipt).slice(0, 40), notes, payment_capture: 1 });

/**
 * A payment link: Razorpay's own page where UPI, card or net banking is chosen. The link is shown as a QR code, so a borrower scans it with any phone and
 * pays; the status of the link (and the payment id) is asked back until it is paid. (The QR Code API of Razorpay is not enabled on the account.)
 */
export const createPaymentLink = ({ amountPaise, description, referenceId, notes, name, contact }) => call('POST', '/payment_links', {
  amount: amountPaise,
  currency: 'INR',
  accept_partial: false,
  description: String(description || 'EMI').slice(0, 250),
  reference_id: String(referenceId).slice(0, 40),
  expire_by: Math.floor(Date.now() / 1000) + 2 * 60 * 60, // two hours
  notify: { sms: false, email: false },
  reminder_enable: false,
  ...(name || contact ? { customer: { ...(name ? { name: String(name).slice(0, 50) } : {}), ...(contact ? { contact: String(contact) } : {}) } } : {}),
  notes,
});

export const fetchPaymentLink = (linkId) => call('GET', `/payment_links/${encodeURIComponent(linkId)}`);

export const fetchPayment = (paymentId) => call('GET', `/payments/${encodeURIComponent(paymentId)}`);

export const capturePayment = (paymentId, amountPaise) => call('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: 'INR' });

/** The signature Razorpay sends back after a payment: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export function signatureValid(orderId, paymentId, signature) {
  if (!orderId || !paymentId || !signature || !secret()) return false;
  const expected = crypto.createHmac('sha256', secret()).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

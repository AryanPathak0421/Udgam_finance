/**
 * Government-data verification (PAN holder check, bank account "penny drop").
 *
 * These need a paid KYC provider account (for example Cashfree, Razorpay, Karza, Surepass).
 * Until a provider is configured they answer `unavailable`, so the member is saved as
 * "not verified" and nothing is claimed that was not actually checked.
 *
 * To switch on: set KYC_PROVIDER and the provider's credentials, then implement the matching
 * branch in verifyPan / verifyBankAccount below. No provider code is guessed here.
 */
export const kycProviderConfigured = () => Boolean(process.env.KYC_PROVIDER);

// PAN: a 4th character of P means an individual; the 5th is the first letter of the surname.
export function checkPanFormat(pan, name) {
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return { ok: false, message: 'Enter a valid PAN (e.g. ABCDE1234F)' };
  if (pan[3] !== 'P') return { ok: false, message: 'A borrower PAN must be an individual PAN (4th letter P)' };
  if (name) {
    const surname = String(name).trim().split(/\s+/).slice(-1)[0] || '';
    if (surname && surname[0].toUpperCase() !== pan[4]) {
      // Name order varies across India and surnames change, so this is a warning only.
      return { ok: true, warning: `The PAN's 5th letter is ${pan[4]}, but the name ends with "${surname}". Please check the PAN.` };
    }
  }
  return { ok: true };
}

/** Returns { status: 'verified' | 'mismatch' | 'unavailable', holderName? }. */
export async function verifyPan() {
  if (!kycProviderConfigured()) return { status: 'unavailable' };
  return { status: 'unavailable' };
}

/** Returns { status: 'verified' | 'mismatch' | 'unavailable', holderName? }. */
export async function verifyBankAccount() {
  if (!kycProviderConfigured()) return { status: 'unavailable' };
  return { status: 'unavailable' };
}

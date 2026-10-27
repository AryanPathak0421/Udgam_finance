/**
 * GSTIN checks that need no outside service, plus the hook for a GST provider.
 *
 * A GSTIN is 15 characters: 2 digit state code, the holder's 10 character PAN, an entity number,
 * the letter Z and a check character. That lets us verify the number itself (format, state, check
 * character) and, when the borrower's PAN is known, that the GSTIN really belongs to that PAN.
 *
 * The registered name / status of a GSTIN come from the GST network, which needs a provider account
 * (set GST_PROVIDER and implement verifyGstin below). Without one nothing is claimed as verified.
 */
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_RE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/;

// State / union territory codes: 01-38, 97 (other territory), 99 (centre jurisdiction).
const validStateCode = (c) => {
  const n = Number(c);
  return (n >= 1 && n <= 38) || n === 97 || n === 99;
};

export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = CHARS.indexOf(first14[i]);
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/** @returns {{ok: boolean, message?: string, stateCode?: string, pan?: string}} */
export function checkGstin(gstin, { pan } = {}) {
  const g = String(gstin || '').toUpperCase();
  const m = GSTIN_RE.exec(g);
  if (!m) return { ok: false, message: 'Enter a valid 15-character GST number (e.g. 27ABCPD1234F1ZC)' };
  if (!validStateCode(m[1])) return { ok: false, message: 'The state code of this GST number is not valid' };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { ok: false, message: 'This GST number is not valid (check character does not match)' };
  if (pan && String(pan).toUpperCase() !== m[2]) {
    return { ok: false, message: `This GST number belongs to PAN ${m[2]}, not to the borrower's PAN` };
  }
  return { ok: true, stateCode: m[1], pan: m[2] };
}

export const gstProviderConfigured = () => Boolean(process.env.GST_PROVIDER);

/** Registered name / status from the GST network. Returns { status: 'verified' | 'not_found' | 'unavailable' }. */
export async function verifyGstin() {
  if (!gstProviderConfigured()) return { status: 'unavailable' };
  return { status: 'unavailable' };
}

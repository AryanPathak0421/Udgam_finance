// Money and percentages are stored as integers (paise / basis points), never floats.

/**
 * '50000.46' | 50000.46 -> 5000046. Accepts up to 2 decimals and returns null for
 * negatives, junk, exponents or more than 2 decimals (no silent rounding).
 * Works on the decimal string, so there is no float error.
 */
export function toMinor(value) {
  const str = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(str);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

export const fromMinor = (n) => (n === null || n === undefined ? null : n / 100);

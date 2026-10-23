// Small HTTP helpers shared by controllers.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

// Collects field errors; throw with `check.throwIfAny()`.
export function createValidator() {
  const errors = {};
  return {
    add(field, message) {
      if (!errors[field]) errors[field] = message;
    },
    has: () => Object.keys(errors).length > 0,
    throwIfAny() {
      if (Object.keys(errors).length) throw new HttpError(422, 'Please correct the highlighted fields', errors);
    },
  };
}

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const asString = (v) => (typeof v === 'string' ? v.trim() : '');

// Parses 'YYYY-MM-DD' into a UTC-midnight Date, or returns null.
export function parseDateOnly(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}

export function todayDateString() {
  const d = new Date();
  const utcStr = d.toISOString().slice(0, 10);
  let istStr = utcStr;
  try {
    istStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
  } catch {
    const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
    istStr = ist.toISOString().slice(0, 10);
  }
  return istStr > utcStr ? istStr : utcStr;
}

export function startOfToday() {
  return new Date(`${todayDateString()}T00:00:00.000Z`);
}

export function parsePaging(query, { defaultLimit = 10, maxLimit = 100 } = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}


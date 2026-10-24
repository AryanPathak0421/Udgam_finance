import { Leave } from '../models/HrExtra.js';

/**
 * Earned leave (EL), the only leave the company gives: 1 for every month, 12 for a financial year (April to March).
 * An employee who joins on or before the 15th earns the joining month too, one who joins after the 15th starts from the next month
 * (joined in December: January, February and March = 3 EL; joined before the 15th of December: December as well, 4 EL).
 * The EL that is not taken stays with the employee into the next financial year (old pending EL, which can be taken together), but no EL is
 * given in advance: only what has been earned up to today can be taken.
 */
const idx = (d) => d.getUTCFullYear() * 12 + d.getUTCMonth();
export const fyStartOf = (d) => new Date(Date.UTC(d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1, 3, 1));
export const fyLabel = (start) => `${start.getUTCFullYear()}-${String((start.getUTCFullYear() + 1) % 100).padStart(2, '0')}`;

/** The first month an employee earns EL in (a month index), or null when the joining date is not known. */
function firstMonth(join) {
  if (!join) return null;
  const j = new Date(join);
  return idx(j) + (j.getUTCDate() <= 15 ? 0 : 1);
}

/** The days of EL an employee earned in the months from `fromIdx` to `toIdx` (inclusive). */
const earnedBetween = (first, fromIdx, toIdx) => {
  const start = first === null ? fromIdx : Math.max(first, fromIdx);
  return Math.max(toIdx - start + 1, 0);
};

/** The balance of one employee as on a date: carried from the years before, earned this financial year, taken, and what can be taken now. */
export function balanceOf(emp, taken, asOf = new Date()) {
  const today = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const fy = fyStartOf(today);
  const fyIdx = idx(fy);
  const first = firstMonth(emp.joiningDate);
  const before = first === null ? 0 : earnedBetween(first, first, fyIdx - 1);
  const earned = earnedBetween(first, fyIdx, idx(today));
  const usedBefore = taken.filter((l) => new Date(l.from) < fy).reduce((s, l) => s + (l.days || 0), 0);
  const used = taken.filter((l) => new Date(l.from) >= fy).reduce((s, l) => s + (l.days || 0), 0);
  const opening = Math.max(before - usedBefore, 0);
  return { financialYear: fyLabel(fy), opening, earned, used, available: Math.max(opening + earned - used, 0), perYear: 12, joiningKnown: Boolean(emp.joiningDate) };
}

/** EL that is applied for or approved (not rejected) of the employees. */
async function takenBy(ids) {
  const rows = await Leave.find({ employee: { $in: ids }, type: 'earned', status: { $in: ['pending', 'approved'] } }).select('employee from days').lean();
  const by = new Map();
  rows.forEach((l) => { const k = String(l.employee); if (!by.has(k)) by.set(k, []); by.get(k).push(l); });
  return by;
}

export async function elBalance(emp, asOf) {
  return balanceOf(emp, (await takenBy([emp._id])).get(String(emp._id)) || [], asOf);
}

export async function elBalances(emps, asOf) {
  const by = await takenBy(emps.map((e) => e._id));
  return new Map(emps.map((e) => [String(e._id), balanceOf(e, by.get(String(e._id)) || [], asOf)]));
}

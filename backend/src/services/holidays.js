import { Holiday } from '../models/SuperAdmin.js';
import { LoanPayment } from '../models/LoanPayment.js';

const DAY = 24 * 3600 * 1000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDay = (d, n = 1) => new Date(d.getTime() + n * DAY);

/** The holidays of the Holiday Master: the ones of every branch, and the ones of single branches. */
export async function loadHolidays() {
  const rows = await Holiday.find({ isDeleted: false, isActive: true }).select('date branch').lean();
  const company = new Set();
  const byBranch = new Map();
  rows.forEach((h) => {
    if (!h.branch) company.add(iso(h.date));
    else {
      const k = String(h.branch);
      if (!byBranch.has(k)) byBranch.set(k, new Set());
      byBranch.get(k).add(iso(h.date));
    }
  });
  return { company, byBranch };
}
/** The days a branch is off besides Sunday: its own holidays and the ones of every branch. */
export const offDaysOf = ({ company, byBranch }, branchId) => new Set([...company, ...(byBranch.get(String(branchId)) || [])]);
export async function offDaysFor(branchId) { return offDaysOf(await loadHolidays(), branchId); }

const isOff = (d, off) => d.getUTCDay() === 0 || off.has(iso(d));
export const nextWorking = (d, off) => { let x = d; while (isOff(x, off)) x = addDay(x); return x; };
/** The date of installment k of a daily loan that starts on s: Sundays and holidays are skipped. */
export const dailyNext = (off) => (s, k) => {
  let d = nextWorking(s, off);
  for (let i = 0; i < k; i += 1) d = nextWorking(addDay(d), off);
  return d;
};

/**
 * A holiday was added, changed or deleted: the installments of the daily loans that fall on or after it are counted again, skipping Sundays and the
 * holidays (the earlier ones stay as they are). Payments are kept by installment number, so no payment moves. For one branch's holiday only that branch's loans.
 */
export async function redateDailyLoans(fromDate, branchId) {
  const holidays = await loadHolidays();
  const cursor = LoanPayment.find({ status: 'paid', mode: 'daily', ...(branchId ? { branch: branchId } : {}), 'schedule.dueDate': { $gte: fromDate } })
    .select('branch emiStartDate schedule.no schedule.dueDate').lean().cursor({ batchSize: 100 });
  let ops = [];
  let changed = 0;
  const flush = async () => { if (ops.length) { await LoanPayment.bulkWrite(ops, { ordered: false }); ops = []; } };
  for await (const l of cursor) {
    const off = offDaysOf(holidays, l.branch);
    const sch = l.schedule || [];
    const first = sch.findIndex((s) => new Date(s.dueDate) >= fromDate);
    if (first < 0) continue;
    let prev = first === 0 ? null : new Date(sch[first - 1].dueDate);
    const set = {};
    for (let j = first; j < sch.length; j += 1) {
      const d = j === 0 ? nextWorking(new Date(l.emiStartDate), off) : nextWorking(addDay(prev), off);
      if (d.getTime() !== new Date(sch[j].dueDate).getTime()) set[`schedule.${j}.dueDate`] = d;
      prev = d;
    }
    if (Object.keys(set).length) {
      set.emiEndDate = prev;
      if (first === 0) set.emiStartDate = nextWorking(new Date(l.emiStartDate), off);
      ops.push({ updateOne: { filter: { _id: l._id }, update: { $set: set } } });
      changed += 1;
      if (ops.length >= 200) await flush(); // eslint-disable-line no-await-in-loop
    }
  }
  await flush();
  return changed;
}

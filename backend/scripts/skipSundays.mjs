/**
 * The company is off on Sunday, so a daily loan has no installment on a Sunday. New loans are made that way; this brings the daily loans that
 * were already there (the ones of the old system and any made before) in line: the due dates are counted again from the first installment,
 * skipping the Sundays, and the first / last installment dates follow.
 *
 *   node scripts/skipSundays.mjs --dry     count what would change, nothing is written
 *   node scripts/skipSundays.mjs           change them
 *
 * What was paid is kept by installment NUMBER, so no payment moves; only the due dates do. Safe to run again (it changes nothing the second time).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { skipSundays } from '../src/services/loanCalculator.js';

const DRY = process.argv.includes('--dry');
await mongoose.connect(process.env.MONGODB_URI);
const col = mongoose.connection.db.collection('loanpayments');

const cursor = col.find({ status: 'paid' }, { projection: { mode: 1, emiStartDate: 1, emiEndDate: 1, 'schedule.no': 1, 'schedule.dueDate': 1 } }).batchSize(100);
const stat = { loans: 0, changedLoans: 0, movedInstallments: 0, sundayBefore: 0 };
let ops = [];
const flush = async () => {
  if (!ops.length) return;
  if (!DRY) await col.bulkWrite(ops, { ordered: false });
  ops = [];
};

for await (const l of cursor) {
  stat.loans += 1;
  const schedule = l.schedule || [];
  if (!schedule.length || !l.emiStartDate) continue;
  const isDaily = l.mode === 'daily';
  const start = isDaily ? skipSundays(new Date(l.emiStartDate), 0) : (new Date(l.emiStartDate).getUTCDay() === 0 ? new Date(new Date(l.emiStartDate).getTime() + 86400000) : new Date(l.emiStartDate));
  const set = {};
  schedule.forEach((s, i) => {
    const cur = new Date(s.dueDate);
    if (cur.getUTCDay() === 0) stat.sundayBefore += 1;
    let next;
    if (isDaily) {
      next = skipSundays(start, (s.no ?? i + 1) - 1);
    } else {
      next = cur.getUTCDay() === 0 ? new Date(cur.getTime() + 86400000) : cur;
    }
    if (cur.getTime() !== next.getTime()) {
      set[`schedule.${i}.dueDate`] = next;
      stat.movedInstallments += 1;
    }
  });
  const last = isDaily ? skipSundays(start, Math.max(schedule.length - 1, 0)) : (l.emiEndDate && new Date(l.emiEndDate).getUTCDay() === 0 ? new Date(new Date(l.emiEndDate).getTime() + 86400000) : (l.emiEndDate ? new Date(l.emiEndDate) : null));
  if (new Date(l.emiStartDate).getTime() !== start.getTime()) set.emiStartDate = start;
  if (last && (!l.emiEndDate || new Date(l.emiEndDate).getTime() !== last.getTime())) set.emiEndDate = last;
  if (Object.keys(set).length) {
    stat.changedLoans += 1;
    ops.push({ updateOne: { filter: { _id: l._id }, update: { $set: set } } });
    if (ops.length >= 200) await flush();
  }
}
await flush();
console.log(`${DRY ? 'DRY RUN, nothing is written. ' : ''}loans scanned: ${stat.loans} · installments that were on a Sunday: ${stat.sundayBefore} · loans changed: ${stat.changedLoans} · due dates moved: ${stat.movedInstallments}`);
await mongoose.disconnect();

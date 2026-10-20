/**
 * Sets up what Commission Generate needs to produce the group leader commission: the financial years and the Group Leader rule of each.
 *
 *   node scripts/setupCommission.mjs --dry     show what would be made
 *   node scripts/setupCommission.mjs           make it
 *
 *  - financial years 2025-26 and 2026-27 (April to March), if they are not there; 2026-27 is made the active one when no year is active
 *  - the Group Leader rule of each year, if it has none: ₹25 per loan per month, for 4 months, starting the month after the loan is paid out
 *    (any rank). Change it later under Admin Master → Commission Master.
 * Staff (employee) commission rules are NOT made here: they need the amounts of the business (Commission Master).
 * Safe to run again: nothing that exists is changed.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { FinancialYear } from '../src/models/FinancialYear.js';
import { Commission } from '../src/models/Commission.js';

const DRY = process.argv.includes('--dry');
await mongoose.connect(process.env.MONGODB_URI);

const YEARS = [
  { name: '2025-26', from: Date.UTC(2025, 3, 1), to: Date.UTC(2026, 2, 31) },
  { name: '2026-27', from: Date.UTC(2026, 3, 1), to: Date.UTC(2027, 2, 31) },
];
const haveActive = Boolean(await FinancialYear.exists({ isActive: true }));
let madeYears = 0;
let madeRules = 0;
for (const y of YEARS) {
  let fy = await FinancialYear.findOne({ financialYearId: `FY${y.name}` });
  if (!fy) {
    // a year of the same dates under another name counts as the same year
    fy = await FinancialYear.findOne({ startDate: new Date(y.from), endDate: new Date(y.to) });
  }
  if (!fy) {
    console.log(`${DRY ? 'would make' : 'making'} financial year ${y.name}`);
    madeYears += 1;
    if (!DRY) fy = await FinancialYear.create({ financialYearId: `FY${y.name}`, name: y.name, startDate: new Date(y.from), endDate: new Date(y.to), isActive: y.name === '2026-27' && !haveActive });
  }
  if (!fy) continue;
  const has = await Commission.exists({ commissionFor: 'group_leader', financialYear: fy._id, isDeleted: false, rank: { $exists: false } });
  if (!has) {
    console.log(`${DRY ? 'would make' : 'making'} the Group Leader rule of ${y.name}: ₹25 per loan per month, 4 months, from the next month`);
    madeRules += 1;
    if (!DRY) {
      await Commission.create({
        commissionFor: 'group_leader', financialYear: fy._id, basis: 'per_loan', targetUnit: 'loans', scope: 'own', frequency: 'monthly', rateAppliesTo: 'all',
        commissionType: 'fixed', commissionValue: 2500, durationMonths: 4, startDelayMonths: 1, isActive: true, isDeleted: false,
      });
    }
  }
}
console.log(`${DRY ? 'DRY RUN, nothing is written. ' : ''}financial years made: ${madeYears} · Group Leader rules made: ${madeRules}`);
await mongoose.disconnect();

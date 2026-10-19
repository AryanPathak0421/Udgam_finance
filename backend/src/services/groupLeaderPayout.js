import { Commission } from '../models/Commission.js';
import { FinancialYear } from '../models/FinancialYear.js';
import { GroupDisbursement } from '../models/GroupDisbursement.js';
import { GroupLeaderCommission } from '../models/GroupLeaderCommission.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { Group } from '../models/Group.js';
import { generateGroupLeaderCommission, parseMonth, monthKey } from './groupLeaderCommission.js';

const monthStart = (m) => new Date(`${m}-01T00:00:00.000Z`);

/** Loads the financial years and the active group leader rules (the "All ranks" rule per year). */
export async function loadRuleContext() {
  const [fys, rules] = await Promise.all([
    FinancialYear.find().sort({ startDate: 1 }),
    Commission.find({ commissionFor: 'group_leader', isDeleted: false, isActive: true, rank: { $exists: false } }),
  ]);
  const byFy = new Map();
  for (const r of rules) {
    byFy.set(String(r.financialYear), {
      amountPaise: r.commissionValue,
      durationMonths: r.durationMonths || 4,
      startDelayMonths: r.startDelayMonths ?? 1,
    });
  }
  return { fys, byFy };
}

// The rule in force for loans disbursed in `month` is the one of that month's financial year.
export function ruleForMonth(ctx, month) {
  const d = monthStart(month);
  const fy = ctx.fys.find((f) => f.startDate <= d && d <= f.endDate);
  return fy ? ctx.byFy.get(String(fy._id)) || null : null;
}

/** Months in which a disbursement of `month` earns commission under `rule`. */
export function payoutMonths(month, rule) {
  const start = parseMonth(month);
  const out = [];
  for (let k = 0; k < rule.durationMonths; k += 1) out.push(monthKey(start + rule.startDelayMonths + k));
  return out;
}

/**
 * Loans disbursed to each group in each month, from the group loans that were really paid out in the app (one loan per member of the group).
 * The old system's loans are left out: their commission was settled there. Map: group code -> Map(month -> loans).
 */
export async function loadRealDisbursements(codes) {
  const rows = await LoanPayment.aggregate([
    { $match: { status: 'paid', legacyImport: { $ne: true }, 'group.code': { $in: codes }, $or: [{ loanType: 'group' }, { kind: 'group' }] } },
    { $group: { _id: { code: '$group.code', month: { $dateToString: { format: '%Y-%m', date: '$paidOn' } } }, loans: { $sum: { $size: { $ifNull: ['$lines', []] } } } } },
  ]);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r._id.code)) map.set(r._id.code, new Map());
    map.get(r._id.code).set(r._id.month, r.loans);
  }
  return map;
}

/**
 * Brings one group's commission entries in line with its disbursements and the rules.
 * - new payout months get a pending entry
 * - pending entries are updated (an outstanding OTP is cancelled if the amount changed)
 * - pending entries that no longer earn anything are removed
 * - deposited entries are never touched: what was paid stays as paid
 */
export async function syncGroupEntries(group, ctx, realByGroup) {
  // the loans really paid out; the counts entered by hand (the first version) count for the months that have no real loan
  const manual = await GroupDisbursement.find({ group: group._id });
  const real = (realByGroup || (await loadRealDisbursements([group.code]))).get(group.code);
  const merged = new Map(manual.map((d) => [d.month, d.loans]));
  for (const [month, loans] of real || []) merged.set(month, loans);
  const disbursements = [...merged].map(([month, loans]) => ({ month, loans }));
  const payouts = new Map();
  let skippedNoRule = 0;

  for (const d of disbursements) {
    const rule = ruleForMonth(ctx, d.month);
    if (!rule) {
      skippedNoRule += 1;
      continue;
    }
    const r = generateGroupLeaderCommission({
      disbursements: [{ month: d.month, loans: d.loans }],
      amountPaise: rule.amountPaise,
      durationMonths: rule.durationMonths,
      startDelayMonths: rule.startDelayMonths,
    });
    for (const m of r.months) {
      const cur = payouts.get(m.month) || { loans: 0, amountPaise: 0, rates: new Set() };
      cur.loans += m.eligibleLoans;
      cur.amountPaise += m.amountPaise;
      cur.rates.add(m.perLoanPaise);
      payouts.set(m.month, cur);
    }
  }

  const existing = await GroupLeaderCommission.find({ group: group._id }).select('+otpHash');
  const byMonth = new Map(existing.map((e) => [e.month, e]));
  const stats = { created: 0, updated: 0, removed: 0, unchanged: 0, skippedNoRule };

  for (const [month, p] of payouts) {
    const perLoanPaise = p.rates.size === 1 ? [...p.rates][0] : undefined;
    const e = byMonth.get(month);
    if (!e) {
      // eslint-disable-next-line no-await-in-loop
      await GroupLeaderCommission.create({
        group: group._id,
        branch: group.branch,
        month,
        loans: p.loans,
        perLoanPaise,
        amountPaise: p.amountPaise,
        status: 'pending',
      });
      stats.created += 1;
    } else if (e.status === 'pending') {
      if (e.loans === p.loans && e.amountPaise === p.amountPaise) {
        stats.unchanged += 1;
      } else {
        e.loans = p.loans;
        e.amountPaise = p.amountPaise;
        e.perLoanPaise = perLoanPaise;
        e.otpHash = undefined; // the OTP message quoted the old amount
        e.otpExpiresAt = undefined;
        e.otpAttempts = 0;
        // eslint-disable-next-line no-await-in-loop
        await e.save();
        stats.updated += 1;
      }
    } else {
      stats.unchanged += 1;
    }
  }
  for (const e of existing) {
    if (!payouts.has(e.month) && e.status === 'pending') {
      // eslint-disable-next-line no-await-in-loop
      await e.deleteOne();
      stats.removed += 1;
    }
  }
  return stats;
}

/** Brings the commission entries of every group in `filter` (a branch filter) in line with the loans and the rules. Returns the totals. */
export async function syncAllGroups(filter = {}) {
  const ctx = await loadRuleContext();
  const groups = await Group.find({ isDeleted: false, ...filter });
  const real = await loadRealDisbursements(groups.map((g) => g.code));
  const total = { groups: groups.length, created: 0, updated: 0, removed: 0, unchanged: 0, skippedNoRule: 0 };
  for (const g of groups) {
    // eslint-disable-next-line no-await-in-loop
    const s = await syncGroupEntries(g, ctx, real);
    for (const k of ['created', 'updated', 'removed', 'unchanged', 'skippedNoRule']) total[k] += s[k];
  }
  total.hasRule = ctx.byFy.size > 0;
  return total;
}

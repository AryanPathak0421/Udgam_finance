import { Commission } from '../models/Commission.js';
import { FinancialYear } from '../models/FinancialYear.js';
import { GroupDisbursement } from '../models/GroupDisbursement.js';
import { GroupLeaderCommission } from '../models/GroupLeaderCommission.js';
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
 * Brings one group's commission entries in line with its disbursements and the rules.
 * - new payout months get a pending entry
 * - pending entries are updated (an outstanding OTP is cancelled if the amount changed)
 * - pending entries that no longer earn anything are removed
 * - deposited entries are never touched: what was paid stays as paid
 */
export async function syncGroupEntries(group, ctx) {
  const disbursements = await GroupDisbursement.find({ group: group._id });
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

import { Commission } from '../models/Commission.js';
import { FinancialYear } from '../models/FinancialYear.js';
import { User } from '../models/User.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { Group } from '../models/Group.js';
import { Member } from '../models/Member.js';
import { EmployeeCommission } from '../models/EmployeeCommission.js';
import { legacyUnit, legacyBasis, typeMeta, isCountUnit } from '../config/commissionTypes.js';
import { computeTierCommission } from './tierCommission.js';
import { parseMonth, monthKey } from './groupLeaderCommission.js';

const DAY = 24 * 3600 * 1000;
const dayStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const monthStart = (m) => new Date(`${m}-01T00:00:00.000Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const monthName = (m) => monthStart(m).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The financial year a month falls in (months never cross a financial year). */
export async function financialYearOf(month) {
  const d = monthStart(month);
  return FinancialYear.findOne({ startDate: { $lte: d }, endDate: { $gte: d } });
}

/**
 * The periods of a rule that are worked out when a month is generated:
 *  daily every day of the month, weekly the weeks (Monday to Sunday) cut at the month ends, monthly the month,
 *  yearly the whole financial year, in the last month of that year. A period that has not started yet is left out.
 */
export function periodsFor(month, frequency, fy, now = new Date()) {
  const from = monthStart(month);
  const to = monthStart(monthKey(parseMonth(month) + 1));
  const out = [];
  if (frequency === 'daily') {
    for (let d = from.getTime(); d < to.getTime(); d += DAY) out.push({ from: new Date(d), to: new Date(d + DAY), label: iso(new Date(d)) });
  } else if (frequency === 'weekly') {
    let cur = from.getTime();
    while (cur < to.getTime()) {
      const dow = (new Date(cur).getUTCDay() + 6) % 7; // Monday = 0
      const end = Math.min(to.getTime(), cur + (7 - dow) * DAY);
      out.push({ from: new Date(cur), to: new Date(end), label: `${iso(new Date(cur))} to ${iso(new Date(end - DAY))}` });
      cur = end;
    }
  } else if (frequency === 'yearly') {
    if (fy && fy.endDate.toISOString().slice(0, 7) === month) out.push({ from: dayStart(fy.startDate), to: new Date(dayStart(fy.endDate).getTime() + DAY), label: `Financial year ${fy.name}` });
  } else {
    out.push({ from, to, label: monthName(month) });
  }
  return out.filter((p) => p.from.getTime() <= now.getTime());
}

// ---- what each employee did in a period ----------------------------------------------------------------------------------------

const KIND = {
  loan_disbursement: null,
  group_loan_disbursement: 'group',
  personal_loan_disbursement: 'personal',
  business_loan_disbursement: 'business',
  msme_loan_disbursement: 'msme',
};
const byEmployee = { _id: { code: '$employeeCode', branch: '$branch' } };
const COUNTED = ['collection', 'new_group_opening', 'new_member_joining', 'product_sell', ...Object.keys(KIND)];

/**
 * [{ code, branch, count, amount }] for one commission type in one period (amount in paise). Loans, groups and members of the old system count on
 * their real dates; only the collections that were assumed (not really in the file) are left out.
 */
async function activity(type, p) {
  const range = { $gte: p.from, $lt: p.to };
  let rows;
  if (type === 'collection') {
    rows = await EmiPayment.aggregate([
      { $match: { status: 'paid', legacy: { $ne: true }, paidOn: range } },
      { $group: { ...byEmployee, count: { $sum: 1 }, amount: { $sum: '$amountPaise' } } },
    ]);
  } else if (type in KIND) {
    const kind = KIND[type];
    rows = await LoanPayment.aggregate([
      { $match: { status: 'paid', paidOn: range, ...(kind ? { $or: [{ loanType: kind }, { kind }] } : {}) } },
      { $group: { ...byEmployee, count: { $sum: { $size: { $ifNull: ['$lines', []] } } }, amount: { $sum: { $ifNull: ['$totalAmountPaise', 0] } } } },
    ]);
  } else if (type === 'new_group_opening') {
    rows = await Group.aggregate([
      // a group counts from its opening date (an imported group has no creation date of its own)
      { $match: { isDeleted: false, $or: [{ openingDate: range }, { openingDate: { $exists: false }, createdAt: range }] } },
      { $group: { ...byEmployee, count: { $sum: 1 }, amount: { $sum: 0 } } },
    ]);
  } else if (type === 'new_member_joining') {
    rows = await Member.aggregate([
      { $match: { isDeleted: false, joiningDate: range } },
      { $group: { ...byEmployee, count: { $sum: 1 }, amount: { $sum: 0 } } },
    ]);
  } else if (type === 'product_sell') {
    rows = await LoanPayment.aggregate([
      { $match: { status: 'paid', paidOn: range } },
      { $unwind: '$lines' },
      {
        $group: {
          ...byEmployee,
          count: { $sum: { $reduce: { input: { $ifNull: ['$lines.products', []] }, initialValue: 0, in: { $add: ['$$value', { $ifNull: ['$$this.quantity', 0] }] } } } },
          amount: { $sum: { $ifNull: ['$lines.productPaise', 0] } },
        },
      },
    ]);
  } else {
    return null;
  }
  return rows.filter((r) => r._id.code).map((r) => ({ code: String(r._id.code).toUpperCase(), branch: r._id.branch ? String(r._id.branch) : '', count: r.count || 0, amount: r.amount || 0 }));
}

// ---- the rules -------------------------------------------------------------------------------------------------------------------

const effective = (c) => ({
  unit: c.targetUnit || legacyUnit(c.commissionFor),
  basis: c.basis || legacyBasis(c.commissionFor),
  scope: c.scope || 'own',
  frequency: c.frequency || 'monthly',
  appliesTo: c.rateAppliesTo || 'all',
});

/** The active rules of a financial year, one entry per (type, rank, basis, whose activity) with its slabs. The group leader rule is not here. */
async function loadRules(fyId) {
  const docs = await Commission.find({ financialYear: fyId, isDeleted: false, isActive: true, commissionFor: { $nin: ['group_leader', 'employee'] } });
  const map = new Map();
  for (const d of docs) {
    const e = effective(d);
    const key = [d.commissionFor, d.rank || 'all', e.basis, e.scope].join('|');
    if (!map.has(key)) {
      map.set(key, {
        commissionFor: d.commissionFor, rank: d.rank ? String(d.rank) : '', ...e,
        minEligibility: d.minEligibilityValue, maxCommissionPaise: d.maxCommissionPaise, slabs: [],
      });
    }
    map.get(key).slabs.push({ from: d.targetFromPaise ?? 0, to: d.targetToPaise, kind: d.commissionType, value: d.commissionValue });
  }
  return [...map.values()];
}

/** The rules that apply to an employee: those of the employee's rank, and the all-ranks rule for a type the rank has no rule for. */
function rulesFor(rules, user) {
  const rank = user.rank ? String(user.rank) : '';
  const own = rules.filter((r) => rank && r.rank === rank);
  const ownTypes = new Set(own.map((r) => r.commissionFor));
  return [...own, ...rules.filter((r) => !r.rank && !ownTypes.has(r.commissionFor))];
}

/** What an employee achieved for a rule: his own activity, or that of his branches (a supervisor, those he supervises). */
function achieved(rows, rule, user) {
  const mine = String(user.employeeCode).toUpperCase();
  const branches = new Set((user.branches || []).map(String));
  let list;
  if (rule.scope === 'own') list = rows.filter((r) => r.code === mine);
  else if (rule.scope === 'branch') list = rows.filter((r) => r.branch && branches.has(r.branch));
  else if (user.role === 'branch_manager') list = rows.filter((r) => r.branch && branches.has(r.branch));
  else return null; // "supervised branches" belongs to a supervisor only
  return { count: list.reduce((s, r) => s + r.count, 0), amount: list.reduce((s, r) => s + r.amount, 0) };
}

/** Commission of one rule for one achieved measure. A per-unit commission (per loan, per member ...) whose target is an amount pays the unit rate on the units counted. */
function payout(rule, got) {
  const measure = isCountUnit(rule.unit) ? got.count : got.amount;
  const perUnit = ['per_loan', 'per_member', 'per_group', 'per_product'].includes(rule.basis);
  if (perUnit && rule.unit === 'amount') {
    if (rule.minEligibility !== undefined && rule.minEligibility !== null && measure < rule.minEligibility) return { measure, amountPaise: 0, capped: false, breakdown: [] };
    const slab = rule.slabs.find((s) => measure >= s.from && measure <= (s.to ?? Number.POSITIVE_INFINITY));
    let total = slab ? slab.value * got.count : 0;
    const capped = Boolean(rule.maxCommissionPaise && total > rule.maxCommissionPaise);
    if (capped) total = rule.maxCommissionPaise;
    return { measure, amountPaise: total, capped, breakdown: slab ? [{ from: slab.from, units: got.count, rate: slab.value, amountPaise: total }] : [] };
  }
  const r = computeTierCommission({ slabs: rule.slabs, unit: rule.unit, measure, minEligibility: rule.minEligibility, appliesTo: rule.appliesTo, maxCommissionPaise: rule.maxCommissionPaise });
  return { measure, amountPaise: r.amountPaise, capped: r.capped, breakdown: r.breakdown };
}

/**
 * Works out the commission of every employee for a month under the active rules of that month's financial year and saves it
 * (replacing what was generated for that month before).
 */
export async function generateEmployeeCommission(month, by) {
  const fy = await financialYearOf(month);
  const notes = [];
  const summary = { month, financialYear: fy?.name || '', rules: 0, employees: 0, entries: 0, totalPaise: 0, notes };
  if (!fy) {
    notes.push(`No financial year covers ${monthName(month)}. Add it under Admin Master → Financial Year.`);
    return summary;
  }
  const rules = await loadRules(fy._id);
  summary.rules = rules.length;
  if (!rules.length) {
    notes.push(`No active employee commission rule for the financial year ${fy.name}. Add the rules under Admin Master → Commission Master.`);
    await EmployeeCommission.deleteMany({ month });
    return summary;
  }

  const usable = rules.filter((r) => {
    if (COUNTED.includes(r.commissionFor)) return true;
    const label = typeMeta(r.commissionFor)?.label || r.commissionFor;
    if (!notes.some((n) => n.startsWith(label))) notes.push(`${label}: not generated, this software does not track it yet.`);
    return false;
  });
  const users = await User.find({ employeeCode: { $exists: true, $ne: '' } }).select('name employeeCode role rank branches');
  summary.employees = users.length;

  const cache = new Map();
  const entries = [];
  const stats = new Map(); // per rule: how many employees had activity for it, the best measure reached, how many were paid
  for (const rule of usable) {
    for (const p of periodsFor(month, rule.frequency, fy)) {
      const key = `${rule.commissionFor}|${p.from.getTime()}`;
      // eslint-disable-next-line no-await-in-loop
      if (!cache.has(key)) cache.set(key, await activity(rule.commissionFor, p));
      const rows = cache.get(key);
      for (const user of users) {
        if (!rulesFor(rules, user).includes(rule)) continue;
        const got = achieved(rows, rule, user);
        if (!got) continue;
        const r = payout(rule, got);
        const st = stats.get(rule) || { people: 0, best: 0, paid: 0 };
        st.people += 1; st.best = Math.max(st.best, r.measure); if (r.amountPaise >= 1) st.paid += 1;
        stats.set(rule, st);
        if (r.amountPaise < 1) continue;
        entries.push({
          employee: user._id, employeeCode: String(user.employeeCode).toUpperCase(), employeeName: user.name, rank: user.rank, branches: user.branches,
          commissionFor: rule.commissionFor, basis: rule.basis, unit: rule.unit, scope: rule.scope, frequency: rule.frequency,
          month, periodFrom: p.from, periodTo: p.to, periodLabel: p.label,
          measure: r.measure, count: got.count, amountBasePaise: got.amount, amountPaise: r.amountPaise, capped: r.capped, breakdown: r.breakdown, generatedBy: by,
        });
      }
    }
  }
  // a rule that paid nobody says why, so that a 0 is not a mystery
  const fmt = (rule, v) => (isCountUnit(rule.unit) ? `${v} ${rule.unit}` : `₹${(v / 100).toLocaleString('en-IN')}`);
  for (const rule of usable) {
    const st = stats.get(rule);
    if (st && st.paid > 0) continue;
    const label = typeMeta(rule.commissionFor)?.label || rule.commissionFor;
    const who = `${rule.rank ? 'for one rank' : 'for every rank'}, ${rule.scope === 'own' ? 'own work' : rule.scope === 'branch' ? 'work of the branch' : 'work of the supervised branches'}`;
    if (!st) notes.push(`${label} (${who}): paid nobody. No employee with this rule had any activity in ${monthName(month)} (check the rank and branches of the staff, and that the work was done under their employee code).`);
    else if (rule.minEligibility !== undefined && rule.minEligibility !== null && st.best < rule.minEligibility) notes.push(`${label} (${who}): paid nobody. The best result was ${fmt(rule, st.best)} but the minimum is ${fmt(rule, rule.minEligibility)}.`);
    else notes.push(`${label} (${who}): paid nobody. The best result was ${fmt(rule, st.best)} and no slab of the rule covers it.`);
  }
  await EmployeeCommission.deleteMany({ month });
  if (entries.length) await EmployeeCommission.insertMany(entries, { ordered: false });
  summary.entries = entries.length;
  summary.totalPaise = entries.reduce((s, e) => s + e.amountPaise, 0);
  if (!entries.length && !notes.length) notes.push(`No employee earned commission in ${monthName(month)} under these rules (nothing reached the minimum, or there was no activity).`);
  return summary;
}

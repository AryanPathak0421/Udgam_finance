import mongoose from 'mongoose';
import { Commission } from '../models/Commission.js';
import { FinancialYear } from '../models/FinancialYear.js';
import { User } from '../models/User.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { Group } from '../models/Group.js';
import { Member } from '../models/Member.js';
import { Employee } from '../models/Hr.js';
import { EmployeeCommission } from '../models/EmployeeCommission.js';
import { GroupLeaderCommission } from '../models/GroupLeaderCommission.js';
import { legacyUnit, legacyBasis, typeMeta, isCountUnit } from '../config/commissionTypes.js';
import { computeTierCommission } from './tierCommission.js';
import { parseMonth, monthKey } from './groupLeaderCommission.js';
import { todayDateString } from '../utils/http.js';

const DAY = 24 * 3600 * 1000;
const dayStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const monthStart = (m) => new Date(`${m}-01T00:00:00.000Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const monthName = (m) => {
  if (!m || m === 'all') return 'All Months';
  try {
    return monthStart(m).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return m;
  }
};

export function normalizeCode(c) {
  if (!c) return '';
  const s = String(c).trim().toUpperCase();
  const m = s.match(/^EMP0*(\d+)$/i);
  if (m) return `EMP${m[1]}`;
  return s;
}

export function matchesCode(c1, c2) {
  if (!c1 || !c2) return false;
  const s1 = String(c1).trim().toUpperCase();
  const s2 = String(c2).trim().toUpperCase();
  if (s1 === s2) return true;
  return normalizeCode(s1) === normalizeCode(s2);
}

/** The financial year a month falls in (months never cross a financial year). */
export async function financialYearOf(month) {
  if (!month || month === 'all') {
    return FinancialYear.findOne({}).sort({ endDate: -1 });
  }
  const d = monthStart(month);
  let fy = await FinancialYear.findOne({ startDate: { $lte: d }, endDate: { $gte: d } });
  if (!fy) {
    fy = await FinancialYear.findOne({}).sort({ endDate: -1 });
  }
  return fy;
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
  employee: null,
  group_loan_disbursement: 'group',
  personal_loan_disbursement: 'personal',
  business_loan_disbursement: 'business',
  msme_loan_disbursement: 'msme',
};
const COUNTED = ['collection', 'new_group_opening', 'new_member_joining', 'product_sell', 'employee', ...Object.keys(KIND)];

/**
 * [{ code, branch, count, amount }] for one commission type in one period (amount in paise). Loans, groups and members of the old system count on
 * their real dates; only the collections that were assumed (not really in the file) are left out.
 */
async function activity(type, p) {
  const range = { $gte: p.from, $lt: p.to };
  let rows;
  if (type === 'collection') {
    rows = await EmiPayment.aggregate([
      { $match: { status: 'paid', paidOn: range } },
      {
        $project: {
          empCode: {
            $toUpper: {
              $trim: {
                input: {
                  $ifNull: ['$employeeCode', { $ifNull: ['$createdByCode', ''] }],
                },
              },
            },
          },
          branch: 1,
          amountPaise: 1,
        },
      },
      {
        $group: {
          _id: { code: '$empCode', branch: '$branch' },
          count: { $sum: 1 },
          amount: { $sum: { $ifNull: ['$amountPaise', 0] } },
        },
      },
    ]);
  } else if (type in KIND) {
    const kind = KIND[type];
    rows = await LoanPayment.aggregate([
      { $match: { status: 'paid', paidOn: range, ...(kind ? { $or: [{ loanType: kind }, { kind }] } : {}) } },
      {
        $lookup: {
          from: 'loanrequisitions',
          localField: 'requisition',
          foreignField: '_id',
          as: 'reqDoc',
        },
      },
      {
        $project: {
          empCode: {
            $toUpper: {
              $trim: {
                input: {
                  $ifNull: [
                    '$employeeCode',
                    {
                      $ifNull: [
                        '$createdByCode',
                        { $ifNull: [{ $arrayElemAt: ['$reqDoc.employeeCode', 0] }, ''] },
                      ],
                    },
                  ],
                },
              },
            },
          },
          branch: {
            $ifNull: [
              '$branch',
              { $arrayElemAt: ['$reqDoc.branch', 0] },
            ],
          },
          lines: 1,
          totalAmountPaise: 1,
        },
      },
      {
        $group: {
          _id: { code: '$empCode', branch: '$branch' },
          count: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$lines', []] } }, 0] },
                { $size: { $ifNull: ['$lines', []] } },
                1,
              ],
            },
          },
          amount: { $sum: { $ifNull: ['$totalAmountPaise', 0] } },
        },
      },
    ]);
  } else if (type === 'new_group_opening') {
    rows = await Group.aggregate([
      // a group counts from its opening date (an imported group has no creation date of its own)
      { $match: { isDeleted: false, $or: [{ openingDate: range }, { openingDate: { $exists: false }, createdAt: range }] } },
      {
        $project: {
          empCode: {
            $toUpper: {
              $trim: {
                input: {
                  $ifNull: ['$employeeCode', ''],
                },
              },
            },
          },
          branch: 1,
        },
      },
      {
        $group: {
          _id: { code: '$empCode', branch: '$branch' },
          count: { $sum: 1 },
          amount: { $sum: 0 },
        },
      },
    ]);
  } else if (type === 'new_member_joining') {
    rows = await Member.aggregate([
      { $match: { isDeleted: false, joiningDate: range } },
      {
        $project: {
          empCode: {
            $toUpper: {
              $trim: {
                input: {
                  $ifNull: ['$employeeCode', ''],
                },
              },
            },
          },
          branch: 1,
        },
      },
      {
        $group: {
          _id: { code: '$empCode', branch: '$branch' },
          count: { $sum: 1 },
          amount: { $sum: 0 },
        },
      },
    ]);
  } else if (type === 'product_sell') {
    rows = await LoanPayment.aggregate([
      { $match: { status: 'paid', paidOn: range } },
      { $unwind: '$lines' },
      {
        $project: {
          empCode: {
            $toUpper: {
              $trim: {
                input: {
                  $ifNull: ['$employeeCode', { $ifNull: ['$createdByCode', ''] }],
                },
              },
            },
          },
          branch: 1,
          lines: 1,
        },
      },
      {
        $group: {
          _id: { code: '$empCode', branch: '$branch' },
          count: { $sum: { $reduce: { input: { $ifNull: ['$lines.products', []] }, initialValue: 0, in: { $add: ['$$value', { $ifNull: ['$$this.quantity', 0] }] } } } },
          amount: { $sum: { $ifNull: ['$lines.productPaise', 0] } },
        },
      },
    ]);
  } else {
    return null;
  }
  return rows.filter((r) => r._id && r._id.code).map((r) => ({
    code: String(r._id.code).toUpperCase(),
    branch: r._id.branch ? String(r._id.branch) : '',
    count: r.count || 0,
    amount: r.amount || 0,
  }));
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
  let docs = [];
  if (fyId) {
    docs = await Commission.find({ financialYear: fyId, isDeleted: false, isActive: true, commissionFor: { $nin: ['group_leader', 'employee'] } });
  }
  if (!docs.length) {
    docs = await Commission.find({ isDeleted: false, isActive: true, commissionFor: { $nin: ['group_leader', 'employee'] } });
  }
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
  const general = rules.filter((r) => !r.rank && !ownTypes.has(r.commissionFor));
  const combined = [...own, ...general];
  if (combined.length) return combined;
  // Fallback for staff or old/migrated employees without an explicit rank:
  // Match the first active rule for each commission type so they are never excluded
  const fallback = new Map();
  for (const r of rules) {
    if (!fallback.has(r.commissionFor)) fallback.set(r.commissionFor, r);
  }
  return [...fallback.values()];
}

/** What an employee achieved for a rule: his own activity, or that of his branches (a supervisor, those he supervises). */
function achieved(rows, rule, user) {
  const mine = String(user.employeeCode).toUpperCase();
  const branches = new Set((user.branches || []).map(String));
  let list;
  if (rule.scope === 'own') {
    list = rows.filter((r) => matchesCode(r.code, mine));
  } else if (rule.scope === 'branch' || user.role === 'branch_manager') {
    list = rows.filter((r) => (r.branch && branches.has(String(r.branch))) || matchesCode(r.code, mine));
  } else {
    list = rows.filter((r) => (r.branch && branches.has(String(r.branch))) || matchesCode(r.code, mine));
  }
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
  const [users, emps] = await Promise.all([
    User.find({ employeeCode: { $exists: true, $ne: '' } }).select('name employeeCode role rank branches').lean(),
    Employee.find({}).select('name employeeCode branch user designation status').lean(),
  ]);
  const nameMap = new Map();
  const branchMap = new Map();

  users.forEach((u) => {
    const c = String(u.employeeCode).trim().toUpperCase();
    if (u.name) nameMap.set(c, u.name);
    if (u.branches && u.branches.length) {
      if (!branchMap.has(c)) branchMap.set(c, new Set());
      u.branches.forEach((b) => branchMap.get(c).add(String(b)));
    }
  });

  emps.forEach((e) => {
    const c = String(e.employeeCode).trim().toUpperCase();
    if (e.name) nameMap.set(c, e.name);
    if (e.branch) {
      if (!branchMap.has(c)) branchMap.set(c, new Set());
      branchMap.get(c).add(String(e.branch));
    }
  });

  const userCodes = new Set();
  const allStaff = [];

  for (const u of users) {
    const code = String(u.employeeCode).trim().toUpperCase();
    userCodes.add(code);
    const branches = branchMap.has(code) ? Array.from(branchMap.get(code)) : (u.branches || []).map(String);
    allStaff.push({
      _id: u._id,
      name: u.name,
      employeeCode: u.employeeCode,
      role: u.role,
      rank: u.rank,
      branches,
    });
  }

  for (const emp of emps) {
    const code = String(emp.employeeCode).trim().toUpperCase();
    if (!userCodes.has(code)) {
      const branches = branchMap.has(code) ? Array.from(branchMap.get(code)) : (emp.branch ? [String(emp.branch)] : []);
      allStaff.push({
        _id: emp._id,
        name: emp.name,
        employeeCode: emp.employeeCode,
        role: 'field_officer',
        rank: null,
        branches,
      });
      userCodes.add(code);
    }
  }
  summary.employees = allStaff.length;

  const cache = new Map();
  const entries = [];
  const stats = new Map(); // per rule: how many employees had activity for it, the best measure reached, how many were paid
  for (const rule of usable) {
    for (const p of periodsFor(month, rule.frequency, fy)) {
      const key = `${rule.commissionFor}|${p.from.getTime()}`;
      // eslint-disable-next-line no-await-in-loop
      if (!cache.has(key)) cache.set(key, await activity(rule.commissionFor, p));
      const rows = cache.get(key) || [];
      // Also register any old staff codes that had activity in this period
      for (const row of rows) {
        if (row.code && !userCodes.has(row.code)) {
          allStaff.push({
            _id: new mongoose.Types.ObjectId(),
            name: row.code,
            employeeCode: row.code,
            role: 'field_officer',
            rank: null,
            branches: row.branch ? [String(row.branch)] : [],
          });
          userCodes.add(row.code);
        }
      }
      for (const user of allStaff) {
        if (!rulesFor(rules, user).includes(rule)) continue;
        const got = achieved(rows, rule, user);
        if (!got) continue;
        const r = payout(rule, got);
        const st = stats.get(rule) || { people: 0, best: 0, paid: 0 };
        st.people += 1; st.best = Math.max(st.best, r.measure); if (r.amountPaise >= 1) st.paid += 1;
        stats.set(rule, st);
        if (r.amountPaise < 1) continue;
        const empCodeUpper = String(user.employeeCode).toUpperCase();
        entries.push({
          employee: user._id, employeeCode: empCodeUpper, employeeName: nameMap.get(empCodeUpper) || user.name || empCodeUpper, rank: user.rank, branches: user.branches,
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

/**
 * Scans loans, EMIs, groups, members and existing commissions to find all distinct months where data exists.
 */
export async function getDistinctActivityMonths() {
  const monthsSet = new Set();
  const cur = todayDateString().slice(0, 7);
  monthsSet.add(cur);

  try {
    const [loanDates, emiDates, groupDates, memberDates, commMonths, glMonths] = await Promise.all([
      LoanPayment.aggregate([
        { $match: { paidOn: { $exists: true } } },
        { $project: { m: { $substr: [{ $dateToString: { format: '%Y-%m', date: '$paidOn' } }, 0, 7] } } },
        { $group: { _id: '$m' } },
      ]),
      EmiPayment.aggregate([
        { $match: { paidOn: { $exists: true } } },
        { $project: { m: { $substr: [{ $dateToString: { format: '%Y-%m', date: '$paidOn' } }, 0, 7] } } },
        { $group: { _id: '$m' } },
      ]),
      Group.aggregate([
        { $project: { d: { $ifNull: ['$openingDate', '$createdAt'] } } },
        { $match: { d: { $exists: true, $ne: null } } },
        { $project: { m: { $substr: [{ $dateToString: { format: '%Y-%m', date: '$d' } }, 0, 7] } } },
        { $group: { _id: '$m' } },
      ]),
      Member.aggregate([
        { $project: { d: { $ifNull: ['$joiningDate', '$createdAt'] } } },
        { $match: { d: { $exists: true, $ne: null } } },
        { $project: { m: { $substr: [{ $dateToString: { format: '%Y-%m', date: '$d' } }, 0, 7] } } },
        { $group: { _id: '$m' } },
      ]),
      EmployeeCommission.distinct('month'),
      GroupLeaderCommission.distinct('month'),
    ]);

    loanDates.forEach((r) => { if (r._id && /^\d{4}-\d{2}$/.test(r._id)) monthsSet.add(r._id); });
    emiDates.forEach((r) => { if (r._id && /^\d{4}-\d{2}$/.test(r._id)) monthsSet.add(r._id); });
    groupDates.forEach((r) => { if (r._id && /^\d{4}-\d{2}$/.test(r._id)) monthsSet.add(r._id); });
    memberDates.forEach((r) => { if (r._id && /^\d{4}-\d{2}$/.test(r._id)) monthsSet.add(r._id); });
    commMonths.forEach((m) => { if (m && /^\d{4}-\d{2}$/.test(m)) monthsSet.add(m); });
    glMonths.forEach((m) => { if (m && /^\d{4}-\d{2}$/.test(m)) monthsSet.add(m); });
  } catch (err) {
    // Non-fatal, fallback to collected set
  }

  return Array.from(monthsSet).filter(Boolean).sort().reverse();
}

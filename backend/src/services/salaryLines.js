import { EmployeeCommission } from '../models/EmployeeCommission.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { Salary } from '../models/Hr.js';

/**
 * The lines of a salary slip. Receive side: the fixed components of the salary (set in Set Salary) and what is earned on top of them
 * (loan incentive, product sell incentive, GRT commission, senior commission, NPA recovery 10%, bonus). Payment side: PF, ESI, professional tax,
 * advance, leave (the pay cut for the days not worked), recovery, security and other deduction.
 * A line that was changed by hand on the slip (manual) is kept when the salary is generated again.
 */
export const EARN_FIXED = [
  ['basic', 'Basic'], ['hra', 'HRA'], ['ta', 'TA'], ['allowance', 'Allowance'], ['da', 'DA'], ['fuel', 'Fuel'], ['transport', 'Transport allowance'], ['bike', 'Bike repair'], ['otherAllowance', 'Other allowance'],
];
export const EARN_AUTO = [
  ['commission', 'Commission (auto)'], ['loanIncentive', 'Loan incentive (auto)'], ['productIncentive', 'Product sell incentive'], ['grt', 'GRT commission (new group)'], ['senior', 'Senior commission (supervisor)'], ['npaRecovery', 'NPA recovery 10% (auto)'], ['bonus', 'Bonus / addition'],
];
export const DEDUCTIONS = [
  ['pf', 'PF'], ['esi', 'ESI'], ['profTax', 'Professional tax'], ['advance', 'Advance deduction'], ['leave', 'Absent / unpaid days (auto)'], ['recovery', 'Recovery amount'], ['security', 'Security amount'], ['other', 'Other deduction'],
];
export const ALL_LINES = [...EARN_FIXED.map(([k, l]) => [k, l, 'earn']), ...EARN_AUTO.map(([k, l]) => [k, l, 'earn']), ...DEDUCTIONS.map(([k, l]) => [k, l, 'ded'])];
export const NPA_RECOVERY_SHARE = 0.1;

const LOAN_TYPES = new Set(['loan_disbursement', 'group_loan_disbursement', 'personal_loan_disbursement', 'business_loan_disbursement', 'msme_loan_disbursement', 'collection', 'npa_recovery', 'employee']);
const sum = (a) => a.reduce((s, x) => s + x, 0);

/** The fixed components of an employee (an employee with only a monthly salary has it all as Basic). */
export function fixedOf(emp, month) {
  const st = emp.salaryStructure || {};
  const out = Object.fromEntries(EARN_FIXED.map(([k]) => [k, st[k] || 0]));
  if (!sum(Object.values(out)) && emp.monthlySalaryPaise) out.basic = emp.monthlySalaryPaise;
  // the Basic of a slip with the yearly increase (only the Basic grows)
  if (month) {
    const n = yearlyIncrements(emp, month);
    const pct = emp.yearlyIncrementPercent ?? 10;
    if (n > 0 && pct > 0 && out.basic > 0) out.basic = Math.round(out.basic * (1 + pct / 100) ** n);
  }
  return out;
}

/** The fields of a salary set-up (Set Salary), kept by month. */
export const SETUP_KEYS = ['salaryStructure', 'monthlySalaryPaise', 'pfPercent', 'esiPercent', 'professionalTaxPaise', 'advanceDeductionPaise', 'securityAmountPaise', 'securityMonths', 'securityNeverEnds', 'yearlyIncrementPercent', 'pfDeduction', 'esiDeduction'];
/** The employee with the salary set-up that holds for a month: the latest one made for that month or before it. */
export function setupAt(emp, month) {
  const hist = (emp.salaryHistory || []).filter((h) => h.month <= month).sort((a, b) => a.month.localeCompare(b.month));
  const h = hist[hist.length - 1];
  if (!h) return emp;
  const out = { ...emp, setupMonth: h.month };
  SETUP_KEYS.forEach((k) => { if (h[k] !== undefined && h[k] !== null) out[k] = h[k]; });
  return out;
}

/**
 * The Basic grows by itself automatically every year from the employee's joining date
 * by the yearly increase percentage (10% unless set otherwise).
 * Calculates how many completed 1-year anniversaries have occurred up to and including the salary slip month.
 */
export function yearlyIncrements(emp, month) {
  if (!month) return 0;
  const rawJoin = emp.joiningDate || emp.createdAt;
  if (!rawJoin) return 0;
  const joinDate = new Date(rawJoin);
  if (isNaN(joinDate.getTime())) return 0;

  const joinY = joinDate.getUTCFullYear();
  const joinM = joinDate.getUTCMonth() + 1; // 1 to 12

  const [targetY, targetM] = month.split('-').map(Number);
  if (!targetY || !targetM) return 0;

  let startY = joinY;
  let startM = joinM;

  if (emp.setupMonth && emp.setupMonth !== '0000-00') {
    const [sY, sM] = emp.setupMonth.split('-').map(Number);
    if (sY && sM && (sY > joinY || (sY === joinY && sM > joinM))) {
      startY = sY;
      startM = sM;
    }
  }

  let n = 0;
  for (let y = startY; y <= targetY; y += 1) {
    const anniversary = `${y}-${String(joinM).padStart(2, '0')}`;
    const startIso = `${startY}-${String(startM).padStart(2, '0')}`;
    if (anniversary > startIso && anniversary <= month) {
      n += 1;
    }
  }
  return n;
}

/** Whether the employee's verification is complete: mobile and email (when there is one) by OTP, and the documents. */
export const isVerified = (e) => (!e.mobile || Boolean(e.mobileVerifiedAt)) && (!e.email || Boolean(e.emailVerifiedAt)) && Boolean(e.documentsVerifiedAt);

/**
 * What the month earned from outside the fixed salary, per employee code: from the commissions generated for the month (Commission Generate) and
 * 10% of what was recovered on NPA loans (NPA payment) in the month.
 */
export async function loadVariable(month, range, codes, supervisorCodes) {
  const cleanCodes = (codes || []).filter(Boolean).map((c) => String(c).trim());
  const upperCodes = cleanCodes.map((c) => c.toUpperCase());
  const allCodes = [...new Set([...cleanCodes, ...upperCodes])];
  const [coms, npa, prior] = await Promise.all([
    EmployeeCommission.find({ month, employeeCode: { $in: allCodes } }).select('employeeCode commissionFor scope amountPaise').lean(),
    EmiPayment.aggregate([{ $match: { status: 'paid', npa: true, paidOn: { $gte: range.from, $lte: range.to }, employeeCode: { $in: allCodes } } }, { $group: { _id: '$employeeCode', t: { $sum: '$amountPaise' } } }]),
    Salary.aggregate([{ $match: { month: { $ne: month } } }, { $group: { _id: '$employee', t: { $sum: { $ifNull: ['$securityCutPaise', 0] } } } }]),
  ]);
  const by = new Map();
  const get = (code) => {
    const k = String(code || '').toUpperCase();
    if (!by.has(k)) by.set(k, { commission: 0, loanIncentive: 0, productIncentive: 0, grt: 0, senior: 0, npaRecovery: 0 });
    return by.get(k);
  };
  const supSet = new Set([...(supervisorCodes || [])].map((c) => String(c).toUpperCase()));
  coms.forEach((c) => {
    const v = get(c.employeeCode);
    v.commission += c.amountPaise;
    if (c.scope === 'supervised') { if (supSet.has(String(c.employeeCode).toUpperCase())) v.senior += c.amountPaise; return; }
    if (c.commissionFor === 'product_sell') v.productIncentive += c.amountPaise;
    else if (c.commissionFor === 'new_group_opening' || c.commissionFor === 'new_member_joining') v.grt += c.amountPaise;
    else if (LOAN_TYPES.has(c.commissionFor)) v.loanIncentive += c.amountPaise;
  });
  npa.forEach((r) => { get(r._id).npaRecovery = Math.round(r.t * NPA_RECOVERY_SHARE); });
  return { by, securityCut: new Map(prior.map((r) => [String(r._id), r.t])) };
}

/**
 * The lines of one employee's slip for a month. `ratio` is payable days / days in the month; `variable` what loadVariable gave for the employee;
 * `kept` the lines changed by hand on the slip that is being generated again.
 */
export function buildLines(emp, ratio, variable, priorSecurity, kept = new Map(), month) {
  const fixed = fixedOf(emp, month);
  const grown = month ? yearlyIncrements(emp, month) : 0;
  const pct = emp.yearlyIncrementPercent ?? 10;
  const gross = sum(Object.values(fixed));
  const r = Math.min(Math.max(ratio, 0), 1);
  const basicEarned = fixed.basic * r;
  const secAmount = emp.securityAmountPaise || 0;
  const months = Math.min(Math.max(emp.securityMonths || 1, 1), 5);
  // the security is cut in 1 to 5 equal months, or (never ends) the security amount is cut every month
  const secCut = !secAmount || !isVerified(emp) ? 0 : emp.securityNeverEnds ? secAmount : Math.max(Math.min(Math.ceil(secAmount / months), secAmount - priorSecurity), 0);
  const auto = {
    ...fixed,
    commission: variable?.commission || 0, loanIncentive: variable?.loanIncentive || 0, productIncentive: variable?.productIncentive || 0, grt: variable?.grt || 0, senior: variable?.senior || 0, npaRecovery: variable?.npaRecovery || 0, bonus: 0,
    pf: emp.pfDeduction ? Math.round((basicEarned * (emp.pfPercent ?? 12)) / 100) : 0,
    esi: emp.esiDeduction ? Math.round((basicEarned * (emp.esiPercent ?? 0.75)) / 100) : 0,
    profTax: emp.professionalTaxPaise || 0, advance: emp.advanceDeductionPaise || 0, leave: Math.round(gross * (1 - r)), recovery: 0, security: secCut, other: 0,
  };
  return ALL_LINES.map(([key, label, side]) => {
    const manual = kept.has(key);
    return { key, label: key === 'basic' && grown > 0 && pct > 0 ? `Basic (+${pct}% a year, ${grown} time${grown === 1 ? '' : 's'})` : label, side, amountPaise: manual ? kept.get(key) : auto[key] || 0, manual };
  });
}

/** Totals of a slip from its lines, in the fields the slip lists use. */
export function totalsOf(lines) {
  const side = (s) => sum(lines.filter((l) => l.side === s).map((l) => l.amountPaise));
  const line = (k) => lines.find((l) => l.key === k)?.amountPaise || 0;
  const totalEarning = side('earn');
  const totalDeduction = side('ded');
  const fixedTotal = sum(EARN_FIXED.map(([k]) => line(k)));
  return {
    totalEarningPaise: totalEarning, totalDeductionPaise: totalDeduction, netPaise: Math.max(totalEarning - totalDeduction, 0),
    grossPaise: fixedTotal, bonusPaise: line('bonus'), earnedPaise: totalEarning - line('bonus'), otherDeductionPaise: totalDeduction, securityCutPaise: line('security'),
  };
}

/** A slip made before the lines existed: its lines from the old figures. */
export function legacyLines(s) {
  const pick = { basic: s.grossPaise || 0, leave: Math.max((s.grossPaise || 0) - (s.earnedPaise || 0), 0), bonus: s.bonusPaise || 0, other: s.otherDeductionPaise || 0 };
  return ALL_LINES.map(([key, label, side]) => ({ key, label, side, amountPaise: pick[key] || 0, manual: false }));
}

// Loan schedule engine. Pure functions, integer paise, no I/O — the Loans module will
// reuse this so the calculator screen and real loans always agree.

const DAY_MS = 24 * 60 * 60 * 1000;

const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);

// Adds whole months keeping the day-of-month, clamped to the last day (31 Jan + 1m = 28/29 Feb).
function addMonths(d, n) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

// perYear = number of installments in a year; unit = what one term step is called.
// A daily loan is collected every working day: the company is off on Sunday, so no installment falls on a Sunday (the next day takes it).
export const skipSundays = (s, k) => {
  let d = new Date(s.getTime());
  if (d.getUTCDay() === 0) d = addDays(d, 1);
  for (let i = 0; i < k; i += 1) {
    d = addDays(d, 1);
    if (d.getUTCDay() === 0) d = addDays(d, 1);
  }
  return d;
};

// Sunday is the weekly off; any installment that would fall on Sunday moves to Monday.
const skipIfSunday = (d) => (d.getUTCDay() === 0 ? addDays(d, 1) : d);

export const MODES = {
  daily: { label: 'Daily', unit: 'day', perYear: 365, next: (s, k) => skipSundays(s, k) },
  weekly: { label: 'Weekly', unit: 'week', perYear: 52, next: (s, k) => skipIfSunday(addDays(s, 7 * k)) },
  biweekly: { label: 'Bi-weekly (fortnightly)', unit: 'fortnight', perYear: 26, next: (s, k) => skipIfSunday(addDays(s, 14 * k)) },
  monthly: { label: 'Monthly', unit: 'month', perYear: 12, next: (s, k) => skipIfSunday(addMonths(s, k)) },
  quarterly: { label: 'Quarterly', unit: 'quarter', perYear: 4, next: (s, k) => skipIfSunday(addMonths(s, 3 * k)) },
  halfyearly: { label: 'Half-yearly', unit: 'half-year', perYear: 2, next: (s, k) => skipIfSunday(addMonths(s, 6 * k)) },
  yearly: { label: 'Yearly', unit: 'year', perYear: 1, next: (s, k) => skipIfSunday(addMonths(s, 12 * k)) },
};

export const CALCULATION_TYPES = ['flat', 'reducing'];
// equal: same installment every period (EMI). equal_principal: same principal every period,
// interest on the outstanding balance, so installments decline. Only meaningful for reducing.
export const EMI_TYPES = ['equal', 'equal_principal'];
export const MAX_INSTALLMENTS = 1500;
export const MAX_YEARS = 30;
export const MIN_PER_INSTALLMENT = 100; // paise: at least ₹1 of principal per installment
// Installment rounding choices, in rupees (0 = exact amount).
export const ROUNDING_RUPEES = [0, 1, 5, 10];

/**
 * @param {object} p
 * @param {number} p.principalPaise   loan amount, integer paise
 * @param {number} p.annualRateBp     annual interest rate in basis points (12.5% = 1250)
 * @param {'flat'|'reducing'} p.calculationType
 * @param {'equal'|'equal_principal'} [p.emiType='equal']  installment pattern (reducing only)
 * @param {keyof MODES} p.mode        repayment frequency
 * @param {number} p.term             number of installments (days for daily, weeks for weekly …)
 * @param {Date} p.startDate          disbursement date (first due date is one period later)
 * @param {number} [p.roundingPaise=0] round the installment to the nearest multiple of this many paise
 *                                      (100 = whole rupee). 0 keeps the exact amount.
 */
export function calculateLoan({
  principalPaise: P,
  annualRateBp: rBp,
  calculationType,
  mode,
  term: n,
  startDate,
  emiType = 'equal',
  roundingPaise = 0,
}) {
  const m = MODES[mode];
  const rows = [];

  // Guarantees every installment carries a non-negative principal part (see MIN_PER_INSTALLMENT).
  if (P < n * MIN_PER_INSTALLMENT) throw new RangeError('Loan amount is too small for this number of installments');

  if (calculationType === 'flat') {
    // Interest on the ORIGINAL principal for the whole term: P × rate × (n / perYear).
    const num = BigInt(P) * BigInt(rBp) * BigInt(n);
    const den = BigInt(m.perYear) * 10000n;
    const rawInterest = Number((num * 2n + den) / (den * 2n)); // round half up
    const rawTotal = P + rawInterest;

    let instBase;
    let total;
    let interest;
    if (roundingPaise > 0) {
      // Collect a round installment every time; the interest is whatever that makes it.
      // (₹10,000 @ 60.85 % for 120 days is ₹100.0046 a day -> exactly ₹100.)
      instBase = Math.round(rawTotal / n / roundingPaise) * roundingPaise;
      if (instBase * n < P) instBase = Math.ceil(P / n / roundingPaise) * roundingPaise; // never below principal
      total = instBase * n;
      interest = total - P;
    } else {
      // Exact: equal installments, the last one absorbs the paise remainder.
      instBase = Math.floor(rawTotal / n);
      total = rawTotal;
      interest = rawInterest;
    }

    // Interest is spread by cumulative rounding so the parts always add up exactly.
    let prevCum = 0;
    for (let k = 1; k <= n; k += 1) {
      const last = k === n;
      const cum = last ? interest : Number((BigInt(interest) * BigInt(k)) / BigInt(n));
      const interestPart = cum - prevCum;
      prevCum = cum;
      const installment = last ? total - instBase * (n - 1) : instBase;
      rows.push({ no: k, principal: installment - interestPart, interest: interestPart, installment });
    }  } else {
    // Reducing balance: interest is charged on the outstanding balance each period.
    const i = rBp / 10000 / m.perYear;
    const equalPrincipal = emiType === 'equal_principal';
    const emiRaw = i === 0 ? P / n : (P * i) / (1 - (1 + i) ** -n);
    const emi = roundingPaise > 0 ? Math.round(emiRaw / roundingPaise) * roundingPaise : Math.round(emiRaw);
    // Equal principal: whole-step principal each period, the last one takes the remainder.
    const prinBase = roundingPaise > 0 && P / n >= roundingPaise ? Math.floor(P / n / roundingPaise) * roundingPaise : Math.floor(P / n);
    let balance = P;
    for (let k = 1; k <= n; k += 1) {
      const last = k === n;
      const interestPart = Math.round(balance * i);
      let principal;
      if (last) principal = balance; // clears the balance exactly
      else if (equalPrincipal) principal = Math.min(balance, prinBase);
      else principal = Math.min(balance, Math.max(emi - interestPart, 0));
      balance -= principal;
      rows.push({ no: k, principal, interest: interestPart, installment: principal + interestPart, balance });
    }
  }
  // Running balance and due dates.
  let outstanding = P;
  const schedule = rows.map((r) => {
    outstanding -= r.principal;
    let due = m.next(startDate, r.no);
    if (due.getUTCDay() === 0) due = addDays(due, 1);
    return { ...r, balance: outstanding, dueDate: due };
  });

  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  return {
    installments: n,
    installmentAmount: schedule[0].installment, // regular installment (last one may differ by paise)
    lastInstallmentAmount: schedule[schedule.length - 1].installment,
    totalInterest,
    totalPayable: P + totalInterest,
    firstDueDate: schedule[0].dueDate,
    lastDueDate: schedule[schedule.length - 1].dueDate,
    schedule,
  };
}




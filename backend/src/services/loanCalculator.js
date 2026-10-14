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
export const MODES = {
  daily: { label: 'Daily', unit: 'day', perYear: 365, next: (s, k) => addDays(s, k) },
  weekly: { label: 'Weekly', unit: 'week', perYear: 52, next: (s, k) => addDays(s, 7 * k) },
  biweekly: { label: 'Bi-weekly (fortnightly)', unit: 'fortnight', perYear: 26, next: (s, k) => addDays(s, 14 * k) },
  monthly: { label: 'Monthly', unit: 'month', perYear: 12, next: (s, k) => addMonths(s, k) },
  quarterly: { label: 'Quarterly', unit: 'quarter', perYear: 4, next: (s, k) => addMonths(s, 3 * k) },
  halfyearly: { label: 'Half-yearly', unit: 'half-year', perYear: 2, next: (s, k) => addMonths(s, 6 * k) },
  yearly: { label: 'Yearly', unit: 'year', perYear: 1, next: (s, k) => addMonths(s, 12 * k) },
};

export const CALCULATION_TYPES = ['flat', 'reducing'];
export const MAX_INSTALLMENTS = 1500;
export const MAX_YEARS = 30;
export const MIN_PER_INSTALLMENT = 100; // paise: at least ₹1 of principal per installment

/**
 * @param {object} p
 * @param {number} p.principalPaise   loan amount, integer paise
 * @param {number} p.annualRateBp     annual interest rate in basis points (12.5% = 1250)
 * @param {'flat'|'reducing'} p.calculationType
 * @param {keyof MODES} p.mode        repayment frequency
 * @param {number} p.term             number of installments (days for daily, weeks for weekly …)
 * @param {Date} p.startDate          disbursement date (first due date is one period later)
 */
export function calculateLoan({ principalPaise: P, annualRateBp: rBp, calculationType, mode, term: n, startDate }) {
  const m = MODES[mode];
  const rows = [];

  // Guarantees every installment carries a non-negative principal part (see MIN_PER_INSTALLMENT).
  if (P < n * MIN_PER_INSTALLMENT) throw new RangeError('Loan amount is too small for this number of installments');

  if (calculationType === 'flat') {
    // Interest on the ORIGINAL principal for the whole term: P × rate × (n / perYear).
    const num = BigInt(P) * BigInt(rBp) * BigInt(n);
    const den = BigInt(m.perYear) * 10000n;
    const interest = Number((num * 2n + den) / (den * 2n)); // round half up
    const total = P + interest;

    // Every installment is the same rounded amount; the last one absorbs the paise remainder.
    // Interest is spread by cumulative rounding so the parts always add up exactly.
    const instBase = Math.floor(total / n);
    let prevCum = 0;
    for (let k = 1; k <= n; k += 1) {
      const last = k === n;
      const cum = last ? interest : Number((BigInt(interest) * BigInt(k)) / BigInt(n));
      const interestPart = cum - prevCum;
      prevCum = cum;
      const installment = last ? total - instBase * (n - 1) : instBase;
      rows.push({ no: k, principal: installment - interestPart, interest: interestPart, installment });
    }
  } else {
    // Reducing balance: equal installments, interest charged on the outstanding balance.
    const i = rBp / 10000 / m.perYear;
    const emi = i === 0 ? Math.round(P / n) : Math.round((P * i) / (1 - (1 + i) ** -n));
    let balance = P;
    for (let k = 1; k <= n; k += 1) {
      const last = k === n;
      const interestPart = Math.round(balance * i);
      const principal = last ? balance : Math.min(balance, Math.max(emi - interestPart, 0));
      balance -= principal;
      rows.push({ no: k, principal, interest: interestPart, installment: principal + interestPart, balance });
    }
  }

  // Running balance and due dates.
  let outstanding = P;
  const schedule = rows.map((r) => {
    outstanding -= r.principal;
    return { ...r, balance: outstanding, dueDate: m.next(startDate, r.no) };
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

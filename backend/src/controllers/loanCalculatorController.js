import {
  calculateLoan,
  MODES,
  CALCULATION_TYPES,
  MAX_INSTALLMENTS,
  MAX_YEARS,
  MIN_PER_INSTALLMENT,
} from '../services/loanCalculator.js';
import { createValidator, parseDateOnly } from '../utils/http.js';
import { toMinor } from '../utils/money.js';

const MAX_PRINCIPAL_PAISE = 100_000_000 * 100; // ₹10 crore per loan
const MAX_RATE_BP = 10_000; // 100 % p.a.

const iso = (d) => d.toISOString().slice(0, 10);
const rupees = (paise) => paise / 100;

export function getLoanCalculatorOptions(_req, res) {
  res.json({
    calculationTypes: [
      { value: 'flat', label: 'Flat' },
      { value: 'reducing', label: 'Reducing balance' },
    ],
    modes: Object.entries(MODES).map(([value, m]) => ({ value, label: m.label, unit: m.unit, perYear: m.perYear })),
    limits: { maxInstallments: MAX_INSTALLMENTS, maxYears: MAX_YEARS },
  });
}

export function runLoanCalculator(req, res) {
  const b = req.body || {};
  const v = createValidator();

  const calculationType = String(b.calculationType || '');
  if (!CALCULATION_TYPES.includes(calculationType)) v.add('calculationType', 'Select flat or reducing');

  const mode = String(b.mode || '');
  const m = MODES[mode];
  if (!m) v.add('mode', 'Select a loan mode');

  const principalPaise = toMinor(b.amount);
  if (principalPaise === null || principalPaise < 100 || principalPaise > MAX_PRINCIPAL_PAISE) {
    v.add('amount', 'Enter a loan amount between ₹1 and ₹10,00,00,000 (up to 2 decimals)');
  }

  const annualRateBp = toMinor(b.rate);
  if (annualRateBp === null || annualRateBp > MAX_RATE_BP) v.add('rate', 'Enter an annual rate from 0 to 100 (up to 2 decimals)');

  const term = Number(b.term);
  if (!Number.isInteger(term) || term < 1) v.add('term', 'Enter a whole number of 1 or more');
  else if (term > MAX_INSTALLMENTS) v.add('term', `Term cannot exceed ${MAX_INSTALLMENTS} installments`);
  else if (m && term / m.perYear > MAX_YEARS) v.add('term', `Loan duration cannot exceed ${MAX_YEARS} years`);
  else if (principalPaise !== null && principalPaise < term * MIN_PER_INSTALLMENT) {
    v.add('amount', `Loan amount must be at least ₹${term} (₹1 per installment) for this term`);
  }

  let startDate = new Date();
  startDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  if (b.startDate !== undefined && b.startDate !== null && b.startDate !== '') {
    const parsed = parseDateOnly(String(b.startDate));
    if (!parsed) v.add('startDate', 'Enter a valid date');
    else startDate = parsed;
  }
  v.throwIfAny();

  const r = calculateLoan({ principalPaise, annualRateBp, calculationType, mode, term, startDate });
  res.json({
    input: {
      calculationType,
      mode,
      modeLabel: m.label,
      termUnit: m.unit,
      amount: rupees(principalPaise),
      rate: annualRateBp / 100,
      term,
      startDate: iso(startDate),
    },
    summary: {
      installments: r.installments,
      installmentAmount: rupees(r.installmentAmount),
      lastInstallmentAmount: rupees(r.lastInstallmentAmount),
      totalInterest: rupees(r.totalInterest),
      totalPayable: rupees(r.totalPayable),
      firstDueDate: iso(r.firstDueDate),
      lastDueDate: iso(r.lastDueDate),
    },
    schedule: r.schedule.map((s) => ({
      no: s.no,
      dueDate: iso(s.dueDate),
      principal: rupees(s.principal),
      interest: rupees(s.interest),
      installment: rupees(s.installment),
      balance: rupees(s.balance),
    })),
  });
}

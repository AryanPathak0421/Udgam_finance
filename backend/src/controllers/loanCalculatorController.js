import mongoose from 'mongoose';
import {
  calculateLoan,
  MODES,
  CALCULATION_TYPES,
  EMI_TYPES,
  MAX_INSTALLMENTS,
  MAX_YEARS,
  MIN_PER_INSTALLMENT,
  ROUNDING_RUPEES,
} from '../services/loanCalculator.js';
import { LoanScheme } from '../models/LoanScheme.js';
import { createValidator, parseDateOnly } from '../utils/http.js';
import { toMinor } from '../utils/money.js';

const MAX_PRINCIPAL_PAISE = 100_000_000 * 100; // ₹10 crore per loan
const MAX_RATE_BP = 10_000; // 100 % p.a.

// Duration of one installment in days, on the same 30-day-month basis as scheme terms.
const MODE_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, halfyearly: 180, yearly: 360 };
const UNIT_DAYS = { days: 1, weeks: 7, months: 30 };

const iso = (d) => d.toISOString().slice(0, 10);
const rupees = (paise) => paise / 100;

// percentage charges are held in basis points, fixed charges in paise; both integers.
function chargeAmount(charge, principalPaise) {
  if (charge.type === 'fixed') return charge.value;
  const num = BigInt(principalPaise) * BigInt(charge.value);
  return Number((num * 2n + 10000n) / 20000n); // round half up
}

export function getLoanCalculatorOptions(_req, res) {
  res.json({
    calculationTypes: [
      { value: 'flat', label: 'Flat' },
      { value: 'reducing', label: 'Reducing balance' },
    ],
    emiTypes: [
      { value: 'equal', label: 'Equal installments (EMI)' },
      { value: 'equal_principal', label: 'Equal principal (declining installments)' },
    ],
    roundingOptions: ROUNDING_RUPEES.map((v) => ({ value: v, label: v === 0 ? 'No rounding (exact)' : `Nearest ₹${v}` })),
    modes: Object.entries(MODES).map(([value, m]) => ({ value, label: m.label, unit: m.unit, perYear: m.perYear })),
    limits: { maxInstallments: MAX_INSTALLMENTS, maxYears: MAX_YEARS },
  });
}

export async function runLoanCalculator(req, res) {
  const b = req.body || {};
  const v = createValidator();

  // Optional scheme: its calculation type, EMI type and limits then govern the loan.
  let scheme = null;
  if (b.schemeId) {
    if (!mongoose.isValidObjectId(String(b.schemeId))) v.add('schemeId', 'Select a valid loan scheme');
    else {
      scheme = await LoanScheme.findOne({ _id: b.schemeId, isDeleted: false });
      if (!scheme) v.add('schemeId', 'Loan scheme not found');
      else if (!scheme.isActive) v.add('schemeId', 'This loan scheme is inactive');
    }
  }

  const calculationType = scheme ? scheme.calculationType : String(b.calculationType || '');
  if (!CALCULATION_TYPES.includes(calculationType)) v.add('calculationType', 'Select flat or reducing');

  let emiType = scheme ? scheme.emiType : String(b.emiType || 'equal');
  if (!EMI_TYPES.includes(emiType)) v.add('emiType', 'Select an EMI type');
  if (calculationType === 'flat') emiType = 'equal';

  // Installments are rounded to whole rupees by default; a scheme can choose its own step.
  const rounding = scheme ? scheme.installmentRounding ?? 1 : Number(b.rounding === undefined || b.rounding === '' ? 1 : b.rounding);
  if (!ROUNDING_RUPEES.includes(rounding)) v.add('rounding', 'Choose no rounding, ₹1, ₹5 or ₹10');

  const mode = String(b.mode || '');
  const m = MODES[mode];
  if (!m) v.add('mode', 'Select a loan mode');
  else if (scheme && !scheme.modes.includes(mode)) {
    v.add('mode', `${scheme.name} allows: ${scheme.modes.map((x) => MODES[x].label).join(', ')}`);
  }

  const principalPaise = toMinor(b.amount);
  if (principalPaise === null || principalPaise < 100 || principalPaise > MAX_PRINCIPAL_PAISE) {
    v.add('amount', 'Enter a loan amount between ₹1 and ₹10,00,00,000 (up to 2 decimals)');
  } else if (scheme && (principalPaise < scheme.amountMinPaise || principalPaise > scheme.amountMaxPaise)) {
    v.add('amount', `${scheme.name} allows ₹${scheme.amountMinPaise / 100} to ₹${scheme.amountMaxPaise / 100}`);
  }

  const annualRateBp = toMinor(b.rate);
  if (annualRateBp === null || annualRateBp > MAX_RATE_BP) v.add('rate', 'Enter an annual rate from 0 to 100 (up to 2 decimals)');
  else if (scheme && (annualRateBp < scheme.roiMinBp || annualRateBp > scheme.roiMaxBp)) {
    v.add('rate', `${scheme.name} allows ${scheme.roiMinBp / 100}% to ${scheme.roiMaxBp / 100}%`);
  }

  const term = Number(b.term);
  if (!Number.isInteger(term) || term < 1) v.add('term', 'Enter a whole number of 1 or more');
  else if (term > MAX_INSTALLMENTS) v.add('term', `Term cannot exceed ${MAX_INSTALLMENTS} installments`);
  else if (m && term / m.perYear > MAX_YEARS) v.add('term', `Loan duration cannot exceed ${MAX_YEARS} years`);
  else if (principalPaise !== null && principalPaise < term * MIN_PER_INSTALLMENT) {
    v.add('amount', `Loan amount must be at least ₹${term} (₹1 per installment) for this term`);
  } else if (scheme && m) {
    const days = term * MODE_DAYS[mode];
    const lo = scheme.termMin * UNIT_DAYS[scheme.termUnit];
    const hi = scheme.termMax * UNIT_DAYS[scheme.termUnit];
    if (days < lo || days > hi) {
      v.add('term', `${scheme.name} allows ${scheme.termMin}–${scheme.termMax} ${scheme.termUnit}; this term is about ${days} days`);
    }
  }

  let startDate = new Date();
  startDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  if (b.startDate !== undefined && b.startDate !== null && b.startDate !== '') {
    const parsed = parseDateOnly(String(b.startDate));
    if (!parsed) v.add('startDate', 'Enter a valid date');
    else startDate = parsed;
  }
  v.throwIfAny();

  const r = calculateLoan({ principalPaise, annualRateBp, calculationType, emiType, mode, term, startDate, roundingPaise: rounding * 100 });

  const charges = scheme
    ? {
        processingFee: rupees(chargeAmount(scheme.processingFee, principalPaise)),
        cost: rupees(chargeAmount(scheme.cost, principalPaise)),
        securityAmount: rupees(chargeAmount({ type: 'percentage', value: scheme.securityBp }, principalPaise)),
        securityType: scheme.securityType,
        gracePeriodDays: scheme.gracePeriodDays ?? 0,
        fine: {
          type: scheme.fine?.type || 'fixed',
          value: (scheme.fine?.value || 0) / 100, // percent for percentage, rupees for fixed
          counting: scheme.fine?.counting || 'per_day',
        },
      }
    : null;

  res.json({
    input: {
      calculationType,
      emiType,
      mode,
      modeLabel: m.label,
      termUnit: m.unit,
      rounding,
      amount: rupees(principalPaise),
      rate: annualRateBp / 100,
      term,
      startDate: iso(startDate),
      scheme: scheme ? { id: scheme._id, code: scheme.code, name: scheme.name } : null,
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
    charges,
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




// Group leader commission engine. Pure functions, integer paise, no I/O.
//
// Rule (from the business spec):
//   - commission is paid to the group leader, per group
//   - a fixed amount per disbursed loan, per month (e.g. ₹25)
//   - for a fixed number of months after disbursement (e.g. 4)
//   - the month the loan is disbursed earns nothing; payment starts the next month
//
// The Loans module will feed real disbursement counts into this same function so the
// preview screen and the monthly report always agree.

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const parseMonth = (s) => {
  const m = MONTH_RE.exec(String(s));
  return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : null;
};

export const monthKey = (index) => {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
};

/**
 * @param {object} p
 * @param {{month: string, loans: number}[]} p.disbursements  loans disbursed in each 'YYYY-MM'
 * @param {number} p.amountPaise      commission per loan per month, in paise
 * @param {number} p.durationMonths   how many months each loan earns commission
 * @param {number} [p.startDelayMonths=1]  0 = starts in the disbursement month, 1 = next month
 * @returns {{months: {month: string, eligibleLoans: number, perLoanPaise: number, amountPaise: number}[],
 *            totalPaise: number, totalLoans: number}}
 */
export function generateGroupLeaderCommission({ disbursements, amountPaise, durationMonths, startDelayMonths = 1 }) {
  const byMonth = new Map();
  let totalLoans = 0;

  for (const d of disbursements) {
    const start = parseMonth(d.month);
    if (start === null) throw new RangeError(`Invalid month: ${d.month}`);
    if (!Number.isInteger(d.loans) || d.loans < 0) throw new RangeError(`Invalid loan count for ${d.month}`);
    totalLoans += d.loans;
    for (let k = 0; k < durationMonths; k += 1) {
      const idx = start + startDelayMonths + k;
      byMonth.set(idx, (byMonth.get(idx) || 0) + d.loans);
    }
  }

  const months = [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, loans]) => loans > 0)
    .map(([idx, loans]) => ({
      month: monthKey(idx),
      eligibleLoans: loans,
      perLoanPaise: amountPaise,
      amountPaise: loans * amountPaise,
    }));

  return { months, totalPaise: months.reduce((s, m) => s + m.amountPaise, 0), totalLoans };
}

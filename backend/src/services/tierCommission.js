// Tiered commission engine. Pure functions, integer paise / basis points, no I/O.
//
// A rule is a set of slabs over a measure (loans disbursed, amount collected, products
// sold …). Once the minimum eligibility is reached the commission is worked out in one
// of two ways:
//   all          the rate of the slab the measure falls in applies to EVERY unit counted
//                (30 loans -> 30 × ₹50;  50 loans -> 50 × ₹100)
//   incremental  each slab's rate applies only to the units inside that slab
//                (50 loans -> 20 × ₹50 + 1 × ₹100)
// Count units pay a fixed ₹ per unit; the amount unit pays a % of the amount (or a fixed
// bonus per slab reached). An optional cap limits the payout for the period.

const roundHalfUp = (num, den) => Number((num * 2n + den) / (den * 2n));

const normalise = (slabs) =>
  slabs
    .map((s) => ({
      from: s.from ?? 0,
      to: s.to ?? Number.POSITIVE_INFINITY,
      kind: s.kind, // 'fixed' (paise) | 'percentage' (basis points)
      value: s.value,
    }))
    .sort((a, b) => a.from - b.from);

/**
 * @param {object} p
 * @param {{from?: number, to?: number, kind: 'fixed'|'percentage', value: number}[]} p.slabs
 * @param {'loans'|'members'|'groups'|'products'|'amount'} p.unit
 * @param {number} p.measure             achieved value in `unit` (a count, or paise for amount)
 * @param {number} [p.minEligibility]    nothing is paid below this (same unit)
 * @param {'all'|'incremental'} [p.appliesTo='all']
 * @param {number} [p.maxCommissionPaise]
 */
export function computeTierCommission({ slabs, unit, measure, minEligibility, appliesTo = 'all', maxCommissionPaise }) {
  const s = normalise(slabs);
  const result = { eligible: true, amountPaise: 0, capped: false, breakdown: [] };

  if (minEligibility !== undefined && minEligibility !== null && measure < minEligibility) {
    return { ...result, eligible: false };
  }
  const slabFor = s.find((x) => measure >= x.from && measure <= x.to);
  if (!slabFor && appliesTo === 'all') return { ...result, eligible: false };

  const count = unit !== 'amount';
  let total = 0;

  if (appliesTo === 'all') {
    if (count) {
      // fixed ₹ per unit, for every unit counted
      total = measure * slabFor.value;
      result.breakdown.push({ from: slabFor.from, units: measure, rate: slabFor.value, amountPaise: total });
    } else if (slabFor.kind === 'percentage') {
      total = roundHalfUp(BigInt(measure) * BigInt(slabFor.value), 10000n);
      result.breakdown.push({ from: slabFor.from, base: measure, rate: slabFor.value, amountPaise: total });
    } else {
      total = slabFor.value; // fixed bonus for the slab reached
      result.breakdown.push({ from: slabFor.from, bonus: true, amountPaise: total });
    }
  } else {
    for (const slab of s) {
      if (count) {
        // units are numbered 1..measure; a slab covers the units from..to
        const lo = Math.max(slab.from, 1);
        const units = Math.max(0, Math.min(measure, slab.to) - lo + 1);
        if (units > 0) {
          const amt = units * slab.value;
          total += amt;
          result.breakdown.push({ from: slab.from, units, rate: slab.value, amountPaise: amt });
        }
      } else if (slab.kind === 'percentage') {
        const portion = Math.max(0, Math.min(measure, slab.to) - slab.from);
        if (portion > 0) {
          const amt = roundHalfUp(BigInt(portion) * BigInt(slab.value), 10000n);
          total += amt;
          result.breakdown.push({ from: slab.from, base: portion, rate: slab.value, amountPaise: amt });
        }
      } else if (measure >= slab.from) {
        total += slab.value; // a fixed bonus for every slab reached
        result.breakdown.push({ from: slab.from, bonus: true, amountPaise: slab.value });
      }
    }
  }

  if (maxCommissionPaise && total > maxCommissionPaise) {
    result.capped = true;
    total = maxCommissionPaise;
  }
  result.amountPaise = total;
  return result;
}

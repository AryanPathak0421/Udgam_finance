import { EmiPayment } from '../models/EmiPayment.js';
import { LoanSettlement } from '../models/LoanSettlement.js';

/**
 * Which borrowers of the given loans still owe EMI: a borrower is finished when everything scheduled has been received (the old system's
 * records count too) or the loan was settled. `loans` are lean LoanPayment documents with `_id`, `schedule` (installmentPaise) and `lines`.
 * Returns Map(String(loanId) -> Set of the codes of the borrowers whose loan is still running).
 */
export async function runningBorrowers(loans) {
  const out = new Map();
  for (let at = 0; at < loans.length; at += 250) {
    const batch = loans.slice(at, at + 250);
    const ids = batch.map((l) => l._id);
    // eslint-disable-next-line no-await-in-loop
    const [recv, settled] = await Promise.all([
      EmiPayment.aggregate([
        { $match: { loanPayment: { $in: ids }, status: 'paid' } },
        { $group: { _id: { lp: '$loanPayment', code: '$memberCode' }, paid: { $sum: '$amountPaise' } } },
      ]),
      LoanSettlement.find({ loanPayment: { $in: ids }, status: 'active' }).select('loanPayment memberCode').lean(),
    ]);
    const paid = new Map(recv.map((r) => [`${r._id.lp}|${r._id.code}`, r.paid]));
    const closed = new Set(settled.map((s) => `${s.loanPayment}|${s.memberCode}`));
    for (const l of batch) {
      const base = (l.schedule || []).reduce((s, x) => s + (x.installmentPaise || 0), 0);
      const running = new Set();
      for (const line of l.lines || []) {
        const key = `${l._id}|${line.code}`;
        const scheduled = base + (line.extraEmiPaise || 0) * (l.schedule || []).length;
        if (!closed.has(key) && (paid.get(key) || 0) < scheduled) running.add(line.code);
      }
      out.set(String(l._id), running);
    }
  }
  return out;
}

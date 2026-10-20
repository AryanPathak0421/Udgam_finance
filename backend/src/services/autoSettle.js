import { LoanPayment } from '../models/LoanPayment.js';
import { LoanSettlement } from '../models/LoanSettlement.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { generateCode } from './codeSequence.js';
import { runningBorrowers } from './loanRunning.js';

/**
 * Auto settle. A borrower who has paid every installment is settled automatically: the loan is closed, no EMI shows for it any more, and it
 * shows in the Settlement list as "Auto settle". A regular payer who has paid at least MIN_PERCENT of everything scheduled is settled the same
 * way from the day after the last installment (day 121 of a 120-day loan), and what is left is waived.
 * Set AUTO_SETTLE_MIN_PERCENT (1-100) to change the share; 100 settles only the fully paid loans.
 */
const MIN_PERCENT = Math.min(Math.max(Number(process.env.AUTO_SETTLE_MIN_PERCENT) || 95, 1), 100);
const DAY = 24 * 60 * 60 * 1000;
const startOfToday = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

function record(loan, line, settledOn, outstandingPaise = 0) {
  const group = loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '';
  return {
    kind: 'auto', loanPayment: loan._id, loanId: loan.loanId, formId: loan.formId, branch: loan.branch?._id || loan.branch, member: line.member, memberCode: line.code, memberName: line.name,
    group, outstandingPaise, amountPaise: 0, waiverPaise: outstandingPaise, settledOn,
    remark: outstandingPaise ? `Settled automatically after the last installment (regular payer, ${MIN_PERCENT}% or more paid): the balance is waived` : 'All installments are paid: settled automatically',
  };
}

async function make(loan, line, settledOn, outstandingPaise = 0) {
  try {
    await LoanSettlement.create({ ...record(loan, line, settledOn, outstandingPaise), receiptNo: await generateCode('settlementReceipt') });
    return true;
  } catch (err) {
    if (err.code === 11000) return false; // already settled
    throw err;
  }
}

/** Called when an EMI has just paid the last installment of a borrower. */
export async function autoSettleLine(loan, line, settledOn) {
  return make(loan, line, settledOn);
}

/**
 * Settles every borrower that qualifies and is not settled yet (loans are worked through in batches, so thousands of loans are never in memory
 * together). Safe to run any time; returns how many were settled. With dry = true nothing is written.
 */
export async function autoSettleAll({ dry = false } = {}) {
  const stat = { full: 0, waived: 0, waivedPaise: 0 };
  const cursor = LoanPayment.find({ status: 'paid' })
    .select('loanId formId branch group emiEndDate schedule.installmentPaise lines.member lines.code lines.name lines.extraEmiPaise')
    .lean()
    .batchSize(250)
    .cursor();
  let batch = [];
  const overdueFrom = startOfToday().getTime() - DAY; // the last installment was at least a day ago
  const work = async () => {
    const loans = batch.filter((l) => (l.schedule || []).length);
    batch = [];
    if (!loans.length) return;
    const ids = loans.map((l) => l._id);
    const running = await runningBorrowers(loans);
    const done = new Set((await LoanSettlement.find({ loanPayment: { $in: ids }, status: 'active' }).select('loanPayment memberCode').lean()).map((s) => `${s.loanPayment}|${s.memberCode}`));
    const last = new Map((await EmiPayment.aggregate([
      { $match: { loanPayment: { $in: ids }, status: 'paid' } },
      { $group: { _id: { lp: '$loanPayment', code: '$memberCode' }, on: { $max: '$paidOn' }, paid: { $sum: '$amountPaise' } } },
    ])).map((r) => [`${r._id.lp}|${r._id.code}`, r]));
    for (const l of loans) {
      for (const line of l.lines || []) {
        const key = `${l._id}|${line.code}`;
        if (done.has(key)) continue;
        const got = last.get(key);
        if (running.get(String(l._id))?.has(line.code)) {
          // still owes: only a regular payer, once the loan is past its last installment (day 121 on), is settled with the balance waived
          if (MIN_PERCENT >= 100 || !l.emiEndDate || new Date(l.emiEndDate).getTime() > overdueFrom) continue;
          const scheduled = l.schedule.reduce((a, x) => a + (x.installmentPaise || 0), 0) + (line.extraEmiPaise || 0) * l.schedule.length;
          const paid = got?.paid || 0;
          if (!scheduled || paid * 100 < scheduled * MIN_PERCENT) continue;
          // eslint-disable-next-line no-await-in-loop
          if (dry || (await make(l, line, startOfToday(), scheduled - paid))) { stat.waived += 1; stat.waivedPaise += scheduled - paid; }
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        if (dry || (await make(l, line, got?.on || l.emiEndDate || new Date()))) stat.full += 1;
      }
    }
  };
  for await (const l of cursor) {
    batch.push(l);
    if (batch.length >= 250) await work(); // eslint-disable-line no-await-in-loop
  }
  await work();
  return dry ? stat : stat.full + stat.waived;
}

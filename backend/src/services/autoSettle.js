import { LoanPayment } from '../models/LoanPayment.js';
import { LoanSettlement } from '../models/LoanSettlement.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { generateCode } from './codeSequence.js';
import { runningBorrowers } from './loanRunning.js';

/**
 * A borrower who has paid every installment of the loan is settled automatically ("auto settle"): the loan is closed, no EMI shows for it
 * any more, and the settlement shows in the Settlement list marked as an automatic one. Nothing is waived and no money moves (outstanding 0).
 */

function record(loan, line, settledOn) {
  const group = loan.group?.code ? `${loan.group.code} — ${loan.group.name}` : '';
  return {
    kind: 'auto', loanPayment: loan._id, loanId: loan.loanId, formId: loan.formId, branch: loan.branch?._id || loan.branch, member: line.member, memberCode: line.code, memberName: line.name,
    group, outstandingPaise: 0, amountPaise: 0, waiverPaise: 0, settledOn, remark: 'All installments are paid: settled automatically',
  };
}

async function make(loan, line, settledOn) {
  try {
    await LoanSettlement.create({ ...record(loan, line, settledOn), receiptNo: await generateCode('settlementReceipt') });
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
 * Settles every fully paid borrower that is not settled yet (loans are worked through in batches, so thousands of loans are never in memory
 * together). Safe to run any time; returns how many were settled.
 */
export async function autoSettleAll() {
  let settled = 0;
  const cursor = LoanPayment.find({ status: 'paid' })
    .select('loanId formId branch group emiEndDate schedule.installmentPaise lines.member lines.code lines.name lines.extraEmiPaise')
    .lean()
    .batchSize(250)
    .cursor();
  let batch = [];
  const work = async () => {
    const loans = batch.filter((l) => (l.schedule || []).length);
    batch = [];
    if (!loans.length) return;
    const ids = loans.map((l) => l._id);
    const running = await runningBorrowers(loans);
    const done = new Set((await LoanSettlement.find({ loanPayment: { $in: ids }, status: 'active' }).select('loanPayment memberCode').lean()).map((s) => `${s.loanPayment}|${s.memberCode}`));
    const last = new Map((await EmiPayment.aggregate([
      { $match: { loanPayment: { $in: ids }, status: 'paid' } },
      { $group: { _id: { lp: '$loanPayment', code: '$memberCode' }, on: { $max: '$paidOn' } } },
    ])).map((r) => [`${r._id.lp}|${r._id.code}`, r.on]));
    for (const l of loans) {
      for (const line of l.lines || []) {
        const key = `${l._id}|${line.code}`;
        if (running.get(String(l._id))?.has(line.code) || done.has(key)) continue;
        // eslint-disable-next-line no-await-in-loop
        if (await make(l, line, last.get(key) || l.emiEndDate || new Date())) settled += 1;
      }
    }
  };
  for await (const l of cursor) {
    batch.push(l);
    if (batch.length >= 250) await work(); // eslint-disable-line no-await-in-loop
  }
  await work();
  return settled;
}

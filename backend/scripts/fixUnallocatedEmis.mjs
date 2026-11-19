// An EMI that was approved through the fallback of the app approval has its amount but no installments: the Loan Ledger and the Loan Settlement
// still show that day's installment as due. This puts such an EMI on the earliest unpaid installments of its borrower (the amount is not changed).
//   node scripts/fixUnallocatedEmis.mjs          (list only)
//   node scripts/fixUnallocatedEmis.mjs --apply  (put them on the installments)
import dns from 'dns'; dns.setServers(['8.8.8.8']);
import 'dotenv/config';
import mongoose from 'mongoose';
import { EmiPayment } from '../src/models/EmiPayment.js';
import { LoanPayment } from '../src/models/LoanPayment.js';
import { borrowerState } from '../src/controllers/emiController.js';

const apply = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGODB_URI);
const bad = await EmiPayment.find({ status: 'paid', legacy: { $ne: true }, receiptNo: { $not: /^LEGEMI/ }, $or: [{ items: { $exists: false } }, { items: { $size: 0 } }] }).sort({ paidOn: 1, createdAt: 1 }).lean();
console.log('EMIs without installments:', bad.length, '₹', bad.reduce((s, e) => s + e.amountPaise, 0) / 100);
const loans = new Map();
let fixed = 0; const skipped = [];
for (const e of bad) {
  const key = String(e.loanPayment);
  if (!loans.has(key)) loans.set(key, await LoanPayment.findById(e.loanPayment));
  const p = loans.get(key);
  const line = p?.lines.find((l) => l.code === e.memberCode);
  if (!p || !line) { skipped.push(`${e.receiptNo}: loan or member not found`); continue; }
  const st = await borrowerState(p, line, e.paidOn);
  const items = []; let rest = e.amountPaise;
  for (const row of st.left) { if (rest <= 0) break; const take = Math.min(row.remainingPaise, rest); items.push({ no: row.no, dueDate: new Date(row.dueDate), amountPaise: take }); rest -= take; }
  if (!items.length) { skipped.push(`${e.receiptNo} ${e.loanId}: nothing left to pay on the loan`); continue; }
  console.log(`${e.receiptNo} ${e.loanId} ${e.memberCode} ₹${e.amountPaise / 100} -> installments ${items.map((i) => i.no).join(',')}${rest > 0 ? ` (₹${rest / 100} over)` : ''}`);
  if (apply) { await EmiPayment.updateOne({ _id: e._id }, { $set: { items, installments: items.map((i) => i.no) } }); fixed++; }
}
console.log(apply ? `fixed ${fixed}` : 'dry run (add --apply to fix)', 'skipped', skipped.length); skipped.slice(0, 10).forEach((x) => console.log(' ', x));
await mongoose.disconnect(); process.exit(0);

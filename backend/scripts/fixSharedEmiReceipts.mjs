// Approved app collections that reused the EMI (and receipt) of an earlier collection of the same member and amount: the later one has no EMI of
// its own, so the Loan Ledger / Loan Settlement still show that day's installment as due. This makes the missing EMI.
//   node scripts/fixSharedEmiReceipts.mjs          (list only)
//   node scripts/fixSharedEmiReceipts.mjs --apply  (create the EMIs)
import dns from 'dns'; dns.setServers(['8.8.8.8']);
import 'dotenv/config';
import mongoose from 'mongoose';
import { AppEmiCollection } from '../src/models/AppEmiCollection.js';
import { LoanPayment } from '../src/models/LoanPayment.js';
import { User } from '../src/models/User.js';
import { receive } from '../src/controllers/emiController.js';

const apply = process.argv.includes('--apply');
await mongoose.connect(process.env.MONGODB_URI);
const apps = await AppEmiCollection.find({ status: 'approved', receiptNo: { $exists: true, $ne: '' } }).sort({ createdAt: 1 }).lean();
const groups = new Map();
for (const c of apps) { if (!groups.has(c.receiptNo)) groups.set(c.receiptNo, []); groups.get(c.receiptNo).push(c); }
const todo = [...groups.values()].filter((g) => g.length > 1).flatMap((g) => g.slice(1));
console.log('collections without an EMI of their own:', todo.length, '₹', todo.reduce((s, c) => s + c.amountPaise, 0) / 100);
if (!apply) { process.exit(0); }
const admin = await User.findOne({ role: 'admin' }) || await User.findOne({});
const dayOnly = (d) => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d))}T00:00:00.000Z`);
let ok = 0; const failed = [];
for (const c of todo) {
  try {
    const p = await LoanPayment.findById(c.loanPayment).populate('lines.member branch');
    const line = p.lines.find((l) => l.code?.toUpperCase() === c.memberCode?.toUpperCase());
    const doc = await receive({ user: admin, ip: '', headers: {} }, p, line, { amountPaise: c.amountPaise, type: c.type || 'regular', paidOn: dayOnly(c.collectedOn), payMode: c.payMode, reference: c.reference, bankAccount: c.bankAccount, dueOnly: false, employeeCode: c.collectedByCode || '' });
    await AppEmiCollection.updateOne({ _id: c._id }, { receiptNo: doc.receiptNo });
    ok++;
  } catch (e) { failed.push(`${c.memberCode} ${c.loanId}: ${e.message}`); }
}
console.log('created', ok, 'failed', failed.length); failed.slice(0, 15).forEach((x) => console.log(' ', x));
await mongoose.disconnect(); process.exit(0);

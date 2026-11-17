/**
 * Places the security deposits that name no loan on the right loan, in a database that importMasterData.mjs already filled.
 *
 *   node scripts/fixSecurityPlacement.mjs "<all inserts data.xlsx>" --dry    count what would change, nothing is written
 *   node scripts/fixSecurityPlacement.mjs "<all inserts data.xlsx>"          change it      (option: --dns=8.8.8.8)
 *
 * The importer used to put such a deposit on the member's LATEST loan. A deposit of July 2024 then sat on a running loan of November 2026, so the
 * security of that loan looked bigger and could not be withdrawn. The rule now: the first loan the member took on or after the day of the deposit,
 * or the latest loan when there is none (the same rule as importMasterData.mjs). Only the security of the imported loans changes
 * (lines[0].securityPaise of the payment and securityAmountPaise of the requisition); nothing else is touched. Safe to run again.
 */
import 'dotenv/config';
import dns from 'dns';
import mongoose from 'mongoose';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const dnsArg = args.find((a) => a.startsWith('--dns='));
if (dnsArg) dns.setServers(dnsArg.slice(6).split(','));
const file = args.find((a) => !a.startsWith('--'));
if (!file) throw new Error('Give the path of the xlsx file');

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const up = (s) => str(s).toUpperCase();
const num = (x) => (typeof x === 'number' ? x : Number(String(x || '0').replace(/,/g, '')) || 0);
const paise = (x) => Math.round(num(x) * 100);
const textDate = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str(s)); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; };

const wb = XLSX.readFile(file);
const key = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'security');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[key], { header: 1, raw: true, defval: '' }).slice(2);
const tied = new Map(); const untied = [];
for (const r of rows) {
  const amt = paise(r[6]);
  if (!amt || /^w/i.test(str(r[5]))) continue;
  const lid = up(r[1]);
  if (lid) tied.set(lid, (tied.get(lid) || 0) + amt); else untied.push({ mid: up(r[2]), amt, on: textDate(r[4]) });
}

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
try {
  const pays = await db.collection('loanpayments').find({ masterDataImport: true, status: 'paid' }).project({ loanId: 1, requisition: 1, 'lines.code': 1, 'lines.securityPaise': 1 }).toArray();
  const reqs = new Map((await db.collection('loanrequisitions').find({ masterDataImport: true }).project({ loanDate: 1 }).toArray()).map((x) => [String(x._id), x.loanDate]));
  const byMember = new Map();
  for (const p of pays) {
    const code = up(p.lines?.[0]?.code);
    if (!byMember.has(code)) byMember.set(code, []);
    byMember.get(code).push({ id: p._id, reqId: p.requisition, lid: up(p.loanId), d: reqs.get(String(p.requisition)) ? new Date(reqs.get(String(p.requisition))) : null, now: p.lines?.[0]?.securityPaise || 0 });
  }
  byMember.forEach((list) => list.sort((a, b) => (a.d || 0) - (b.d || 0)));
  const extra = new Map();
  let placed = 0; let noLoan = 0;
  for (const dep of untied) {
    const list = byMember.get(dep.mid);
    if (!list || !list.length) { noLoan += 1; continue; }
    const target = (dep.on && list.find((x) => x.d && x.d >= dep.on)) || list[list.length - 1];
    extra.set(target.lid, (extra.get(target.lid) || 0) + dep.amt);
    placed += 1;
  }
  const pOps = []; const rOps = []; let moved = 0;
  for (const list of byMember.values()) {
    for (const x of list) {
      const want = (tied.get(x.lid) || 0) + (extra.get(x.lid) || 0);
      if (want === x.now) continue;
      moved += Math.abs(want - x.now);
      pOps.push({ updateOne: { filter: { _id: x.id }, update: { $set: { 'lines.0.securityPaise': want } } } });
      rOps.push({ updateOne: { filter: { _id: x.reqId }, update: { $set: { securityAmountPaise: want } } } });
    }
  }
  console.log(`deposits without a loan id: ${untied.length} (${placed} placed on a loan, ${noLoan} of members with no loan in the database)`);
  console.log(`loans whose security changes: ${pOps.length}; amount that moves: Rs ${moved / 200}`);
  const total = (await db.collection('loanpayments').aggregate([{ $match: { masterDataImport: true } }, { $group: { _id: null, t: { $sum: { $sum: '$lines.securityPaise' } } } }]).toArray())[0]?.t || 0;
  console.log(`security of all imported loans now: Rs ${total / 100}`);
  if (DRY) {
    console.log('dry run: nothing written');
  } else {
    for (let i = 0; i < pOps.length; i += 500) { await db.collection('loanpayments').bulkWrite(pOps.slice(i, i + 500), { ordered: false }); await db.collection('loanrequisitions').bulkWrite(rOps.slice(i, i + 500), { ordered: false }); }
    const after = (await db.collection('loanpayments').aggregate([{ $match: { masterDataImport: true } }, { $group: { _id: null, t: { $sum: { $sum: '$lines.securityPaise' } } } }]).toArray())[0]?.t || 0;
    console.log(`written: ${pOps.length} loans changed; security of all imported loans after: Rs ${after / 100}`);
  }
} finally {
  await mongoose.disconnect();
}

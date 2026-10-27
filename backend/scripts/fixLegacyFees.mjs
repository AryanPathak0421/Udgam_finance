/**
 * Corrects the fees of the loans that were loaded from the old system before the legal charges had a place of their own.
 *
 * Earlier the importer added the "LegalAmt" column of the loan sheet to the processing fee, so a loan with processing 2% and
 * legal charges showed more processing than it had (the Company Summary Report looked doubled). This sets, for every imported
 * loan, the processing fee (ProcFees + GstAmt) and the legal charges (LegalAmt) from the workbook. Nothing is deleted and no other
 * field is touched; it can be run again and again, with --dry it only counts.
 *
 *   node scripts/fixLegacyFees.mjs "C:\path\reports udgams data.xlsx" [--dry]
 *
 * It uses MONGODB_URI of backend/.env (point it at the database to correct).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { readWorkbook } from './lib/xlsx.mjs';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const DRY = process.argv.includes('--dry');
if (!file) throw new Error('Give the path of the xlsx file');
const paise = (x) => Math.round((Number(String(x || '0').replace(/,/g, '')) || 0) * 100);
const up = (s) => String(s || '').trim().toUpperCase();

const wb = readWorkbook(file);
const sheet = wb['loan disburcement'] || wb[Object.keys(wb).find((k) => k.startsWith('loan disburcement'))] || [];
await mongoose.connect(process.env.MONGODB_URI, { ignoreUndefined: true });
const db = mongoose.connection.db;

// the imported records are found once (only their ids and loan numbers are read, never the schedules), then updated by id
const idsOf = async (collection, field) => {
  const m = new Map();
  for await (const d of db.collection(collection).find({ legacyImport: true }, { projection: { [field]: 1 } })) {
    const k = up(d[field]);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(d._id);
  }
  return m;
};
const payIds = await idsOf('loanpayments', 'loanId');
const reqIds = await idsOf('loanrequisitions', 'formId');

const seen = new Set();
const pay = []; const req = [];
for (const r of sheet.slice(1)) {
  const lid = up(r[0]);
  if (!lid || seen.has(lid)) continue;
  seen.add(lid);
  const proc = paise(r[9]) + paise(r[12]);
  const legal = paise(r[10]);
  for (const _id of payIds.get(lid) || []) pay.push({ updateOne: { filter: { _id }, update: { $set: { 'lines.0.processingFeePaise': proc, 'lines.0.legalFeePaise': legal } } } });
  for (const _id of reqIds.get(lid) || []) req.push({ updateOne: { filter: { _id }, update: { $set: { processingFeePaise: proc, legalFeePaise: legal } } } });
}
console.log(`${seen.size} loans in the workbook; ${pay.length} imported payments and ${req.length} requisitions found for them`);
if (DRY) {
  console.log('dry run: nothing written');
} else {
  const write = async (collection, ops) => {
    let matched = 0; let modified = 0;
    for (let i = 0; i < ops.length; i += 1000) {
      const r = await db.collection(collection).bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      matched += r.matchedCount; modified += r.modifiedCount;
    }
    console.log(`${collection}: ${matched} matched, ${modified} corrected`);
  };
  await write('loanpayments', pay);
  await write('loanrequisitions', req);
}
await mongoose.disconnect();

/**
 * Puts the mobile numbers of the members imported from the old system ("members phone number.xlsx": BorrowerNo, Name, Phone) on their records.
 *
 *   node scripts/importPhones.mjs "C:\path\members phone number.xlsx"          write the numbers
 *   node scripts/importPhones.mjs "C:\path\members phone number.xlsx" --dry    read and check only, nothing is written
 *
 * The numbers are NOT marked as verified: every one of these members still has to verify the number with an OTP (Borrower Synopsis →
 * Complete details), after which only an admin can change it. Safe to run again: a member that already has a number is left alone.
 * A number is put on a member only when:
 *  - the BorrowerNo is the code of an imported member, and the name in the file is the member's name;
 *  - it is a valid 10-digit mobile number;
 *  - it belongs to one member only (the app allows one mobile number per member: a number the file gives to several members, or that another
 *    member already has, is left blank and counted below, to be entered by the branch with an OTP).
 * The file itself is never copied into the project and no personal detail is printed.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { readWorkbook } from './lib/xlsx.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.log('Usage: node scripts/importPhones.mjs "<path to the xlsx>" [--dry]');
  process.exit(1);
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
const phoneOf = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const VALID = /^[6-9]\d{9}$/;

const wb = readWorkbook(file);
const sheet = Object.values(wb).find((r) => r.length && /borrower/i.test(r[0]?.[0] || ''));
if (!sheet) throw new Error('No sheet with the columns BorrowerNo, Name, Phone was found');
const rows = sheet.slice(1).filter((r) => r[0]);

await mongoose.connect(process.env.MONGODB_URI);
const col = mongoose.connection.db.collection('members');
const members = await col.find({ isDeleted: { $ne: true } }, { projection: { code: 1, name: 1, mobile: 1, legacyImport: 1 } }).toArray();
const byCode = new Map(members.map((m) => [m.code, m]));
const taken = new Set(members.filter((m) => m.mobile).map((m) => m.mobile));

// how many rows of the file carry each number
const uses = new Map();
rows.forEach((r) => { const p = phoneOf(r[2]); uses.set(p, (uses.get(p) || 0) + 1); });

const report = { rows: rows.length, noMember: 0, notImported: 0, nameDiffers: 0, alreadyHasNumber: 0, invalidNumber: 0, sharedNumber: 0, usedByAnother: 0, toWrite: 0 };
const ops = [];
for (const r of rows) {
  const m = byCode.get(r[0]);
  if (!m) { report.noMember += 1; continue; }
  if (!m.legacyImport) { report.notImported += 1; continue; }
  if (norm(m.name) !== norm(r[1])) { report.nameDiffers += 1; continue; }
  if (m.mobile) { report.alreadyHasNumber += 1; continue; }
  const p = phoneOf(r[2]);
  if (!VALID.test(p)) { report.invalidNumber += 1; continue; }
  if (uses.get(p) > 1) { report.sharedNumber += 1; continue; }
  if (taken.has(p)) { report.usedByAnother += 1; continue; }
  report.toWrite += 1;
  ops.push({ updateOne: { filter: { _id: m._id, $or: [{ mobile: { $exists: false } }, { mobile: '' }, { mobile: null }] }, update: { $set: { mobile: p } } } });
}

console.log(DRY ? 'DRY RUN, nothing is written' : 'Writing');
if (!DRY && ops.length) {
  let done = 0;
  for (let i = 0; i < ops.length; i += 500) {
    // eslint-disable-next-line no-await-in-loop
    const res = await col.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    done += res.modifiedCount;
  }
  console.log('numbers written:', done);
}
console.log(report);
console.log('The numbers are not verified: each member verifies the number with an OTP (Complete details).');
await mongoose.disconnect();

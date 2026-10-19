/**
 * The loan schemes made by the import of the old system's data (code LEG-...) are inactive, so no loan can be taken on them. This makes the
 * ones of a type usable (active), so they appear on the loan forms.
 *
 *   node scripts/activateLegacySchemes.mjs --dry               show what would be activated
 *   node scripts/activateLegacySchemes.mjs                     activate the group loan schemes
 *   node scripts/activateLegacySchemes.mjs --types=group,product   other types too (personal, group, business, msme, product)
 *   node scripts/activateLegacySchemes.mjs --off               make them inactive again
 *
 * Their amount range, number of installments and interest were worked out from the old system's collections (see importLegacy.mjs), so look
 * them over under Admin Master → Loan Scheme. LEG-UNNAMED (loans the old file gave no table for) is never activated.
 * Safe to run again; it changes only the schemes made by the import (legacyImport).
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const OFF = args.includes('--off');
const typesArg = args.find((a) => a.startsWith('--types='));
const TYPES = (typesArg ? typesArg.slice(8) : 'group').split(',').map((x) => x.trim()).filter(Boolean);

await mongoose.connect(process.env.MONGODB_URI);
const col = mongoose.connection.db.collection('loanschemes');
const filter = { legacyImport: true, isDeleted: { $ne: true }, loanType: { $in: TYPES }, code: { $ne: 'LEG-UNNAMED' }, isActive: OFF ? true : { $ne: true } };
const rows = await col.find(filter, { projection: { code: 1, loanType: 1, modes: 1 } }).sort({ code: 1 }).toArray();
console.log(`${DRY ? 'DRY RUN, nothing is changed. ' : ''}${OFF ? 'To make inactive' : 'To activate'} (${TYPES.join(', ')}): ${rows.length}`);
rows.forEach((r) => console.log(' ', r.code, `[${r.loanType}, ${(r.modes || []).join('/')}]`));
if (!DRY && rows.length) {
  const res = await col.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $set: { isActive: !OFF, updatedAt: new Date() } });
  console.log('changed:', res.modifiedCount);
}
await mongoose.disconnect();

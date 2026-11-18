/**
 * Loads a product list (xlsx: Serial No., Product Category, Brand, Product Name, Model Name, Variant) into Product Master (head office stock).
 *
 *   node scripts/importProducts.mjs "<Product_List.xlsx>" --dry     show what would be made, nothing is written
 *   node scripts/importProducts.mjs "<Product_List.xlsx>"           make the products
 *   node scripts/importProducts.mjs --remove                        remove the products this script made
 *   options: --dns=8.8.8.8 (resolve mongodb+srv with another DNS server)
 *
 *  - Product Master has category / brand / model / variant. The sheet's "Product Name" (Window AC, Cooler ...) and "Model Name" go together into
 *    the model ("Window AC 183V"); a "-" is empty. The name of the product is brand + model + variant, as everywhere in the app.
 *  - The brand is written one way ("VOLTAS", "voltas" and "Voltas" are one brand): a short brand of up to 3 letters stays in capitals (LG, BPL),
 *    the others are Title Case.
 *  - They are head office products (no branch): the branches order from there. Price and quantity are 0: they are set with Stock Entry.
 *  - The codes come from the app's own sequence (PRD00001 ...). A product that already exists (same category, brand, model, variant) is left alone,
 *    so the script can be run again.
 */
import 'dotenv/config';
import dns from 'dns';
import mongoose from 'mongoose';
import { createRequire } from 'module';
import { generateCode } from '../src/services/codeSequence.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const REMOVE = args.includes('--remove');
const dnsArg = args.find((a) => a.startsWith('--dns='));
if (dnsArg) dns.setServers(dnsArg.slice(6).split(','));
const file = args.find((a) => !a.startsWith('--'));
const FLAG = 'productListImport';

const clean = (v) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s === '-' ? '' : s; };
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s&/-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
const brandForm = (b) => (b.length <= 3 ? b.toUpperCase() : titleCase(b));

await mongoose.connect(process.env.MONGODB_URI);
const col = mongoose.connection.db.collection('stockproducts');
try {
  if (REMOVE) {
    console.log(`removed ${(await col.deleteMany({ [FLAG]: true })).deletedCount} products`);
  } else {
    if (!file) throw new Error('Give the path of the xlsx file');
    const wb = XLSX.readFile(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }).slice(1).filter((r) => clean(r[3]) || clean(r[2]));
    const items = rows.map((r) => {
      const category = clean(r[1]);
      const brand = brandForm(clean(r[2]));
      const model = [clean(r[3]), clean(r[4])].filter(Boolean).join(' ');
      const variant = clean(r[5]);
      return { serial: r[0], category, brand, model, variant, name: [brand, model, variant].filter(Boolean).join(' ') };
    });
    const bad = items.filter((x) => !x.category || !x.brand || !x.model || x.model.length > 60 || x.variant.length > 60);
    if (bad.length) throw new Error(`These rows are not complete or too long: ${bad.map((x) => x.serial).join(', ')}`);
    const key = (x) => [x.category, x.brand, x.model, x.variant].join('|').toLowerCase();
    const seen = new Set(); const dup = [];
    items.forEach((x) => { if (seen.has(key(x))) dup.push(x.serial); seen.add(key(x)); });
    if (dup.length) throw new Error(`Rows that repeat an earlier product (same category, brand, model, variant): ${dup.join(', ')}`);

    const existing = await col.find({ isDeleted: false, branch: null }).project({ category: 1, brand: 1, model: 1, variant: 1 }).toArray();
    const have = new Set(existing.map((x) => key({ category: x.category, brand: x.brand, model: x.model, variant: x.variant || '' })));
    const toMake = items.filter((x) => !have.has(key(x)));
    console.log(`rows in the sheet: ${items.length}; brands: ${new Set(items.map((x) => x.brand)).size}; already in Product Master: ${items.length - toMake.length}; to make: ${toMake.length}`);
    if (DRY) {
      toMake.forEach((x) => console.log(`  ${String(x.serial).padStart(2)}  ${x.category} | ${x.brand} | ${x.model} | ${x.variant || '—'}  =>  ${x.name}`));
      console.log('dry run: nothing written');
    } else {
      let made = 0;
      for (const x of toMake) {
        const code = await generateCode('stockProduct');
        const now = new Date();
        await col.insertOne({ code: code.toUpperCase(), category: x.category, brand: x.brand, model: x.model, variant: x.variant, name: x.name, branch: null, unitPricePaise: 0, stockQty: 0, isActive: true, isDeleted: false, createdAt: now, updatedAt: now, sourceSerial: x.serial, [FLAG]: true });
        made += 1;
      }
      const all = await col.countDocuments({ isDeleted: false });
      console.log(`made ${made} products; Product Master now has ${all}`);
    }
  }
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

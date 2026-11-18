/**
 * Loads the stock of the branches from "product stock entry update.xlsx" (Branch, Brand, Model, Variant, Quantity, Sell Price) as Stock Entries.
 *
 *   node scripts/importStockEntries.mjs "<product stock entry update.xlsx>" --dry     show how every row is matched, nothing is written
 *   node scripts/importStockEntries.mjs "<product stock entry update.xlsx>"           write
 *   node scripts/importStockEntries.mjs --remove                                      take back what this script did
 *   options: --dns=8.8.8.8, --date=YYYY-MM-DD (the date of the entries; the sheet has none, the default is today)
 *
 * The sheet is written by hand (brand and model are free text with typos: "arrient", "celling fan", "coolar"), so every kind of row is matched to a
 * product of Product Master by the rules below (the product list of importProducts.mjs). A row with no product in the master gets a new product
 * (head office, price and quantity 0, like the others). Every row has to match a rule, otherwise nothing is written.
 *
 * For every row: the stock of the product of that branch is raised (the branch's own copy of the product is made when it is not there yet, as the
 * Stock Entry screen does), the sell price is set, and a Stock Entry is written. HEAD-OFFICE is the head office stock (no branch).
 * Everything made is marked `stockListImport: true`; --remove takes the entries out, brings the stock back and removes the products made here.
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
const dateArg = args.find((a) => a.startsWith('--date='));
const file = args.find((a) => !a.startsWith('--'));
const FLAG = 'stockListImport';
const norm = (s) => String(s ?? '').toLowerCase().replace(/[()\-_,.]/g, ' ').replace(/\s+/g, ' ').trim();
const money = (x) => Math.round(Number(x) * 100);

// ---- the rules: a pattern on "brand | model | variant" (lower case, no punctuation) -> a product code of the master, or a new product
const NEW = (brand, model, variant = '') => ({ brand, model, variant });
const RULES = [
  [/^air coolar small /, 'PRD00008'], [/^air coolar \| champion/, 'PRD00038'], [/^air coolar \| glass top/, 'PRD00035'], [/^air coolar \| gloster/, 'PRD00036'], [/^air coolar \| thar/, 'PRD00037'],
  [/^aquaguard \| enrich neo/, 'PRD00040'], [/^aquaguard \| sure champ/, 'PRD00039'],
  [/^asha and bahubali \| rajdoot/, 'PRD00062'], [/^rajdoot \| rajdoot bahubali/, 'PRD00062'],
  [/^rajdoot \| rajdoot asha/, NEW('Rajdoot', 'Stand Fan', 'Asha')], [/^rajdoot \| rajdoot century/, NEW('Rajdoot', 'Stand Fan', 'Century')], [/^rajdoot \| rajdoot creata/, NEW('Rajdoot', 'Stand Fan', 'Creata')],
  [/^creata \| creata stand fan/, NEW('Creata', 'Stand Fan')],
  [/^bajaj iran \| dx2/, 'PRD00044'], [/^bajaj \| (bajaj celling fan|celling fan|bajaj fan)/, 'PRD00061'], [/^bajaj \| esteem/, 'PRD00049'],
  [/^bpl ac \| 1 5t/, 'PRD00033'], [/^bpl tv \| 32 smart hometheatre/, 'PRD00031'], [/^bpl tv \| 40 fhd hometheatre/, 'PRD00030'], [/^bpl \| 32 hd ready/, 'PRD00026'],
  [/^bpl \| cooler/, 'PRD00058'], [/^bpl \| bpl cooler/, 'PRD00058'],
  [/^bpl celling fan \|/, NEW('BPL', 'Ceiling Fan')], [/^bpl \| bpl celling fan/, NEW('BPL', 'Ceiling Fan')],
  [/^bpl mixer \|/, NEW('BPL', 'Mixer')], [/^bpl \| bpl mixer/, NEW('BPL', 'Mixer')], [/^bpl \| bpl washing machine/, NEW('BPL', 'Washing Machine')],
  [/^carrier \| wrac 18k/, 'PRD00004'], [/^challenger \| tv \| 32/, 'PRD00027'], [/^challanger \| challenger tv/, 'PRD00027'], [/^godrej ac \| 1 5t/, 'PRD00034'],
  [/^haier \| ref/, 'PRD00016'],
  [/^havells \| supro 55/, 'PRD00009'], [/^havells \| supro 75/, 'PRD00010'],
  [/^indo \| 1200mm \| andrex ask blue/, 'PRD00047'], [/^indo \| 1200mm \| andrex white/, 'PRD00046'],
  [/^indo \| (crisip|indo crisip iran|iron)\b/, 'PRD00045'], [/^indo \| club neo/, 'PRD00056'], [/^indo \| delta hs/, 'PRD00051'], [/^indo \| delta ns/, 'PRD00050'],
  [/^indo \| induction/, NEW('Indo', 'Induction')], [/^indo \| indo panther mixer 750w/, 'PRD00055'], [/^indo \| mixer/, NEW('Indo', 'Mixer')], [/^indo \| indo mixer stylish/, NEW('Indo', 'Mixer', 'Stylish')],
  [/^indo \| shakti/, 'PRD00052'], [/^indo \| alexia pro/, 'PRD00065'],
  [/^kelvinator \| ref dc188l/, 'PRD00020'], [/^kelvinator \| ref\b/, 'PRD00020'], [/^kel \| satt 7kg/, 'PRD00011'], [/^kelvinator \| mixer/, 'PRD00057'], [/^kelvinator \| wm satt 7 0kg/, 'PRD00014'],
  [/^kelvinator 500 w \| kelvinator mixer/, 'PRD00057'], [/^kelvinator 750 w \| kelvinator mixer/, NEW('Kelvinator', 'Mixer', '750 W')],
  [/^lg \| (32 inch|tv \| 32)/, 'PRD00029'], [/^lg \| ref/, 'PRD00023'], [/^lg \| lg fridge 185 ltr 1 star/, 'PRD00023'],
  [/^metro celling fan \| striker/, 'PRD00048'], [/^metro \| 600mm \| deco/, 'PRD00053'], [/^metro \| 600mm \|\s*$/, NEW('Metro', 'Ceiling Fan 600MM')],
  [/^orrient \| /, 'PRD00054'],
  [/^polar \| infrared/, 'PRD00043'], [/^panther \| indo mixer/, 'PRD00055'],
  [/^samsung \| rt28c3022cu\/nl/, 'PRD00006'], [/^samsung \| tv \| 32/, 'PRD00028'],
  [/^servokon battery \| sstt25048/, 'PRD00001'], [/^servokon stablizer \| sk 413a/, 'PRD00041'], [/^servokon stablizer \| sksg 480a/, 'PRD00042'],
  [/^usha \| (silai machine leg|leg silai machine|leg\b)/, 'PRD00063'], [/^usha \| (silai machine hand|hand\b)/, 'PRD00064'],
  [/^voltas washing machine \| wm/, NEW('Voltas', 'Washing Machine WM')], [/^voltas windoww ac \| 183v/, 'PRD00003'], [/^voltas \| 220860/, 'PRD00005'], [/^voltas \| glass/, 'PRD00012'],
  [/^whirlpool \| ref 73366 w/, 'PRD00022'], [/^whirlpool \| ref 73560/, 'PRD00021'], [/^whirlpool \| whirlpool fridge 185 ltr 1 star/, NEW('Whirlpool', 'Refrigerator 185 L 1 Star')],
  [/^whitemagic \| elite/, 'PRD00025'],
  [/^(arrient|arient) \| /, 'PRD00060'],
  [/^solar light \| solar light big/, NEW('Solar', 'Light', 'Big')], [/^(solar|solar light|surya) \| solar light small/, NEW('Solar', 'Light', 'Small')],
  [/^surya( ken star)? \| (indection|k star induction)/, NEW('Surya', 'Induction', 'K Star')],
];

await mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection.db;
const products = db.collection('stockproducts'); const entries = db.collection('stockentries');
try {
  if (REMOVE) {
    const es = await entries.find({ [FLAG]: true }).toArray();
    for (const e of es) await products.updateOne({ _id: e.product }, { $inc: { stockQty: -e.quantity } });
    await entries.deleteMany({ [FLAG]: true });
    const made = await products.deleteMany({ [FLAG]: true });
    console.log(`took back ${es.length} entries; removed ${made.deletedCount} products made by this script`);
  } else {
    if (!file) throw new Error('Give the path of the xlsx file');
    const wb = XLSX.readFile(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }).slice(1).filter((r) => String(r[1]).trim() || String(r[2]).trim());
    const master = await products.find({ isDeleted: false, branch: null }).toArray();
    const byCode = new Map(master.map((p) => [p.code, p]));
    const branches = new Map((await db.collection('branches').find({ isDeleted: false }).project({ code: 1 }).toArray()).map((b) => [String(b.code).toUpperCase(), b._id]));
    const entryDate = dateArg ? new Date(`${dateArg.slice(7)}T00:00:00.000Z`) : new Date(Date.UTC(...(() => { const d = new Date(); return [d.getFullYear(), d.getMonth(), d.getDate()]; })()));

    const plan = []; const unmatched = []; const noBranch = [];
    for (const r of rows) {
      const branchName = String(r[0]).trim().toUpperCase();
      const text = `${norm(r[1])} | ${norm(r[2])} | ${norm(r[3])}`;
      const hit = RULES.find(([re]) => re.test(text));
      if (!hit) { unmatched.push(text); continue; }
      if (typeof hit[1] === 'string' && !byCode.has(hit[1])) { unmatched.push(`${text}  (the master has no ${hit[1]})`); continue; }
      const isHo = branchName === 'HEAD-OFFICE' || branchName === 'HEAD OFFICE';
      if (!isHo && !branches.has(branchName)) { noBranch.push(branchName); continue; }
      plan.push({ text, target: hit[1], branch: isHo ? null : branches.get(branchName), branchName: isHo ? 'HEAD-OFFICE' : branchName, qty: Number(r[4]), price: money(r[5]) });
    }
    if (unmatched.length || noBranch.length) throw new Error(`Rows without a rule or a branch (nothing written):\n  ${[...new Set(unmatched)].join('\n  ')}\n  branches: ${[...new Set(noBranch)].join(', ')}`);
    const bad = plan.filter((p) => !(p.qty > 0) || !(p.price >= 0));
    if (bad.length) throw new Error(`${bad.length} rows with a bad quantity or price`);

    const newKeys = new Map();
    plan.forEach((p) => { if (typeof p.target !== 'string') newKeys.set(`${p.target.brand}|${p.target.model}|${p.target.variant}`.toLowerCase(), p.target); });
    const sumQty = plan.reduce((t, p) => t + p.qty, 0);
    console.log(`rows ${plan.length}; units ${sumQty}; matched to a master product: ${plan.filter((p) => typeof p.target === 'string').length}; new products to make: ${newKeys.size} (${[...newKeys.values()].map((n) => [n.brand, n.model, n.variant].filter(Boolean).join(' ')).join('; ')})`);
    const perBranch = {}; plan.forEach((p) => { perBranch[p.branchName] = (perBranch[p.branchName] || 0) + p.qty; });
    console.log('units per branch:', JSON.stringify(perBranch));
    if (DRY) {
      const seen = new Map(); plan.forEach((p) => { const k = p.text; if (!seen.has(k)) seen.set(k, typeof p.target === 'string' ? `${p.target} ${byCode.get(p.target).name}` : `NEW ${p.target.brand} ${p.target.model} ${p.target.variant}`); });
      [...seen.entries()].sort().forEach(([k, v]) => console.log(`  ${k.padEnd(70)} -> ${v}`));
      console.log('dry run: nothing written');
    } else {
      // the master products (head office) that are new
      const newProduct = new Map();
      for (const [k, n] of newKeys) {
        const code = (await generateCode('stockProduct')).toUpperCase();
        const now = new Date();
        const doc = { code, category: 'Electronics', brand: n.brand, model: n.model, variant: n.variant, name: [n.brand, n.model, n.variant].filter(Boolean).join(' '), branch: null, unitPricePaise: 0, stockQty: 0, isActive: true, isDeleted: false, createdAt: now, updatedAt: now, [FLAG]: true };
        await products.insertOne(doc);
        newProduct.set(k, doc);
      }
      const branchProduct = new Map(); // "productId|branchId" -> the product of that branch
      let written = 0;
      for (const p of plan) {
        const m = typeof p.target === 'string' ? byCode.get(p.target) : newProduct.get(`${p.target.brand}|${p.target.model}|${p.target.variant}`.toLowerCase());
        let prod = m;
        if (p.branch) {
          const k = `${m._id}|${p.branch}`;
          if (!branchProduct.has(k)) {
            let bp = await products.findOne({ branch: p.branch, category: m.category, brand: m.brand, model: m.model, variant: m.variant || '', isDeleted: false });
            if (!bp) {
              const now = new Date();
              bp = { code: (await generateCode('stockProduct')).toUpperCase(), category: m.category, brand: m.brand, model: m.model, variant: m.variant || '', name: m.name, branch: p.branch, unitPricePaise: 0, stockQty: 0, isActive: true, isDeleted: false, createdAt: now, updatedAt: now, [FLAG]: true };
              await products.insertOne(bp);
            }
            branchProduct.set(k, bp);
          }
          prod = branchProduct.get(k);
        }
        const before = (await products.findOne({ _id: prod._id }, { projection: { stockQty: 1 } })).stockQty || 0;
        await products.updateOne({ _id: prod._id }, { $inc: { stockQty: p.qty }, $set: { unitPricePaise: p.price, updatedAt: new Date() } });
        const now = new Date();
        await entries.insertOne({ code: (await generateCode('stockEntry')).toUpperCase(), product: prod._id, productCode: prod.code, productName: prod.name, branch: p.branch, quantity: p.qty, stockBefore: before, stockAfter: before + p.qty, sellAmountPaise: p.price, entryDate, supplier: '', billNo: '', remark: 'Opening stock (imported from the product stock sheet)', status: 'active', byCode: 'IMPORT', createdAt: now, updatedAt: now, [FLAG]: true });
        written += 1;
      }
      const total = (await products.aggregate([{ $match: { isDeleted: false } }, { $group: { _id: null, t: { $sum: '$stockQty' } } }]).toArray())[0]?.t || 0;
      console.log(`written: ${written} stock entries, ${newKeys.size} new master products; stock of all products now ${total} units (the sheet has ${sumQty})`);
    }
  }
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

/**
 *   node scripts/autoSettle.mjs --dry   count what would be settled (and how much would be waived), nothing is written
 *   node scripts/autoSettle.mjs         settle them (the server also does this every 6 hours)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { autoSettleAll } from '../src/services/autoSettle.js';

await mongoose.connect(process.env.MONGODB_URI);
if (process.argv.includes('--dry')) {
  const s = await autoSettleAll({ dry: true });
  console.log(`DRY RUN. fully paid: ${s.full} · regular payers settled with a waiver: ${s.waived} · total waived: Rs ${(s.waivedPaise / 100).toFixed(2)}`);
} else console.log('settled', await autoSettleAll());
await mongoose.disconnect();

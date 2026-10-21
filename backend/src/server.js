import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { LoanScheme } from './models/LoanScheme.js';
import { User } from './models/User.js';
import { Member } from './models/Member.js';
import { generateCode } from './services/codeSequence.js';
import { StockProduct } from './models/StockProduct.js';
import { EmiPayment } from './models/EmiPayment.js';
import { autoSettleAll } from './services/autoSettle.js';
import { autoAttendanceFor } from './controllers/hrController.js';

const port = process.env.PORT || 5000;

// One-time data fix, idempotent: the "Prime loan" type was replaced by "MSME loan".
async function migrate() {
  const res = await LoanScheme.updateMany({ loanType: 'prime' }, { $set: { loanType: 'msme' } });
  if (res.modifiedCount) console.log(`Migrated ${res.modifiedCount} loan scheme(s): prime -> msme`);

  // Stock products made before brand / model / category existed: the old name becomes the brand (head office stock).
  const oldProducts = await StockProduct.collection.find({ brand: { $exists: false } }).toArray();
  for (const p of oldProducts) {
    // eslint-disable-next-line no-await-in-loop
    await StockProduct.collection.updateOne({ _id: p._id }, { $set: { brand: p.name, model: p.name, variant: '', category: p.category || 'Other' } });
  }
  if (oldProducts.length) console.log(`Updated ${oldProducts.length} stock product(s) to the new product fields`);
  await StockProduct.syncIndexes();
  await EmiPayment.syncIndexes();
  await Member.syncIndexes();

  // Every user gets a staff ID (oldest first).
  const users = await User.find({ employeeCode: { $exists: false } }).sort({ createdAt: 1 }).select('_id');
  for (const u of users) {
    // eslint-disable-next-line no-await-in-loop
    await User.updateOne({ _id: u._id, employeeCode: { $exists: false } }, { $set: { employeeCode: await generateCode('employee') } });
  }
  if (users.length) console.log(`Assigned employee codes to ${users.length} user(s)`);

  // Members registered before KYC approval existed: record which documents they have.
  // (Streamed one by one with only the photo fields, and written only when a document is found: thousands of members must not be
  // loaded into memory at start-up, and members without any document are left as they are.)
  const photoFields = ['memberPhoto', 'signaturePhoto', 'aadhaarPhoto', 'panPhoto'];
  const personFields = ['photo', 'signature', 'aadhaarPhoto', 'panPhoto'];
  const projection = { _id: 1 };
  photoFields.forEach((k) => { projection[k] = 1; });
  ['guarantor', 'nominee'].forEach((w) => personFields.forEach((f) => { projection[`${w}.${f}`] = 1; }));
  const cursor = Member.collection.find({ $or: [{ kycKeys: { $exists: false } }, { kycKeys: { $size: 0 } }] }, { projection }).batchSize(50);
  let indexed = 0;
  for await (const m of cursor) {
    const keys = [
      ...photoFields.filter((k) => m[k]),
      ...['guarantor', 'nominee'].flatMap((w) => personFields.filter((f) => m[w]?.[f]).map((f) => `${w}.${f}`)),
    ];
    if (keys.length) {
      // eslint-disable-next-line no-await-in-loop
      await Member.collection.updateOne({ _id: m._id }, { $set: { kycKeys: keys } });
      indexed += 1;
    }
  }
  if (indexed) console.log(`Indexed KYC documents of ${indexed} member(s)`);
}

connectDB()
  .then(migrate)
  .then(() => app.listen(port, () => {
    console.log(`API running on http://localhost:${port}`);
    // loans whose every installment is paid close by themselves (auto settle): once after the start, then every few hours
    const settleAuto = () => autoSettleAll().then((n) => n && console.log(`Auto settled ${n} fully paid loan(s)`)).catch((err) => console.error('auto settle failed', err.message));
    setTimeout(settleAuto, 2 * 60 * 1000).unref();
    setInterval(settleAuto, 6 * 60 * 60 * 1000).unref();
    // attendance of employees with a staff login: present when they worked in the system that day (today and yesterday, so the late hours of a day count)
    const attend = async () => {
      const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      for (const d of [today, new Date(today.getTime() - 24 * 3600 * 1000)]) await autoAttendanceFor(d);
    };
    const runAttend = () => attend().catch((err) => console.error('auto attendance failed', err.message));
    setTimeout(runAttend, 3 * 60 * 1000).unref();
    setInterval(runAttend, 60 * 60 * 1000).unref();
  }))
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });

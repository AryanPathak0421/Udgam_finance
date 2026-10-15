import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { LoanScheme } from './models/LoanScheme.js';
import { User } from './models/User.js';
import { generateCode } from './services/codeSequence.js';

const port = process.env.PORT || 5000;

// One-time data fix, idempotent: the "Prime loan" type was replaced by "MSME loan".
async function migrate() {
  const res = await LoanScheme.updateMany({ loanType: 'prime' }, { $set: { loanType: 'msme' } });
  if (res.modifiedCount) console.log(`Migrated ${res.modifiedCount} loan scheme(s): prime -> msme`);

  // Every user gets a staff ID (oldest first).
  const users = await User.find({ employeeCode: { $exists: false } }).sort({ createdAt: 1 }).select('_id');
  for (const u of users) {
    // eslint-disable-next-line no-await-in-loop
    await User.updateOne({ _id: u._id, employeeCode: { $exists: false } }, { $set: { employeeCode: await generateCode('employee') } });
  }
  if (users.length) console.log(`Assigned employee codes to ${users.length} user(s)`);
}

connectDB()
  .then(migrate)
  .then(() => app.listen(port, () => console.log(`API running on http://localhost:${port}`)))
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });

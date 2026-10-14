import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { LoanScheme } from './models/LoanScheme.js';

const port = process.env.PORT || 5000;

// One-time data fix, idempotent: the "Prime loan" type was replaced by "MSME loan".
async function migrate() {
  const res = await LoanScheme.updateMany({ loanType: 'prime' }, { $set: { loanType: 'msme' } });
  if (res.modifiedCount) console.log(`Migrated ${res.modifiedCount} loan scheme(s): prime -> msme`);
}

connectDB()
  .then(migrate)
  .then(() => app.listen(port, () => console.log(`API running on http://localhost:${port}`)))
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });

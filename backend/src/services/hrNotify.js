import { Employee } from '../models/Hr.js';
import { UserNotification } from '../models/SuperAdmin.js';
import { sendMail } from '../services/mailer.js';

/**
 * Tells an employee something by mail and in the app: the bell of their staff login (when they have one) and their email (when there is one).
 * A failure here never stops the work that was being done.
 */
export async function notifyEmployee(employeeId, title, message) {
  const out = { app: false, mail: false };
  try {
    const e = await Employee.findById(employeeId).select('user email').lean();
    if (!e) return out;
    if (e.user) { await UserNotification.create({ user: e.user, title, message }); out.app = true; }
    if (e.email) out.mail = await sendMail({ to: e.email, subject: title, text: `${message}\n\nUdgam Microfinance` });
  } catch (err) {
    console.error('employee notification failed', err.message);
  }
  return out;
}

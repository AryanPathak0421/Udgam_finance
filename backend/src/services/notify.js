import { User } from '../models/User.js';
import { UserNotification } from '../models/SuperAdmin.js';

const APPROVERS = ['super_admin', 'admin'];

/**
 * Tells the people who decide something that there is something new to look at: it shows in their bell and on the dashboard.
 * Receivers: the admins, and the branch managers of the branch (when one is given). The person who did it is not told.
 * It never stops the work that is being done: a failure is only logged.
 */
export async function notifyApprovers({ branch, title, message, exceptUser, includeManagers = true }) {
  try {
    const or = [{ role: { $in: APPROVERS } }];
    if (includeManagers && branch) or.push({ role: 'branch_manager', branches: branch });
    const users = await User.find({ isActive: true, $or: or }).select('_id').lean();
    const rows = users.filter((u) => String(u._id) !== String(exceptUser || '')).map((u) => ({ user: u._id, title, message }));
    if (rows.length) await UserNotification.insertMany(rows, { ordered: false });
    return rows.length;
  } catch (err) {
    console.error('notification failed', err.message);
    return 0;
  }
}

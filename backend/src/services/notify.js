import { User } from '../models/User.js';
import { UserNotification } from '../models/SuperAdmin.js';

const APPROVERS = ['super_admin', 'admin'];

/**
 * Tells the people who decide something that there is something new to look at: it shows in their bell and on the dashboard.
 * Receivers: the admins, and the branch managers of the branch (when one is given). The person who did it is not told.
 * It never stops the work that is being done: a failure is only logged.
 */
export async function notifyApprovers({ branch, title, message, exceptUser, includeManagers = true, extraUsers = [] }) {
  try {
    const or = [{ role: { $in: APPROVERS } }];
    if (includeManagers && branch) or.push({ role: 'branch_manager', branches: branch });
    let users = await User.find({ isActive: true, $or: or }).select('_id').lean();
    if (extraUsers && extraUsers.length) {
      const extraIds = extraUsers.filter(Boolean);
      if (extraIds.length) {
        const more = await User.find({ isActive: true, _id: { $in: extraIds } }).select('_id').lean();
        users = [...users, ...more];
      }
    }
    const seen = new Set();
    const rows = [];
    for (const u of users) {
      const idStr = String(u._id);
      if (seen.has(idStr)) continue;
      if (exceptUser && idStr === String(exceptUser) && users.length > 1 && !(extraUsers && extraUsers.some((x) => String(x) === idStr))) {
        continue;
      }
      seen.add(idStr);
      rows.push({ user: u._id, title, message });
    }
    if (rows.length) await UserNotification.insertMany(rows, { ordered: false });
    return rows.length;
  } catch (err) {
    console.error('notification failed', err.message);
    return 0;
  }
}

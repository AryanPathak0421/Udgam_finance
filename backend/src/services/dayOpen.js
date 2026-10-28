import { DayClose } from '../models/DayClose.js';
import { HttpError, startOfToday } from '../utils/http.js';

const DAY = 24 * 3600 * 1000;
const ADMIN = ['super_admin', 'admin'];
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const isAdminUser = (user) => Boolean(user && ADMIN.includes(user.role));

/**
 * The date a branch works on: the day after its last approved day close (denomination). A branch with no approved close has no such date.
 * Only the other users are held to it; the admin works on any date.
 */
export async function branchWorkingDate(branchId) {
  if (!branchId) return null;
  const last = await DayClose.findOne({ branch: branchId, status: 'approved' }).sort({ date: -1 }).select('date').lean();
  return last ? new Date(last.date.getTime() + DAY) : null;
}

/**
 * Work (EMI, payments, entries ...) of a branch is made on its working date only: not on a day that is closed (made its denomination for, even if the
 * admin has not approved it yet) and not on a later day. The admin is not held to this. Head office has no day close.
 */
export async function assertDayOpen(branchId, date, user) {
  if (!branchId || isAdminUser(user)) return;
  const closed = await DayClose.findOne({ branch: branchId, date: { $gte: date }, status: { $in: ['submitted', 'approved'] } }).select('date status').lean();
  if (closed) {
    throw new HttpError(409, `The day ${iso(closed.date)} of this branch is closed${closed.status === 'submitted' ? ' (waiting for the admin)' : ''}. Work is made on ${iso(new Date(closed.date.getTime() + DAY))} only.`, { date: 'This day is closed' });
  }
  if (!user) return;
  const working = await branchWorkingDate(branchId);
  if (working && date.getTime() !== working.getTime()) {
    throw new HttpError(409, `This branch works on ${iso(working)} (the day after its last approved day close). Work cannot be made for ${iso(date)}.`, { date: `The branch works on ${iso(working)}` });
  }
}

/** The date work is made on when none is given: the working date of the branch for the other users (the admin and branches with no day close: today). */
export async function defaultWorkDate(branchId, user) {
  const today = startOfToday();
  if (!branchId || !user || isAdminUser(user)) return today;
  const working = await branchWorkingDate(branchId);
  if (!working) return today;
  if (working > today) throw new HttpError(409, `The day of this branch is closed. Work opens on ${iso(working)}.`, { date: `Work opens on ${iso(working)}` });
  return working;
}

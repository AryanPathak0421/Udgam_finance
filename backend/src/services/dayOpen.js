import mongoose from 'mongoose';
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
  const [revoked, last] = await Promise.all([
    DayClose.findOne({ branch: branchId, status: 'revoked' }).sort({ date: 1 }).select('date').lean(),
    DayClose.findOne({ branch: branchId, status: 'approved' }).sort({ date: -1 }).select('date').lean(),
  ]);
  // a day the admin has revoked (a back date) is worked on first; once its denomination is approved the branch is back on the day after its last approved close
  if (revoked) return revoked.date;
  return last ? new Date(last.date.getTime() + DAY) : null;
}

/** What a branch may still do while the admin has REJECTED its denomination: collect EMIs (and make the denomination again). */
const ALLOWED_WHEN_REJECTED = [/^\/emi\/(collect|pay)\b/, /^\/app\/emi-(collections|payments)\b/, /^\/day-close\b/];
/** What is blocked then: requisition, approval, loan payment, product entry, settlement, new member, group and security (savings) work, commission payment, vouchers, bank deposit / withdrawal. */
const BLOCKED_WHEN_REJECTED = [
  /^\/loan-requisitions\b/, /^\/loan-payments\b/, /^\/stock-(entries|orders|payments|products|transfers)\b/, /^\/settlements\b/, /^\/members\b/, /^\/app\/members\b/,
  /^\/groups\b/, /^\/group-transfer\b/, /^\/savings\b/, /^\/group-leader-commission\/pay\b/, /^\/accounts\/(payment-vouchers|receive-vouchers|bank-deposits|bank-withdrawals|branch-transfers)\b/,
  /^\/cashbook\/entries\b/, /^\/hr\/(room-rents|salary\/pay)\b/,
];

/**
 * While the admin has rejected the denomination of a branch, its users can only collect EMIs (the admin is not held to this; the day is made again
 * on the Denomination screen). Called for every request that writes, once the user is known.
 */
export async function assertNotRejected(req) {
  const user = req.user;
  if (!user || isAdminUser(user) || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const path = String(req.originalUrl || '').split('?')[0].replace(/^\/api/, '');
  if (ALLOWED_WHEN_REJECTED.some((rx) => rx.test(path)) || !BLOCKED_WHEN_REJECTED.some((rx) => rx.test(path))) return;
  const wanted = req.body?.branch && mongoose.isValidObjectId(String(req.body.branch)) ? [String(req.body.branch)] : (user.branches || []).map(String);
  if (!wanted.length) return;
  const rejected = await DayClose.find({ branch: { $in: wanted }, status: 'rejected' }).select('branch date').lean();
  // a user of several branches is held only when every branch in question is rejected
  if (rejected.length && new Set(rejected.map((r) => String(r.branch))).size === wanted.length) {
    const d = iso(rejected.sort((a, b) => b.date - a.date)[0].date);
    throw new HttpError(409, `The denomination of ${d} was rejected by the admin. Only EMI collection is allowed until the denomination is made again and approved.`, { date: 'Denomination rejected: only EMI collection is allowed' });
  }
}

/**
 * Work (EMI, payments, entries ...) of a branch is made on its working date only: not on a day that is closed (made its denomination for, even if the
 * admin has not approved it yet) and not on a later day. The admin is not held to this. Head office has no day close.
 */
export async function assertDayOpen(branchId, date, user) {
  if (!branchId || isAdminUser(user)) return;
  const working = await branchWorkingDate(branchId);
  if (working && date.getTime() !== working.getTime()) {
    throw new HttpError(409, `This branch works on ${iso(working)} (its next open day). Work cannot be made for ${iso(date)}.`, { date: `The branch works on ${iso(working)}` });
  }
  const waiting = await DayClose.findOne({ branch: branchId, status: 'submitted' }).select('date').lean();
  if (waiting) throw new HttpError(409, `The denomination of ${iso(waiting.date)} is waiting for the admin. Work continues after it is approved.`, { date: 'Waiting for the admin' });
  const isRevoked = await DayClose.exists({ branch: branchId, date, status: 'revoked' });
  if (!isRevoked) {
    const closed = await DayClose.findOne({ branch: branchId, date, status: { $in: ['submitted', 'approved'] } }).select('date status').lean();
    if (closed) {
      throw new HttpError(409, `The day ${iso(closed.date)} of this branch is closed${closed.status === 'submitted' ? ' (waiting for the admin)' : ''}. Work is made on ${iso(new Date(closed.date.getTime() + DAY))} only.`, { date: 'This day is closed' });
    }
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

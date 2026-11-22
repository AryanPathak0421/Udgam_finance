import { Member } from '../models/Member.js';
import { HttpError } from '../utils/http.js';

/**
 * One mobile number belongs to one member. The member that already holds the number (another member, not deleted), or null.
 * `verifiedOnly`: only a member whose number is verified holds it (used to verify the number a member already has: of the members that share a number in the
 * old data, the first to verify it keeps it).
 */
export async function memberHoldingMobile(mobile, exceptMemberId, { verifiedOnly = false } = {}) {
  const m = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (!/^\d{10}$/.test(m)) return null;
  return Member.findOne({
    isDeleted: { $ne: true },
    ...(exceptMemberId ? { _id: { $ne: exceptMemberId } } : {}),
    mobile: { $in: [m, `+91${m}`, `91${m}`] },
    ...(verifiedOnly ? { mobileVerifiedAt: { $ne: null } } : {}),
  }).select('code name').lean();
}

/** Stops (409) when the number is already a member's: no OTP is sent to it and it is not given to a second member. */
export async function assertMobileFree(mobile, exceptMemberId, opts) {
  const holder = await memberHoldingMobile(mobile, exceptMemberId, opts);
  if (holder) {
    throw new HttpError(409, `This mobile number is already registered to member ${holder.name} (${holder.code}). One mobile number can belong to one member only. Enter a different number.`);
  }
}

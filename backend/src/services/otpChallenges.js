import mongoose from 'mongoose';
import { OtpChallenge } from '../models/OtpChallenge.js';

const VERIFIED_VALID_MS = 30 * 60 * 1000; // a verified number must be used within 30 minutes

/** A verified, unused challenge for exactly this value, requested by this user and still fresh. */
export async function takeVerified(id, user, purpose, subject) {
  if (!mongoose.isValidObjectId(id)) return null;
  const ch = await OtpChallenge.findOne({ _id: id, createdBy: user._id, purpose, subject, consumedAt: { $exists: false } });
  if (!ch || !ch.verifiedAt || Date.now() - ch.verifiedAt.getTime() > VERIFIED_VALID_MS) return null;
  return ch;
}

export const consumeChallenge = (ch) => OtpChallenge.updateOne({ _id: ch._id }, { $set: { consumedAt: new Date() } });

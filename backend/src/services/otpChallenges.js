import crypto from 'crypto';
import mongoose from 'mongoose';
import { OtpChallenge } from '../models/OtpChallenge.js';
import { HttpError } from '../utils/http.js';

const VERIFIED_VALID_MS = 30 * 60 * 1000; // a verified number must be used within 30 minutes
const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_GAP_MS = 30 * 1000;

export const hashOtp = (id, otp) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(`${id}:${otp}`).digest('hex');

/** A verified, unused challenge for exactly this value, requested by this user and still fresh. */
export async function takeVerified(id, user, purpose, subject) {
  if (!mongoose.isValidObjectId(id)) return null;
  const ch = await OtpChallenge.findOne({ _id: id, createdBy: user._id, purpose, subject, consumedAt: { $exists: false } });
  if (!ch || !ch.verifiedAt || Date.now() - ch.verifiedAt.getTime() > VERIFIED_VALID_MS) return null;
  return ch;
}

export const consumeChallenge = (ch) => OtpChallenge.updateOne({ _id: ch._id }, { $set: { consumedAt: new Date() } });

/** Creates a challenge (the same kind the member forms use, so /members/otp/verify checks it) and returns the code. */
export async function issueOtp({ user, purpose, subject, sentTo }) {
  const last = await OtpChallenge.findOne({ createdBy: user._id, purpose, subject, consumedAt: { $exists: false } }).sort({ createdAt: -1 });
  if (last && Date.now() - last.createdAt.getTime() < RESEND_GAP_MS) {
    const wait = Math.ceil((RESEND_GAP_MS - (Date.now() - last.createdAt.getTime())) / 1000);
    throw new HttpError(429, `Please wait ${wait} seconds before requesting another OTP`);
  }
  const recent = await OtpChallenge.countDocuments({ createdBy: user._id, createdAt: { $gt: new Date(Date.now() - 3600_000) } });
  if (recent >= 20) throw new HttpError(429, 'Too many OTP requests. Please try again after some time.');
  const otp = String(crypto.randomInt(100000, 1000000));
  const ch = new OtpChallenge({ purpose, subject, sentTo, expiresAt: new Date(Date.now() + OTP_TTL_MS), createdBy: user._id });
  ch.hash = hashOtp(ch._id, otp);
  await ch.save();
  return { challenge: ch, otp };
}

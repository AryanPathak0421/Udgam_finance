import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { sendMail } from '../services/mailer.js';
import { HttpError, createValidator } from '../utils/http.js';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RESET_MINUTES = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;

// Frontend and API on different sites need COOKIE_SAMESITE=none, which browsers only
// accept together with Secure. (Behind the Vercel /api proxy the default 'lax' works.)
const sameSite = () => {
  const v = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  return ['lax', 'strict', 'none'].includes(v) ? v : 'lax';
};
const isSecure = () => process.env.NODE_ENV === 'production' || sameSite() === 'none';

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: sameSite(),
  secure: isSecure(),
  maxAge: 24 * 60 * 60 * 1000,
});

// Menu permissions come from the user's rank. Admin roles always have full access;
// null means "use role defaults".
const effectivePermissions = (u) => {
  const perms = u.rank?.menuPermissions;
  return Array.isArray(perms)
    ? perms.map((p) => ({ menu: p.menu, view: p.view, add: p.add, edit: p.edit, delete: p.delete }))
    : null;
};

const publicUser = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  rank: u.rank?.name || null,
  menuPermissions: effectivePermissions(u),
});

export async function login(req, res) {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() })
    .select('+password')
    .populate('rank', 'name menuPermissions');
  const invalid = () => res.status(401).json({ message: 'Invalid email or password' });
  if (!user || !user.isActive) return invalid();

  if (user.lockUntil && user.lockUntil > new Date()) {
    return res.status(423).json({ message: 'Account locked. Try again later.' });
  }

  const ok = await user.matchPassword(password);
  if (!ok) {
    user.failedAttempts += 1;
    if (user.failedAttempts >= MAX_ATTEMPTS) {
      user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      user.failedAttempts = 0;
    }
    await user.save();
    return invalid();
  }

  user.failedAttempts = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
  res.cookie('token', token, cookieOptions());
  res.json({ user: publicUser(user) });
}

export function logout(_req, res) {
  res.clearCookie('token', { httpOnly: true, sameSite: sameSite(), secure: isSecure() });
  res.json({ message: 'Logged out' });
}

export function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Where the reset link points: APP_URL, else the first allowed frontend origin.
function appUrl() {
  const first = (process.env.CLIENT_ORIGIN || '').split(',')[0].trim();
  return (process.env.APP_URL || first || 'http://localhost:5173').replace(/\/$/, '');
}

// Always answers the same way, so the endpoint cannot be used to discover which
// emails are registered.
export async function forgotPassword(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    throw new HttpError(422, 'Please enter a valid email address', { email: 'Enter a valid email address' });
  }

  const generic = { message: 'If this email is registered, a password reset link has been sent to it.' };
  const user = await User.findOne({ email });
  if (!user || !user.isActive) return res.json(generic);

  const token = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = sha256(token);
  user.resetTokenExpires = new Date(Date.now() + RESET_MINUTES * 60 * 1000);
  await user.save();

  const link = `${appUrl()}/reset-password?token=${token}`;
  try {
    await sendMail({
      to: user.email,
      subject: 'Reset your Udgam Microfinance password',
      text:
        `Hello ${user.name},\n\n` +
        `We received a request to reset your password. Open the link below to choose a new one ` +
        `(valid for ${RESET_MINUTES} minutes):\n\n${link}\n\n` +
        `If you did not request this, you can ignore this email — your password will not change.`,
      html:
        `<p>Hello ${escapeHtml(user.name)},</p>` +
        `<p>We received a request to reset your password. Click the button below to choose a new one. ` +
        `This link is valid for ${RESET_MINUTES} minutes.</p>` +
        `<p><a href="${link}" style="background:#107870;color:#fff;padding:12px 22px;border-radius:8px;` +
        `text-decoration:none;display:inline-block;font-weight:600">Reset password</a></p>` +
        `<p style="color:#6b7280;font-size:13px">If the button does not work, copy this link:<br>${link}</p>` +
        `<p style="color:#6b7280;font-size:13px">If you did not request this, ignore this email — your password will not change.</p>`,
    });
  } catch (err) {
    console.error('forgot-password mail failed:', err.message);
  }
  res.json(generic);
}

export async function resetPassword(req, res) {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const v = createValidator();
  if (!PASSWORD_RE.test(password)) v.add('password', 'Password must be 8–64 characters with letters and numbers');
  v.throwIfAny();

  const bad = () => new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
  if (!/^[a-f0-9]{64}$/.test(token)) throw bad();

  const user = await User.findOne({
    resetTokenHash: sha256(token),
    resetTokenExpires: { $gt: new Date() },
  }).select('+resetTokenHash +resetTokenExpires +password');
  if (!user || !user.isActive) throw bad();

  user.password = password;
  user.resetTokenHash = undefined; // single use
  user.resetTokenExpires = undefined;
  user.failedAttempts = 0;
  user.lockUntil = undefined;
  user.passwordChangedAt = new Date();
  await user.save();

  res.json({ message: 'Password updated. You can now sign in with your new password.' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

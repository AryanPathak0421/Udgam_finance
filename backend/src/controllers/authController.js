import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 24 * 60 * 60 * 1000,
});

const publicUser = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  role: u.role,
  // null = role defaults; array = explicit per-menu grants (see Menu Permission).
  menuPermissions: Array.isArray(u.menuPermissions)
    ? u.menuPermissions.map((p) => ({ menu: p.menu, view: p.view, add: p.add, edit: p.edit, delete: p.delete }))
    : null,
});

export async function login(req, res) {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
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
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ message: 'Logged out' });
}

export function me(req, res) {
  res.json({ user: publicUser(req.user) });
}

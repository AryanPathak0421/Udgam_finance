import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    const { id, iat } = jwt.verify(token, process.env.JWT_SECRET);
    // Rank carries the menu permissions, so load it with the user.
    const user = await User.findById(id).populate('rank', 'name menuPermissions isActive');
    if (!user || !user.isActive) return res.status(401).json({ message: 'Not authenticated' });
    // A password change invalidates every session issued before it.
    if (user.passwordChangedAt && iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      return res.status(401).json({ message: 'Session expired. Please sign in again.' });
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Not authenticated' });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'Forbidden' });

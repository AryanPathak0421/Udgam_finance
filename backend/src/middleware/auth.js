import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { assertNotRejected } from '../services/dayOpen.js';

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
  } catch {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  // a branch whose denomination the admin rejected can only collect EMIs
  try {
    await assertNotRejected(req);
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.message, errors: err.errors });
  }
  return next();
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'Forbidden' });

// Menu Permission on the API: admin roles always pass; everyone else needs the action (view / add / edit / delete)
// ticked for the menu in their rank.
export const requireMenu = (menu, action) => (req, res, next) => {
  if (['super_admin', 'admin'].includes(req.user.role)) return next();
  const perms = req.user.rank?.menuPermissions;
  const row = Array.isArray(perms) ? perms.find((p) => p.menu === menu) : null;
  if (row && row.view && row[action]) return next();
  return res.status(403).json({ message: `You do not have permission to ${action} here. Ask an admin to tick it under Menu Permission.` });
};

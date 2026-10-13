import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { MENU_CATALOGUE, MENU_KEYS } from '../config/menus.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const ADMIN_ROLES = ['super_admin', 'admin'];
const ACTIONS = ['view', 'add', 'edit', 'delete'];

const presentPerms = (arr) =>
  Array.isArray(arr) ? arr.map((p) => ({ menu: p.menu, view: p.view, add: p.add, edit: p.edit, delete: p.delete })) : null;

export function getCatalogue(_req, res) {
  res.json({ menus: MENU_CATALOGUE });
}

async function loadTarget(id, actor) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'User not found');
  const user = await User.findById(id).populate('rank', 'name');
  if (!user) throw new HttpError(404, 'User not found');
  if (user.role === 'super_admin' && actor.role !== 'super_admin') {
    throw new HttpError(403, 'Only a super admin can manage super admin permissions');
  }
  return user;
}

export async function getUserPermissions(req, res) {
  const user = await loadTarget(req.params.id, req.user);
  res.json({
    user: { id: user._id, name: user.name, email: user.email, role: user.role, rank: user.rank?.name || '' },
    fullAccess: ADMIN_ROLES.includes(user.role),
    permissions: presentPerms(user.menuPermissions),
  });
}

// body.permissions: array of {menu, view, add, edit, delete}, or null to reset to role defaults.
export async function saveUserPermissions(req, res) {
  const user = await loadTarget(req.params.id, req.user);
  if (ADMIN_ROLES.includes(user.role)) {
    throw new HttpError(409, 'Admin and Super Admin users always have full access to all menus');
  }

  const input = req.body?.permissions;
  let next;
  if (input === null) next = undefined;
  else if (!Array.isArray(input)) throw new HttpError(422, 'permissions must be a list or null');
  else {
    const seen = new Set();
    next = [];
    for (const p of input) {
      if (!p || typeof p.menu !== 'string' || !MENU_KEYS.has(p.menu)) throw new HttpError(422, `Unknown menu: ${p?.menu}`);
      if (seen.has(p.menu)) throw new HttpError(422, `Duplicate menu: ${p.menu}`);
      seen.add(p.menu);
      const entry = { menu: p.menu };
      for (const a of ACTIONS) {
        if (typeof p[a] !== 'boolean') throw new HttpError(422, `${a} must be true or false for ${p.menu}`);
        entry[a] = p[a];
      }
      // Add/Edit/Delete only make sense with View.
      if (!entry.view && (entry.add || entry.edit || entry.delete)) {
        throw new HttpError(422, `Grant View before Add/Edit/Delete for ${p.menu}`);
      }
      if (entry.view || entry.add || entry.edit || entry.delete) next.push(entry);
    }
  }

  const before = presentPerms(user.menuPermissions);
  user.menuPermissions = next;
  user.updatedBy = req.user._id;
  await user.save();
  await audit(req, {
    action: 'menuPermission.update',
    entity: 'User',
    entityId: user._id,
    before: { menuPermissions: before },
    after: { menuPermissions: presentPerms(user.menuPermissions) },
  });
  res.json({ permissions: presentPerms(user.menuPermissions) });
}

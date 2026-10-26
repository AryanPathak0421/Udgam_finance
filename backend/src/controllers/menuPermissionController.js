import mongoose from 'mongoose';
import { Rank } from '../models/Rank.js';
import { User } from '../models/User.js';
import { MENU_CATALOGUE, MENU_KEYS } from '../config/menus.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const ACTIONS = ['view', 'add', 'edit', 'delete'];

const presentPerms = (arr) =>
  Array.isArray(arr) ? arr.map((p) => ({ menu: p.menu, view: p.view, add: p.add, edit: p.edit, delete: p.delete })) : null;

export function getCatalogue(_req, res) {
  res.json({ menus: MENU_CATALOGUE });
}

async function loadRank(id) {
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Rank not found');
  const rank = await Rank.findOne({ _id: id, isDeleted: false });
  if (!rank) throw new HttpError(404, 'Rank not found');
  return rank;
}

// Menu permissions belong to a rank: everyone holding the rank gets the same menus.
// Admin / Super Admin users keep full access whatever their rank says.
export async function getRankPermissions(req, res) {
  const rank = await loadRank(req.params.id);
  const userCount = await User.countDocuments({ rank: rank._id });
  const users = await User.find({ rank: rank._id }).select('name employeeCode role isActive').sort({ name: 1 }).limit(60).lean();
  // staff without a rank get no rank menus whatever is ticked: the admin has to give them a rank in User Master
  const withoutRank = await User.find({ $or: [{ rank: { $exists: false } }, { rank: null }], isActive: true, role: { $nin: ['super_admin', 'admin'] } }).select('name employeeCode role').sort({ name: 1 }).limit(60).lean();
  res.json({
    rank: { id: rank._id, code: rank.code, name: rank.name, level: rank.level, userCount },
    users: users.map((u) => ({ id: u._id, name: u.name, employeeCode: u.employeeCode || '', role: u.role, isActive: u.isActive })),
    usersWithoutRank: withoutRank.map((u) => ({ id: u._id, name: u.name, employeeCode: u.employeeCode || '', role: u.role })),
    permissions: presentPerms(rank.menuPermissions),
  });
}

// body.permissions: array of {menu, view, add, edit, delete}, or null to reset to role defaults.
export async function saveRankPermissions(req, res) {
  const rank = await loadRank(req.params.id);

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

  const before = presentPerms(rank.menuPermissions);
  rank.menuPermissions = next;
  rank.updatedBy = req.user._id;
  await rank.save();
  await audit(req, {
    action: 'menuPermission.update',
    entity: 'Rank',
    entityId: rank._id,
    before: { menuPermissions: before },
    after: { menuPermissions: presentPerms(rank.menuPermissions) },
  });
  res.json({ permissions: presentPerms(rank.menuPermissions) });
}

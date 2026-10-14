import mongoose from 'mongoose';
import { AccountGroup, NATURES } from '../models/AccountGroup.js';
import { Ledger } from '../models/Ledger.js';
import { ensureDefaultGroups, loadGroupTree } from '../services/accountGroups.js';
import { asString, createValidator, parsePaging, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const MAX_DEPTH = 5; // levels below a primary group

async function ledgerCounts() {
  const rows = await Ledger.aggregate([
    { $match: { isDeleted: false } },
    { $group: { _id: '$group', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

function present(g, tree, counts) {
  const id = String(g._id);
  return {
    id: g._id,
    name: g.name,
    nature: g.nature,
    parentId: g.parent ? String(g.parent) : '',
    parentName: g.parent ? tree.byId.get(String(g.parent))?.name || '' : '',
    path: tree.pathOf(id).join(' › '),
    depth: tree.depthOf(id),
    isSystem: g.isSystem,
    isActive: g.isActive,
    childCount: (tree.children.get(id) || []).length,
    ledgerCount: counts.get(id) || 0,
  };
}

export async function listGroups(req, res) {
  await ensureDefaultGroups();
  const tree = await loadGroupTree();
  const counts = await ledgerCounts();
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50 });

  const q = asString(req.query.q).toLowerCase();
  let items = tree.ordered;
  if (NATURES.includes(req.query.nature)) items = items.filter((g) => g.nature === req.query.nature);
  if (req.query.status === 'active') items = items.filter((g) => g.isActive);
  if (req.query.status === 'inactive') items = items.filter((g) => !g.isActive);
  if (q) items = items.filter((g) => g.name.toLowerCase().includes(q));

  const total = items.length;
  res.json({
    items: items.slice(skip, skip + limit).map((g) => present(g, tree, counts)),
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  });
}

// Active groups in hierarchy order, for dropdowns.
export async function groupOptions(_req, res) {
  await ensureDefaultGroups();
  const tree = await loadGroupTree();
  const items = tree.ordered
    .filter((g) => g.isActive)
    .map((g) => ({
      id: g._id,
      name: g.name,
      nature: g.nature,
      path: tree.pathOf(g._id).join(' › '),
      depth: tree.depthOf(g._id),
    }));
  res.json({ items });
}

async function resolveParent(parentId, v) {
  if (!parentId) return null;
  if (!mongoose.isValidObjectId(String(parentId))) {
    v.add('parent', 'Select a valid parent group');
    return null;
  }
  const parent = await AccountGroup.findOne({ _id: parentId, isDeleted: false });
  if (!parent) v.add('parent', 'Parent group not found');
  else if (!parent.isActive) v.add('parent', 'Parent group is inactive');
  return parent;
}

export async function createGroup(req, res) {
  await ensureDefaultGroups();
  const b = req.body || {};
  const v = createValidator();
  const name = asString(b.name);
  if (name.length < 2 || name.length > 60) v.add('name', 'Group name must be 2–60 characters');

  const parent = await resolveParent(b.parent, v);
  let nature = String(b.nature || '');
  if (parent) nature = parent.nature; // sub-groups always inherit
  else if (!NATURES.includes(nature)) v.add('nature', 'Select the nature of this group');

  const tree = await loadGroupTree();
  if (parent && tree.depthOf(parent._id) + 1 > MAX_DEPTH) v.add('parent', `Groups can be nested up to ${MAX_DEPTH} levels`);
  v.throwIfAny();

  let doc;
  try {
    doc = await AccountGroup.create({ name, nature, parent: parent?._id, createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'Group name already exists', { name: 'This group name is already in use' });
    throw err;
  }
  await audit(req, { action: 'accountGroup.create', entity: 'AccountGroup', entityId: doc._id, after: doc });
  const fresh = await loadGroupTree();
  res.status(201).json({ group: present(doc, fresh, new Map()) });
}

export async function updateGroup(req, res) {
  const doc = await AccountGroup.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Account group not found');
  if (doc.isSystem) throw new HttpError(409, 'Built-in account groups cannot be edited');

  const b = req.body || {};
  const v = createValidator();
  const name = asString(b.name);
  if (name.length < 2 || name.length > 60) v.add('name', 'Group name must be 2–60 characters');

  const parent = await resolveParent(b.parent, v);
  const tree = await loadGroupTree();
  const id = String(doc._id);
  if (parent) {
    const pid = String(parent._id);
    if (pid === id || tree.descendantIds(id).includes(pid)) v.add('parent', 'A group cannot be placed under itself or its own sub-group');
    else {
      const subDepth = Math.max(0, ...tree.descendantIds(id).map((d) => tree.depthOf(d) - tree.depthOf(id)));
      if (tree.depthOf(pid) + 1 + subDepth > MAX_DEPTH) v.add('parent', `Groups can be nested up to ${MAX_DEPTH} levels`);
    }
  }
  let nature = parent ? parent.nature : String(b.nature || '');
  if (!parent && !NATURES.includes(nature)) v.add('nature', 'Select the nature of this group');
  v.throwIfAny();

  // Changing nature would silently re-classify everything underneath it.
  if (nature !== doc.nature) {
    const hasChildren = (tree.children.get(id) || []).length > 0;
    const ledgers = await Ledger.countDocuments({ group: doc._id, isDeleted: false });
    if (hasChildren || ledgers > 0) {
      throw new HttpError(409, 'Nature cannot change while the group has sub-groups or ledgers', {
        nature: 'Move or delete its sub-groups and ledgers first',
      });
    }
  }

  const before = doc.toObject();
  doc.name = name;
  doc.nature = nature;
  doc.parent = parent ? parent._id : undefined;
  doc.updatedBy = req.user._id;
  try {
    await doc.save();
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'Group name already exists', { name: 'This group name is already in use' });
    throw err;
  }
  await audit(req, { action: 'accountGroup.update', entity: 'AccountGroup', entityId: doc._id, before, after: doc });
  const fresh = await loadGroupTree();
  res.json({ group: present(doc, fresh, await ledgerCounts()) });
}

export async function setGroupStatus(req, res) {
  if (typeof req.body?.isActive !== 'boolean') throw new HttpError(422, 'isActive must be true or false');
  const doc = await AccountGroup.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Account group not found');
  if (doc.isSystem) throw new HttpError(409, 'Built-in account groups cannot be deactivated');

  if (!req.body.isActive) {
    const tree = await loadGroupTree();
    const activeChildren = (tree.children.get(String(doc._id)) || []).filter((c) => c.isActive);
    if (activeChildren.length) {
      throw new HttpError(409, 'Deactivate its active sub-groups first');
    }
  }
  doc.isActive = req.body.isActive;
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: doc.isActive ? 'accountGroup.activate' : 'accountGroup.deactivate', entity: 'AccountGroup', entityId: doc._id });
  const tree = await loadGroupTree();
  res.json({ group: present(doc, tree, await ledgerCounts()) });
}

export async function deleteGroup(req, res) {
  const doc = await AccountGroup.findOne({ _id: req.params.id, isDeleted: false });
  if (!doc) throw new HttpError(404, 'Account group not found');
  if (doc.isSystem) throw new HttpError(409, 'Built-in account groups cannot be deleted');

  const tree = await loadGroupTree();
  if ((tree.children.get(String(doc._id)) || []).length) throw new HttpError(409, 'This group has sub-groups. Delete or move them first.');
  const ledgers = await Ledger.countDocuments({ group: doc._id, isDeleted: false });
  if (ledgers > 0) throw new HttpError(409, `This group has ${ledgers} ledger${ledgers > 1 ? 's' : ''}. Move or delete them first.`);

  const before = doc.toObject();
  doc.isDeleted = true;
  doc.isActive = false;
  doc.updatedBy = req.user._id;
  await doc.save();
  await audit(req, { action: 'accountGroup.delete', entity: 'AccountGroup', entityId: doc._id, before });
  res.json({ message: 'Account group deleted' });
}

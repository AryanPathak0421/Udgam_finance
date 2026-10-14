import { AccountGroup } from '../models/AccountGroup.js';

// Built-in chart of accounts for a microfinance company. [name, nature, parent name]
// Parents are listed before their children.
export const SYSTEM_GROUPS = [
  // Liabilities
  ['Capital Account', 'liability', null],
  ['Reserves & Surplus', 'liability', 'Capital Account'],
  ['Loans (Liability)', 'liability', null],
  ['Secured Loans', 'liability', 'Loans (Liability)'],
  ['Unsecured Loans', 'liability', 'Loans (Liability)'],
  ['Current Liabilities', 'liability', null],
  ['Duties & Taxes', 'liability', 'Current Liabilities'],
  ['Provisions', 'liability', 'Current Liabilities'],
  ['Sundry Creditors', 'liability', 'Current Liabilities'],
  ['Member Savings & Deposits', 'liability', 'Current Liabilities'],
  // Assets
  ['Fixed Assets', 'asset', null],
  ['Investments', 'asset', null],
  ['Current Assets', 'asset', null],
  ['Cash-in-Hand', 'asset', 'Current Assets'],
  ['Bank Accounts', 'asset', 'Current Assets'],
  ['Sundry Debtors', 'asset', 'Current Assets'],
  ['Loans & Advances (Asset)', 'asset', 'Current Assets'],
  ['Member Loan Portfolio', 'asset', 'Loans & Advances (Asset)'],
  ['Deposits (Asset)', 'asset', 'Current Assets'],
  // Income
  ['Direct Income', 'income', null],
  ['Indirect Income', 'income', null],
  // Expenses
  ['Direct Expenses', 'expense', null],
  ['Indirect Expenses', 'expense', null],
  // Suspense
  ['Suspense Account', 'liability', null],
];

// Idempotent and safe under concurrent calls.
export async function ensureDefaultGroups() {
  const idByName = new Map();
  for (const [name, nature, parentName] of SYSTEM_GROUPS) {
    const parent = parentName ? idByName.get(parentName) : undefined;
    try {
      // eslint-disable-next-line no-await-in-loop
      const doc = await AccountGroup.findOneAndUpdate(
        { name, isDeleted: false },
        { $setOnInsert: { name, nature, parent, isSystem: true, isActive: true } },
        { upsert: true, new: true, collation: { locale: 'en', strength: 2 } }
      );
      idByName.set(name, doc._id);
    } catch (err) {
      if (err.code !== 11000) throw err;
      // eslint-disable-next-line no-await-in-loop
      const doc = await AccountGroup.findOne({ name, isDeleted: false }).collation({ locale: 'en', strength: 2 });
      if (doc) idByName.set(name, doc._id);
    }
  }
}

/**
 * Loads every group once and returns helpers for hierarchy work.
 * Group counts are small, so this beats recursive queries.
 */
export async function loadGroupTree() {
  const groups = await AccountGroup.find({ isDeleted: false }).sort({ name: 1 });
  const byId = new Map(groups.map((g) => [String(g._id), g]));
  const children = new Map();
  for (const g of groups) {
    const key = g.parent ? String(g.parent) : 'root';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(g);
  }

  const pathOf = (id) => {
    const names = [];
    let cur = byId.get(String(id));
    let guard = 0;
    while (cur && guard < 20) {
      names.unshift(cur.name);
      cur = cur.parent ? byId.get(String(cur.parent)) : null;
      guard += 1;
    }
    return names;
  };
  const depthOf = (id) => pathOf(id).length - 1;

  const descendantIds = (id) => {
    const out = [];
    const stack = [String(id)];
    while (stack.length) {
      const cur = stack.pop();
      for (const c of children.get(cur) || []) {
        out.push(String(c._id));
        stack.push(String(c._id));
      }
    }
    return out;
  };

  // Depth-first order: each group followed by its sub-groups, alphabetical at each level.
  const ordered = [];
  const walk = (key) => {
    for (const g of children.get(key) || []) {
      ordered.push(g);
      walk(String(g._id));
    }
  };
  walk('root');

  return { groups, byId, children, ordered, pathOf, depthOf, descendantIds };
}

// Vocabulary of the Commission Master.
//
//   Commission for  what event earns the commission (collection, a loan type, new members …)
//   Basis           what the commission value is applied to (per loan, collection amount …)
//   Target unit     what the target range / minimum eligibility is measured in
//   Scope           whose activity is counted: own, the branch's, or supervised branches'
//
// Count bases (per loan / member / group / product) are always a fixed ₹ per unit.

export const BASES = {
  per_loan: { label: 'Per loan', unit: 'loans', fixedOnly: true },
  loan_amount: { label: 'Loan amount', unit: 'amount', fixedOnly: false },
  collection_amount: { label: 'Collection amount', unit: 'amount', fixedOnly: false },
  npa_recovery_amount: { label: 'NPA recovery amount', unit: 'amount', fixedOnly: false },
  per_member: { label: 'Per member', unit: 'members', fixedOnly: true },
  per_group: { label: 'Per group', unit: 'groups', fixedOnly: true },
  per_product: { label: 'Per product', unit: 'products', fixedOnly: true },
};

export const UNITS = {
  loans: 'Number of loans',
  amount: 'Amount (₹)',
  members: 'Number of members',
  groups: 'Number of groups',
  products: 'Number of products',
};

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
export const LOAN_SCOPES = ['own', 'branch', 'supervised'];
export const RATE_APPLIES = ['all', 'incremental'];

const DISBURSEMENT = { bases: ['per_loan', 'loan_amount'], units: ['loans', 'amount'], group: 'Loan disbursement' };

// What a commission is paid for, with the bases and target units that make sense for it.
export const COMMISSION_TYPE_LIST = [
  { key: 'collection', label: 'Collection commission', group: 'Collection & recovery', bases: ['collection_amount'], units: ['amount'] },
  { key: 'npa_recovery', label: 'NPA recovery commission', group: 'Collection & recovery', bases: ['npa_recovery_amount'], units: ['amount'] },
  { key: 'loan_disbursement', label: 'Loan disbursement commission (all loan types)', ...DISBURSEMENT },
  { key: 'group_loan_disbursement', label: 'Group loan disbursement commission', ...DISBURSEMENT },
  { key: 'personal_loan_disbursement', label: 'Personal loan disbursement commission', ...DISBURSEMENT },
  { key: 'business_loan_disbursement', label: 'Business loan disbursement commission', ...DISBURSEMENT },
  { key: 'msme_loan_disbursement', label: 'MSME loan disbursement commission', ...DISBURSEMENT },
  { key: 'new_group_opening', label: 'New group opening commission', group: 'Growth', bases: ['per_group'], units: ['groups'] },
  { key: 'new_member_joining', label: 'New member joining commission', group: 'Growth', bases: ['per_member'], units: ['members'] },
  { key: 'product_sell', label: 'Product sell commission', group: 'Growth', bases: ['per_product'], units: ['products', 'amount'] },
  // The group leader's per-loan monthly rule has its own dedicated fields.
  { key: 'group_leader', label: 'Group leader commission', group: 'Group leader', bases: ['per_loan'], units: ['loans'] },
];

// Older records used a single generic "employee (target-wise)" type. They are kept and
// shown, but can no longer be created; edit one to move it to a specific type.
export const LEGACY_COMMISSION_TYPE = {
  key: 'employee',
  label: 'Employee (target-wise) — legacy',
  group: 'Legacy',
  bases: ['loan_amount'],
  units: ['amount'],
};

export const SELECTABLE_TYPES = COMMISSION_TYPE_LIST.map((t) => t.key);
export const ALL_TYPES = [...SELECTABLE_TYPES, LEGACY_COMMISSION_TYPE.key];

export const typeMeta = (key) =>
  COMMISSION_TYPE_LIST.find((t) => t.key === key) || (key === LEGACY_COMMISSION_TYPE.key ? LEGACY_COMMISSION_TYPE : null);

export const isCountUnit = (unit) => unit !== 'amount';

// Records created before basis/unit existed: infer what they meant.
export function legacyUnit(type) {
  if (type === 'new_group_opening') return 'groups';
  if (type === 'new_member_joining') return 'members';
  return 'amount';
}
export function legacyBasis(type) {
  switch (type) {
    case 'collection': return 'collection_amount';
    case 'npa_recovery': return 'npa_recovery_amount';
    case 'new_group_opening': return 'per_group';
    case 'new_member_joining': return 'per_member';
    case 'product_sell': return 'per_product';
    case 'group_leader': return 'per_loan';
    default: return 'loan_amount';
  }
}

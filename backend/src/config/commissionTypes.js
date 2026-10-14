// What a commission is paid for. `unit` says how its target range is measured:
//   amount -> rupees (stored as paise)   count -> a plain number (groups / members)
// Count-based commissions are always a fixed amount per unit, never a percentage.
export const COMMISSION_TYPE_LIST = [
  { key: 'collection', label: 'Collection commission', unit: 'amount', group: 'Collection & recovery' },
  { key: 'npa_recovery', label: 'NPA recovery commission', unit: 'amount', group: 'Collection & recovery' },
  { key: 'group_loan_disbursement', label: 'Group loan disbursement commission', unit: 'amount', group: 'Loan disbursement' },
  { key: 'personal_loan_disbursement', label: 'Personal loan disbursement commission', unit: 'amount', group: 'Loan disbursement' },
  { key: 'business_loan_disbursement', label: 'Business loan disbursement commission', unit: 'amount', group: 'Loan disbursement' },
  { key: 'msme_loan_disbursement', label: 'MSME loan disbursement commission', unit: 'amount', group: 'Loan disbursement' },
  { key: 'new_group_opening', label: 'New group opening commission', unit: 'count', group: 'Growth' },
  { key: 'new_member_joining', label: 'New member joining commission', unit: 'count', group: 'Growth' },
  { key: 'product_sell', label: 'Product sell commission', unit: 'amount', group: 'Growth' },
  { key: 'group_leader', label: 'Group leader commission', unit: 'amount', group: 'Group leader' },
];

// Older records used a single generic "employee (target-wise)" type. They are kept and
// shown, but can no longer be created; edit one to move it to a specific type.
export const LEGACY_COMMISSION_TYPE = { key: 'employee', label: 'Employee (target-wise) — legacy', unit: 'amount', group: 'Legacy' };

export const SELECTABLE_TYPES = COMMISSION_TYPE_LIST.map((t) => t.key);
export const ALL_TYPES = [...SELECTABLE_TYPES, LEGACY_COMMISSION_TYPE.key];

export const typeMeta = (key) =>
  COMMISSION_TYPE_LIST.find((t) => t.key === key) || (key === LEGACY_COMMISSION_TYPE.key ? LEGACY_COMMISSION_TYPE : null);

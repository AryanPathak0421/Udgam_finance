// Catalogue of menus that can be granted per user (Menu Permission).
// Keys are the frontend route paths. Keep in sync with frontend/src/config/nav.js.
// adminOnly: the backing API is restricted to admin roles regardless of grants.
export const MENU_CATALOGUE = [
  { key: '/admin-master/company-profile', label: 'Company Profile', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/branches', label: 'Branch Master', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/financial-years', label: 'Financial Year', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/ranks', label: 'Rank Master', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/users', label: 'User Master', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/menu-permissions', label: 'Menu Permission', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/code-sequences', label: 'Code Sequence', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/bank-accounts', label: 'Bank Account Master', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/commissions', label: 'Commission Master', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/vouchers', label: 'Voucher Master', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/loan-calculator', label: 'Loan Calculator', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/loan-schemes', label: 'Loan Scheme', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/account-groups', label: 'Account Group Master', group: 'Admin Master', adminOnly: true },
  { key: '/admin-master/ledgers', label: 'Ledger Master', group: 'Admin Master', adminOnly: true },
  { key: '/members/new-borrower', label: 'New Borrower', group: 'Member Details' },
  { key: '/members/kyc-approval', label: 'KYC Approval', group: 'Member Details' },
  { key: '/members/guarantor-change', label: 'Guarantor Change', group: 'Member Details' },
  { key: '/members/borrower-synopsis', label: 'Borrower Synopsis', group: 'Member Details' },
  { key: '/members/block-unblock', label: 'Borrower Block & Unblock', group: 'Member Details' },
  { key: '/members/guarantor-detail', label: 'Guarantor Detail', group: 'Member Details' },
  { key: '/members/nominee-detail', label: 'Nominee Detail', group: 'Member Details' },
  { key: '/group-master/create', label: 'Create Group', group: 'Group Master' },
  { key: '/group-master/list', label: 'Group List', group: 'Group Master' },
  { key: '/group-master/members', label: 'Group Members', group: 'Group Master' },
  { key: '/employees', label: 'Employees', group: 'Organisation' },
  { key: '/customers', label: 'Customers', group: 'Customers' },
  { key: '/kyc', label: 'KYC', group: 'Customers' },
  { key: '/loan-products', label: 'Loan Products', group: 'Lending' },
  { key: '/applications', label: 'Applications', group: 'Lending' },
  { key: '/disbursements', label: 'Disbursement', group: 'Lending' },
  { key: '/loans', label: 'Loans', group: 'Lending' },
  { key: '/collections', label: 'Collections', group: 'Recovery' },
  { key: '/overdue', label: 'Overdue', group: 'Recovery' },
  { key: '/transactions', label: 'Transactions', group: 'Finance' },
  { key: '/group-leader-commission', label: 'Group Leader Commission', group: 'Finance' },
  { key: '/reports', label: 'Reports', group: 'Finance' },
  { key: '/audit-logs', label: 'Audit Logs', group: 'System' },
  { key: '/settings', label: 'Settings', group: 'System', adminOnly: true },
];

export const MENU_KEYS = new Set(MENU_CATALOGUE.map((m) => m.key));






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
  { key: '/employees', label: 'Employees', group: 'Organisation' },
  { key: '/groups', label: 'Centers & Groups', group: 'Organisation' },
  { key: '/customers', label: 'Customers', group: 'Customers' },
  { key: '/kyc', label: 'KYC', group: 'Customers' },
  { key: '/loan-products', label: 'Loan Products', group: 'Lending' },
  { key: '/applications', label: 'Applications', group: 'Lending' },
  { key: '/disbursements', label: 'Disbursement', group: 'Lending' },
  { key: '/loans', label: 'Loans', group: 'Lending' },
  { key: '/collections', label: 'Collections', group: 'Recovery' },
  { key: '/overdue', label: 'Overdue', group: 'Recovery' },
  { key: '/transactions', label: 'Transactions', group: 'Finance' },
  { key: '/reports', label: 'Reports', group: 'Finance' },
  { key: '/audit-logs', label: 'Audit Logs', group: 'System' },
  { key: '/settings', label: 'Settings', group: 'System', adminOnly: true },
];

export const MENU_KEYS = new Set(MENU_CATALOGUE.map((m) => m.key));


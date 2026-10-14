// Sidebar structure. `roles` omitted = visible to every signed-in role.
// An item with `children` is an expandable group (its own path is not routable).
// Role visibility mirrors the RBAC matrix in docs/UDGAM_ANALYSIS.md (section 8).
const ALL_ADMIN = ['super_admin', 'admin'];
const MGMT = ['super_admin', 'admin', 'branch_manager'];

export const NAV_SECTIONS = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', path: '/', icon: 'dashboard' }],
  },
  {
    title: 'Administration',
    items: [
      {
        label: 'Admin Master',
        path: '/admin-master',
        icon: 'master',
        roles: ALL_ADMIN,
        children: [
          { label: 'Company Profile', path: '/admin-master/company-profile', icon: 'building' },
          { label: 'Branch Master', path: '/admin-master/branches', icon: 'branch' },
          { label: 'Financial Year', path: '/admin-master/financial-years', icon: 'calendar' },
          { label: 'Rank Master', path: '/admin-master/ranks', icon: 'rank' },
          { label: 'User Master', path: '/admin-master/users', icon: 'userplus' },
          { label: 'Menu Permission', path: '/admin-master/menu-permissions', icon: 'key' },
          { label: 'Code Sequence', path: '/admin-master/code-sequences', icon: 'hash' },
          { label: 'Bank Account Master', path: '/admin-master/bank-accounts', icon: 'bank' },
          { label: 'Commission Master', path: '/admin-master/commissions', icon: 'percent' },
          { label: 'Voucher Master', path: '/admin-master/vouchers', icon: 'ticket' },
          { label: 'Loan Calculator', path: '/admin-master/loan-calculator', icon: 'calculator' },
          { label: 'Loan Scheme', path: '/admin-master/loan-schemes', icon: 'layers' },
        ],
      },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { label: 'Employees', path: '/employees', icon: 'users', roles: [...MGMT, 'accountant', 'viewer'] },
      { label: 'Centers & Groups', path: '/groups', icon: 'group', roles: [...MGMT, 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'] },
    ],
  },
  {
    title: 'Customers',
    items: [
      { label: 'Customers', path: '/customers', icon: 'customer' },
      { label: 'KYC', path: '/kyc', icon: 'kyc', roles: [...MGMT, 'loan_officer', 'field_officer', 'viewer'] },
    ],
  },
  {
    title: 'Lending',
    items: [
      { label: 'Loan Products', path: '/loan-products', icon: 'product' },
      { label: 'Applications', path: '/applications', icon: 'file', roles: [...MGMT, 'loan_officer', 'field_officer', 'accountant', 'viewer'] },
      { label: 'Disbursement', path: '/disbursements', icon: 'cash', roles: [...MGMT, 'accountant', 'viewer'] },
      { label: 'Loans', path: '/loans', icon: 'loan' },
    ],
  },
  {
    title: 'Recovery',
    items: [
      { label: 'Collections', path: '/collections', icon: 'collect', roles: [...MGMT, 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'] },
      { label: 'Overdue', path: '/overdue', icon: 'alert', roles: [...MGMT, 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'] },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Transactions', path: '/transactions', icon: 'ledger', roles: [...MGMT, 'accountant', 'viewer'] },
      { label: 'Reports', path: '/reports', icon: 'chart' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Audit Logs', path: '/audit-logs', icon: 'shield', roles: [...MGMT, 'accountant'] },
      { label: 'Settings', path: '/settings', icon: 'settings', roles: ALL_ADMIN },
    ],
  },
];

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  branch_manager: 'Branch Manager',
  loan_officer: 'Loan Officer',
  field_officer: 'Field Officer',
  collection_officer: 'Collection Officer',
  accountant: 'Accountant',
  viewer: 'Viewer',
};

// Every routable page (group parents excluded), with its parent label for breadcrumbs.
export function routableItems() {
  return NAV_SECTIONS.flatMap((s) =>
    s.items.flatMap((i) => (i.children ? i.children.map((c) => ({ ...c, parent: i.label, parentRoles: i.roles })) : [i]))
  );
}

/**
 * Whether `user` may open a page.
 * - Admin/Super Admin: role rules only (menu grants never restrict them).
 * - Admin-only pages: never granted to other roles, whatever their menu grants.
 * - Other users: their explicit Menu Permission list when set, otherwise role defaults.
 * The backend enforces the same rules on the API; this only shapes the UI.
 */
export function canOpenPath(user, path) {
  if (path === '/') return true;
  const item = routableItems().find((i) => i.path === path);
  if (!item) return true;
  const roles = item.roles || item.parentRoles;
  const roleOk = !roles || roles.includes(user.role);
  if (ALL_ADMIN.includes(user.role)) return roleOk;
  if (roles && roles.every((r) => ALL_ADMIN.includes(r))) return false;
  if (Array.isArray(user.menuPermissions)) return user.menuPermissions.some((p) => p.menu === path && p.view);
  return roleOk;
}

export function navForUser(user) {
  const allowedItem = (i) =>
    i.children ? i.children.some((c) => canOpenPath(user, c.path)) : canOpenPath(user, i.path);
  return NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items
      .filter(allowedItem)
      .map((i) => (i.children ? { ...i, children: i.children.filter((c) => canOpenPath(user, c.path)) } : i)),
  })).filter((s) => s.items.length > 0);
}




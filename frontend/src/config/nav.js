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
          { label: 'Account Group Master', path: '/admin-master/account-groups', icon: 'folder' },
          { label: 'Ledger Master', path: '/admin-master/ledgers', icon: 'book' },
        ],
      },
    ],
  },
  {
    title: 'Stock',
    items: [
      // Its own module: admins always; other ranks only when it is granted under Menu Permission.
      { label: 'Stock Product Master', path: '/stock/products', icon: 'product', grantOnly: true },
      { label: 'Product Orders', path: '/stock/orders', icon: 'ticket', grantOnly: true },
    ],
  },
  {
    title: 'Members',
    items: [
      {
        label: 'Member Details',
        path: '/members',
        icon: 'customer',
        roles: [...MGMT, 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'],
        children: [
          { label: 'New Borrower', path: '/members/new-borrower', icon: 'userplus' },
          { label: 'Guarantor & Nominee', path: '/members/guarantor-detail', icon: 'users' },
          { label: 'KYC Approval', path: '/members/kyc-approval', icon: 'kyc' },
          { label: 'KYC Re-upload', path: '/members/kyc-reupload', icon: 'kyc', roles: ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'] },
          { label: 'Guarantor Change', path: '/members/guarantor-change', icon: 'users', roles: ALL_ADMIN },
          { label: 'Borrower Synopsis', path: '/members/borrower-synopsis', icon: 'file' },
          { label: 'Borrower Block & Unblock', path: '/members/block-unblock', icon: 'shield' },
        ],
      },
    ],
  },
  {
    title: 'Group Master',
    items: [
      {
        label: 'Group Master',
        path: '/group-master',
        icon: 'group',
        roles: [...MGMT, 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'],
        children: [
          { label: 'Create Group', path: '/group-master/create', icon: 'userplus', roles: [...MGMT, 'loan_officer', 'field_officer'] },
          { label: 'Group List', path: '/group-master/list', icon: 'users' },
          { label: 'Group Members', path: '/group-master/members', icon: 'customer' },
        ],
      },
    ],
  },
  {
    title: 'Loan Requisition',
    items: [
      {
        label: 'Loan Requisition',
        path: '/loan-requisition',
        icon: 'file',
        roles: [...MGMT, 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'],
        children: [
          { label: 'Civil Check', path: '/loan-requisition/civil-check', icon: 'shield', roles: [...MGMT, 'loan_officer', 'field_officer', 'collection_officer', 'accountant', 'viewer'] },
          { label: 'Personal Loan Requisition', path: '/loan-requisition/personal', icon: 'loan', roles: [...MGMT, 'loan_officer', 'field_officer'] },
          { label: 'Group Loan Requisition', path: '/loan-requisition/group', icon: 'group', roles: [...MGMT, 'loan_officer', 'field_officer'] },
          { label: 'Business / MSME Loan', path: '/loan-requisition/business', icon: 'bank', roles: [...MGMT, 'loan_officer', 'field_officer'] },
          { label: 'Product Loan Requisition', path: '/loan-requisition/product', icon: 'product', roles: [...MGMT, 'loan_officer', 'field_officer'] },
          { label: 'Requisition List', path: '/loan-requisition/list', icon: 'ledger' },
        ],
      },
    ],
  },
  {
    title: 'Loan Approval',
    items: [
      {
        label: 'Loan Approval',
        path: '/loan-approval',
        icon: 'check',
        roles: [...MGMT, 'loan_officer', 'field_officer', 'accountant', 'viewer'],
        children: [
          { label: 'Pending Loans', path: '/loan-approval/pending', icon: 'calendar', roles: MGMT },
          { label: 'Approved Loans', path: '/loan-approval/approved', icon: 'check', roles: [...MGMT, 'loan_officer', 'field_officer', 'accountant', 'viewer'] },
          { label: 'Rejected Loans', path: '/loan-approval/rejected', icon: 'alert', roles: [...MGMT, 'loan_officer', 'field_officer', 'accountant', 'viewer'] },
        ],
      },
    ],
  },
  {
    title: 'Loan Payment',
    items: [
      {
        label: 'Loan Payment',
        path: '/loan-payment',
        icon: 'cash',
        roles: [...MGMT, 'accountant', 'loan_officer', 'field_officer', 'collection_officer', 'viewer'],
        children: [
          { label: 'Pending Payment', path: '/loan-payment/pending', icon: 'calendar', roles: [...MGMT, 'accountant'] },
          { label: 'Paid Loans & Receipts', path: '/loan-payment/paid', icon: 'ledger', roles: [...MGMT, 'accountant', 'loan_officer', 'field_officer', 'collection_officer', 'viewer'] },
        ],
      },
    ],
  },
  {
    title: 'EMI Payment',
    items: [
      {
        label: 'EMI Payment',
        path: '/emi',
        icon: 'collect',
        roles: [...MGMT, 'accountant', 'collection_officer', 'field_officer', 'loan_officer', 'viewer'],
        children: [
          { label: 'Single Loan EMI', path: '/emi/single', icon: 'customer', roles: [...MGMT, 'accountant', 'collection_officer', 'field_officer', 'loan_officer', 'viewer'] },
          { label: 'Group Loan EMI', path: '/emi/group', icon: 'group', roles: [...MGMT, 'accountant', 'collection_officer', 'field_officer', 'loan_officer', 'viewer'] },
          { label: 'EMI Payment (by Loan ID)', path: '/emi/payment', icon: 'cash', roles: [...MGMT, 'accountant', 'collection_officer', 'field_officer', 'loan_officer', 'viewer'] },
          { label: 'Advance EMI Payment', path: '/emi/advance', icon: 'calendar', roles: [...MGMT, 'accountant', 'collection_officer', 'field_officer', 'loan_officer', 'viewer'] },
          { label: 'EMI Receipts', path: '/emi/receipts', icon: 'ledger', roles: [...MGMT, 'accountant', 'collection_officer', 'field_officer', 'loan_officer', 'viewer'] },
        ],
      },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { label: 'Employees', path: '/employees', icon: 'users', roles: [...MGMT, 'accountant', 'viewer'] },
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
      { label: 'Disbursement', path: '/disbursements', icon: 'cash', roles: ALL_ADMIN },
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
      { label: 'Group Leader Commission', path: '/group-leader-commission', icon: 'cash', roles: [...MGMT, 'accountant', 'viewer'] },
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
  // A grant-only module is for admins unless a rank is given the menu.
  if (item.grantOnly) return Array.isArray(user.menuPermissions) && user.menuPermissions.some((p) => p.menu === path && p.view);
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





/** Whether the user may add / edit / delete on a menu (admins always; others through Menu Permission). */
export function canDo(user, path, action) {
  if (!user) return false;
  if (ALL_ADMIN.includes(user.role)) return true;
  const row = Array.isArray(user.menuPermissions) ? user.menuPermissions.find((p) => p.menu === path) : null;
  return Boolean(row && row.view && row[action]);
}

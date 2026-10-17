// Default: empty, so calls go to /api on the same origin (Vite proxy in dev, the
// vercel.json rewrite in production) and the auth cookie stays first-party.
// Only set VITE_API_BASE_URL to call an API on another domain directly.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // An expired session on a protected call sends the user back to login.
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
    const err = new Error(data.message || 'Something went wrong');
    err.status = res.status;
    err.errors = data.errors || {};
    throw err;
  }
  return data;
}

const qs = (params = {}) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== '' && v != null && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const AM = '/admin-master';

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => request('/auth/reset-password', { method: 'POST', body: { token, password } }),

  meta: {
    states: () => request(`${AM}/meta/states`),
    cities: (state) => request(`${AM}/meta/cities${qs({ state })}`),
  },
  company: {
    get: () => request(`${AM}/company`),
    save: (data) => request(`${AM}/company`, { method: 'PUT', body: data }),
  },
  groups: {
    list: (params) => request(`/groups${qs(params)}`),
    branchOptions: () => request('/groups/branch-options'),
    get: (id) => request(`/groups/${id}`),
    memberCandidates: (params) => request(`/groups/member-candidates${qs(params)}`),
    addMembers: (id, memberIds) => request(`/groups/${id}/members`, { method: 'POST', body: { memberIds } }),
    removeMember: (id, memberId) => request(`/groups/${id}/members/${memberId}`, { method: 'DELETE' }),
    create: (data) => request('/groups', { method: 'POST', body: data }),
    update: (id, data) => request(`/groups/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`/groups/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`/groups/${id}`, { method: 'DELETE' }),
    disbursements: (id) => request(`/groups/${id}/disbursements`),
    saveDisbursement: (id, month, loans) => request(`/groups/${id}/disbursements`, { method: 'PUT', body: { month, loans } }),
  },
  members: {
    options: () => request('/members/options'),
    kycList: (params) => request(`/members/kyc${qs(params)}`),
    kyc: (id) => request(`/members/${id}/kyc`),
    kycReview: (id, data) => request(`/members/${id}/kyc/review`, { method: 'POST', body: data }),
    kycReupload: (id, data) => request(`/members/${id}/kyc/reupload`, { method: 'POST', body: data }),
    changeGuarantor: (id, data) => request(`/members/${id}/guarantor/change`, { method: 'PUT', body: data }),
    update: (id, data) => request(`/members/${id}`, { method: 'PUT', body: data }),
    synopsis: (id) => request(`/members/${id}/synopsis`),
    setBlocked: (id, data) => request(`/members/${id}/block`, { method: 'POST', body: data }),
    employees: (branch) => request(`/members/employees${qs({ branch })}`),
    pincode: (pin) => request(`/members/lookup/pincode/${pin}`),
    ifsc: (code) => request(`/members/lookup/ifsc/${code}`),
    districts: (state) => request(`/members/districts${qs({ state })}`),
    list: (params) => request(`/members${qs(params)}`),
    get: (id) => request(`/members/${id}`),
    create: (data) => request('/members', { method: 'POST', body: data }),
    saveGuarantor: (id, data) => request(`/members/${id}/guarantor`, { method: 'PUT', body: data }),
    saveNominee: (id, data) => request(`/members/${id}/nominee`, { method: 'PUT', body: data }),
    sendOtp: (data) => request('/members/otp/send', { method: 'POST', body: data }),
    verifyOtp: (challengeId, otp) => request('/members/otp/verify', { method: 'POST', body: { challengeId, otp } }),
  },
  loanRequisitions: {
    schemes: (params) => request(`/loan-requisitions/schemes${qs(params)}`),
    stockProducts: () => request('/loan-requisitions/stock-products'),
    verification: (memberId) => request(`/loan-requisitions/verification/${memberId}`),
    groups: (params) => request(`/loan-requisitions/groups${qs(params)}`),
    group: (id) => request(`/loan-requisitions/groups/${id}`),
    gst: (gstin, member) => request(`/loan-requisitions/gst/${gstin}${qs({ member })}`),
    borrowers: (params) => request(`/loan-requisitions/borrowers${qs(params)}`),
    borrower: (id) => request(`/loan-requisitions/borrowers/${id}`),
    preview: (data) => request('/loan-requisitions/preview', { method: 'POST', body: data }),
    borrowerOtp: (member) => request('/loan-requisitions/borrower-otp', { method: 'POST', body: { member } }),
    topUp: (id, data) => request(`/loan-requisitions/${id}/top-up`, { method: 'POST', body: data }),
    create: (kind, data) => request(kind === 'personal' ? '/loan-requisitions' : `/loan-requisitions/${kind}`, { method: 'POST', body: data }),
    list: (params) => request(`/loan-requisitions${qs(params)}`),
    get: (id) => request(`/loan-requisitions/${id}`),
    remove: (id) => request(`/loan-requisitions/${id}`, { method: 'DELETE' }),
  },
  civilChecks: {
    member: (memberId) => request(`/civil-checks/member/${memberId}`),
    add: (data) => request('/civil-checks', { method: 'POST', body: data }),
    remove: (id) => request(`/civil-checks/${id}`, { method: 'DELETE' }),
  },
  stockProducts: {
    list: (params) => request(`${AM}/stock-products${qs(params)}`),
    create: (data) => request(`${AM}/stock-products`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/stock-products/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/stock-products/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`${AM}/stock-products/${id}`, { method: 'DELETE' }),
  },
  groupCommission: {
    report: (params) => request(`/group-leader-commission${qs(params)}`),
    generate: () => request('/group-leader-commission/generate', { method: 'POST' }),
    sendOtp: (id) => request(`/group-leader-commission/${id}/send-otp`, { method: 'POST' }),
    verifyOtp: (id, otp) => request(`/group-leader-commission/${id}/verify-otp`, { method: 'POST', body: { otp } }),
  },
  ranks: {
    list: (params) => request(`${AM}/ranks${qs(params)}`),
    options: () => request(`${AM}/ranks/options`),
    create: (data) => request(`${AM}/ranks`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/ranks/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/ranks/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`${AM}/ranks/${id}`, { method: 'DELETE' }),
  },
  users: {
    list: (params) => request(`${AM}/users${qs(params)}`),
    create: (data) => request(`${AM}/users`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/users/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/users/${id}/status`, { method: 'PATCH', body: { isActive } }),
    resetPassword: (id, password) => request(`${AM}/users/${id}/password`, { method: 'PATCH', body: { password } }),
  },
  menuPermissions: {
    catalogue: () => request(`${AM}/menu-permissions/catalogue`),
    // Permissions are defined per rank; every user holding the rank inherits them.
    get: (rankId) => request(`${AM}/menu-permissions/ranks/${rankId}`),
    save: (rankId, permissions) => request(`${AM}/menu-permissions/ranks/${rankId}`, { method: 'PUT', body: { permissions } }),
  },
  codeSequences: {
    list: () => request(`${AM}/code-sequences`),
    create: (data) => request(`${AM}/code-sequences`, { method: 'POST', body: data }),
    update: (type, data) => request(`${AM}/code-sequences/${type}`, { method: 'PUT', body: data }),
    remove: (type) => request(`${AM}/code-sequences/${type}`, { method: 'DELETE' }),
  },
  bankAccounts: {
    list: (params) => request(`${AM}/bank-accounts${qs(params)}`),
    create: (data) => request(`${AM}/bank-accounts`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/bank-accounts/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/bank-accounts/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`${AM}/bank-accounts/${id}`, { method: 'DELETE' }),
  },
  accountGroups: {
    list: (params) => request(`${AM}/account-groups${qs(params)}`),
    options: () => request(`${AM}/account-groups/options`),
    create: (data) => request(`${AM}/account-groups`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/account-groups/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/account-groups/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`${AM}/account-groups/${id}`, { method: 'DELETE' }),
  },
  ledgers: {
    list: (params) => request(`${AM}/ledgers${qs(params)}`),
    create: (data) => request(`${AM}/ledgers`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/ledgers/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/ledgers/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`${AM}/ledgers/${id}`, { method: 'DELETE' }),
  },  loanSchemes: {
    list: (params) => request(`${AM}/loan-schemes${qs(params)}`),
    options: () => request(`${AM}/loan-schemes/options`),
    create: (data) => request(`${AM}/loan-schemes`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/loan-schemes/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/loan-schemes/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`${AM}/loan-schemes/${id}`, { method: 'DELETE' }),
  },
  loanCalculator: {
    options: () => request(`${AM}/loan-calculator/options`),
    calculate: (data) => request(`${AM}/loan-calculator`, { method: 'POST', body: data }),
  },
  commissions: {
    types: () => request(`${AM}/commissions/types`),
    previewGroupLeader: (data) => request(`${AM}/commissions/group-leader/preview`, { method: 'POST', body: data }),
    previewTier: (data) => request(`${AM}/commissions/preview`, { method: 'POST', body: data }),
    list: (params) => request(`${AM}/commissions${qs(params)}`),
    create: (data) => request(`${AM}/commissions`, { method: 'POST', body: data }),
    // Replaces every slab of one scope (type + financial year + rank) in a single save.
    saveScope: (data) => request(`${AM}/commissions/scope`, { method: 'PUT', body: data }),
    update: (id, data) => request(`${AM}/commissions/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/commissions/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`${AM}/commissions/${id}`, { method: 'DELETE' }),
  },
  vouchers: {
    list: (params) => request(`${AM}/vouchers${qs(params)}`),
    create: (data) => request(`${AM}/vouchers`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/vouchers/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/vouchers/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`${AM}/vouchers/${id}`, { method: 'DELETE' }),
  },
  branches: {
    options: () => request(`${AM}/branches/options`),
    list: (params) => request(`${AM}/branches${qs(params)}`),
    create: (data) => request(`${AM}/branches`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/branches/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/branches/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`${AM}/branches/${id}`, { method: 'DELETE' }),
  },
  financialYears: {
    list: () => request(`${AM}/financial-years`),
    preview: (params) => request(`${AM}/financial-years/preview${qs(params)}`),
    create: (data) => request(`${AM}/financial-years`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/financial-years/${id}`, { method: 'PUT', body: data }),
    activate: (id) => request(`${AM}/financial-years/${id}/activate`, { method: 'PATCH' }),
    remove: (id) => request(`${AM}/financial-years/${id}`, { method: 'DELETE' }),
  },
};



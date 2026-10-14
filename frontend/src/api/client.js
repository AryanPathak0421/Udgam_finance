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
  loanSchemes: {
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
    list: (params) => request(`${AM}/commissions${qs(params)}`),
    create: (data) => request(`${AM}/commissions`, { method: 'POST', body: data }),
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


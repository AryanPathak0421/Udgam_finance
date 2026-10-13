async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
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
    get: (userId) => request(`${AM}/menu-permissions/users/${userId}`),
    save: (userId, permissions) => request(`${AM}/menu-permissions/users/${userId}`, { method: 'PUT', body: { permissions } }),
  },
  codeSequences: {
    list: () => request(`${AM}/code-sequences`),
    update: (type, data) => request(`${AM}/code-sequences/${type}`, { method: 'PUT', body: data }),
  },
  bankAccounts: {
    list: (params) => request(`${AM}/bank-accounts${qs(params)}`),
    create: (data) => request(`${AM}/bank-accounts`, { method: 'POST', body: data }),
    update: (id, data) => request(`${AM}/bank-accounts/${id}`, { method: 'PUT', body: data }),
    setStatus: (id, isActive) => request(`${AM}/bank-accounts/${id}/status`, { method: 'PATCH', body: { isActive } }),
    remove: (id) => request(`${AM}/bank-accounts/${id}`, { method: 'DELETE' }),
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

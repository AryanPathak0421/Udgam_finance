// One place for the session cookies of the four sign-in surfaces.
//
// The JWT lives ONLY in an httpOnly cookie. It is never returned in a JSON body and the
// browser never stores it in localStorage, so a script injected into a page (XSS) cannot read it.
//
// Each surface has its own cookie name, so signing in to one app does not overwrite the
// session of another app in the same browser:
//   admin      - the back-office web app (/api/auth)
//   employee   - the staff app (/api/employee, /api/employee-app)
//   supervisor - the supervisor app (/api/supervisor, /api/supervisor-app)
//   member     - the customer app (/api/member, /api/member-app)

export const AUTH_COOKIES = {
  admin: 'udgam_admin',
  employee: 'udgam_emp',
  supervisor: 'udgam_sup',
  member: 'udgam_member',
};

// Cookies set by older releases. They are never read; logout clears them so they do not linger.
export const LEGACY_AUTH_COOKIES = ['token', 'udgam_token', 'udgam_emp_token', 'udgam_sup_token', 'udgam_member_token'];

const SESSION_MS = 24 * 60 * 60 * 1000;
const APP_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

// 'lax' works when the browser sees the API on the same site (the Vercel /api rewrite).
// Set COOKIE_SAMESITE=none (which needs Secure) only when the API is on a different site.
export const sameSite = () => {
  const v = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  return ['lax', 'strict', 'none'].includes(v) ? v : 'lax';
};
const isSecure = () => process.env.NODE_ENV === 'production' || sameSite() === 'none';

const baseOptions = () => ({ httpOnly: true, sameSite: sameSite(), secure: isSecure(), path: '/' });

export function setAuthCookie(res, surface, token, { app = false } = {}) {
  res.cookie(AUTH_COOKIES[surface], token, { ...baseOptions(), maxAge: app ? APP_SESSION_MS : SESSION_MS });
}

export function clearAuthCookie(res, surface) {
  res.clearCookie(AUTH_COOKIES[surface], baseOptions());
}

// Logout: clear every current and legacy session cookie.
export function clearAllAuthCookies(res) {
  [...Object.values(AUTH_COOKIES), ...LEGACY_AUTH_COOKIES].forEach((name) => res.clearCookie(name, baseOptions()));
}

// The token from this request's cookies. `order` lists the surfaces to try, first match wins.
export function readAuthToken(req, order) {
  for (const surface of order) {
    const token = req.cookies?.[AUTH_COOKIES[surface]];
    if (token) return token;
  }
  return null;
}

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

// How often the signed-in user's role/rank/permissions are re-read from the server,
// so a change made by an admin shows up without a manual re-login.
const REFRESH_MS = 5 * 60 * 1000;
const FOCUS_THROTTLE_MS = 30 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const lastRefresh = useRef(0);

  useEffect(() => {
    api
      .me()
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  // Re-reads /auth/me. A 401 means the session ended (deactivated, password changed…);
  // network errors are ignored so a flaky connection never signs anyone out.
  const refresh = useCallback(async () => {
    lastRefresh.current = Date.now();
    try {
      const d = await api.me();
      setUser((prev) => (prev && JSON.stringify(prev) === JSON.stringify(d.user) ? prev : d.user));
    } catch (err) {
      if (err.status === 401) setUser(null);
    }
  }, []);

  const signedIn = Boolean(user);
  useEffect(() => {
    if (!signedIn) return undefined;
    const tick = setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > FOCUS_THROTTLE_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [signedIn, refresh]);

  const login = useCallback(async (email, password) => {
    const d = await api.login(email, password);
    lastRefresh.current = Date.now();
    setUser(d.user);
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

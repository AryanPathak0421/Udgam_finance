import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../../api/client.js';

const MemberAppContext = createContext(null);

export function MemberAppProvider({ children }) {
  const [memUser, setMemUser] = useState(() => {
    try {
      const saved = localStorage.getItem('udgam_member_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(() => {
    return localStorage.getItem('udgam_member_token') || null;
  });

  const [loading, setLoading] = useState(true);

  // Sync session on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('udgam_member_token');
    if (savedToken) {
      api.memberApp.profile()
        .then((res) => {
          if (res?.profile) {
            setMemUser(res.profile);
            localStorage.setItem('udgam_member_user', JSON.stringify(res.profile));
          }
        })
        .catch(() => {
          // Token expired or invalid
          logout();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  function login(userData, jwtToken) {
    setMemUser(userData);
    setToken(jwtToken);
    localStorage.setItem('udgam_member_token', jwtToken);
    localStorage.setItem('udgam_member_user', JSON.stringify(userData));
    document.cookie = `token=${jwtToken}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
  }

  function logout() {
    setMemUser(null);
    setToken(null);
    localStorage.removeItem('udgam_member_token');
    localStorage.removeItem('udgam_member_user');
    document.cookie = 'token=; path=/; max-age=0';
  }

  return (
    <MemberAppContext.Provider
      value={{
        memUser,
        token,
        loading,
        isAuthenticated: Boolean(memUser && token),
        login,
        logout,
      }}
    >
      {children}
    </MemberAppContext.Provider>
  );
}

export function useMemberApp() {
  const ctx = useContext(MemberAppContext);
  if (!ctx) {
    throw new Error('useMemberApp must be used within a MemberAppProvider');
  }
  return ctx;
}


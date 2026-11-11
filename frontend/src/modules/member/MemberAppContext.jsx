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

  // Handle unauthorized or expired member session globally
  useEffect(() => {
    function handleMemberAuthExpired() {
      logout();
    }
    window.addEventListener('member:auth:expired', handleMemberAuthExpired);
    return () => window.removeEventListener('member:auth:expired', handleMemberAuthExpired);
  }, []);

  function login(userData, jwtToken) {
    setMemUser(userData);
    setToken(jwtToken);
    localStorage.setItem('udgam_member_token', jwtToken);
    localStorage.setItem('udgam_member_user', JSON.stringify(userData));
    document.cookie = `udgam_member_token=${jwtToken}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
  }

  function logout() {
    setMemUser(null);
    setToken(null);
    localStorage.removeItem('udgam_member_token');
    localStorage.removeItem('udgam_member_user');
    document.cookie = 'udgam_member_token=; path=/; max-age=0; SameSite=Lax';
    api.memberApp.logout();
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


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

  const [loading, setLoading] = useState(true);

  // Sync session on mount
  // The session is the httpOnly cookie: ask the server whose it is. No valid session means signed out.
  useEffect(() => {
    api.memberApp.profile()
      .then((res) => {
        if (res?.profile) {
          setMemUser(res.profile);
          localStorage.setItem('udgam_member_user', JSON.stringify(res.profile));
        }
      })
      .catch(() => {
        setMemUser(null);
        localStorage.removeItem('udgam_member_user');
      })
      .finally(() => setLoading(false));
  }, []);

  // Handle unauthorized or expired member session globally
  useEffect(() => {
    function handleMemberAuthExpired() {
      logout();
    }
    window.addEventListener('member:auth:expired', handleMemberAuthExpired);
    return () => window.removeEventListener('member:auth:expired', handleMemberAuthExpired);
  }, []);

  function login(userData) {
    setMemUser(userData);
    localStorage.setItem('udgam_member_user', JSON.stringify(userData));
  }

  function logout() {
    setMemUser(null);
    localStorage.removeItem('udgam_member_user');
    api.memberApp.logout();
  }

  return (
    <MemberAppContext.Provider
      value={{
        memUser,
        loading,
        isAuthenticated: Boolean(memUser),
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


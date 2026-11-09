import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MemberAppProvider, useMemberApp } from './MemberAppContext.jsx';
import MemberHeader from './components/MemberHeader.jsx';
import MemberBottomNav from './components/MemberBottomNav.jsx';
import MemberPwaInstallBanner from './components/MemberPwaInstallBanner.jsx';

import MemberLogin from './pages/MemberLogin.jsx';
import MemberRegisterMpin from './pages/MemberRegisterMpin.jsx';
import MemberHome from './pages/MemberHome.jsx';
import MemberLoans from './pages/MemberLoans.jsx';
import MemberLoanDetail from './pages/MemberLoanDetail.jsx';
import MemberEmiPay from './pages/MemberEmiPay.jsx';
import MemberNoc from './pages/MemberNoc.jsx';
import MemberSecurity from './pages/MemberSecurity.jsx';
import MemberComplaints from './pages/MemberComplaints.jsx';
import MemberKyc from './pages/MemberKyc.jsx';
import MemberSynopsis from './pages/MemberSynopsis.jsx';
import MemberHolidays from './pages/MemberHolidays.jsx';
import MemberPassbook from './pages/MemberPassbook.jsx';
import MemberApplyLoan from './pages/MemberApplyLoan.jsx';
import MemberProfile from './pages/MemberProfile.jsx';

import './member.css';

function MemberAppRoutes() {
  const { memUser, loading } = useMemberApp();
  const location = useLocation();

  // Dynamic status bar theme color and title switcher for Member Portal
  useEffect(() => {
    let themeColorMeta = document.querySelector('meta[name="theme-color"]');
    const prevTheme = themeColorMeta ? themeColorMeta.getAttribute('content') : '#107870';
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', '#059669');
    }

    const prevTitle = document.title;
    document.title = 'Udgam Member - Customer App';

    return () => {
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', prevTheme);
      }
      document.title = prevTitle;
    };
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="mem-app-shell">
        <div className="mem-app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: 'var(--mem-primary)', fontWeight: 800, fontSize: '1.1rem' }}>
            Udgam Member App
          </div>
          <div style={{ color: 'var(--mem-text-muted)', fontSize: '0.8rem', marginTop: 6 }}>
            Loading your portal…
          </div>
        </div>
      </div>
    );
  }

  const isAuthPage = location.pathname.includes('/login') || location.pathname.includes('/register-mpin');

  return (
    <div className="mem-app-shell">
      <div className="mem-app-container">
        {!isAuthPage && <MemberHeader />}

        <main className="mem-main-content">
          {!isAuthPage && <MemberPwaInstallBanner />}

          <Routes>
            {/* Public Auth routes */}
            <Route
              path="login"
              element={memUser ? <Navigate to="/member" replace /> : <MemberLogin />}
            />
            <Route
              path="register-mpin"
              element={memUser ? <Navigate to="/member" replace /> : <MemberRegisterMpin />}
            />

            {/* Protected Customer routes */}
            <Route
              path=""
              element={memUser ? <MemberHome /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="loans"
              element={memUser ? <MemberLoans /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="loans/:id"
              element={memUser ? <MemberLoanDetail /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="emi-pay"
              element={memUser ? <MemberEmiPay /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="noc"
              element={memUser ? <MemberNoc /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="noc/:id"
              element={memUser ? <MemberNoc /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="security"
              element={memUser ? <MemberSecurity /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="complaints"
              element={memUser ? <MemberComplaints /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="kyc"
              element={memUser ? <MemberKyc /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="synopsis"
              element={memUser ? <MemberSynopsis /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="holidays"
              element={memUser ? <MemberHolidays /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="passbook"
              element={memUser ? <MemberPassbook /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="apply-loan"
              element={memUser ? <MemberApplyLoan /> : <Navigate to="/member/login" replace />}
            />
            <Route
              path="profile"
              element={memUser ? <MemberProfile /> : <Navigate to="/member/login" replace />}
            />

            <Route path="*" element={<Navigate to="/member" replace />} />
          </Routes>
        </main>

        {!isAuthPage && <MemberBottomNav />}
      </div>
    </div>
  );
}

export default function MemberApp() {
  return (
    <MemberAppProvider>
      <MemberAppRoutes />
    </MemberAppProvider>
  );
}

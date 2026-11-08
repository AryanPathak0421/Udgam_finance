import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SupervisorAppProvider, useSupervisorApp } from './SupervisorAppContext.jsx';
import SupervisorHeader from './components/SupervisorHeader.jsx';
import SupervisorBottomNav from './components/SupervisorBottomNav.jsx';
import SupervisorPwaInstallBanner from './components/SupervisorPwaInstallBanner.jsx';

import SupervisorLogin from './pages/SupervisorLogin.jsx';
import SupervisorRegistration from './pages/SupervisorRegistration.jsx';
import SupervisorHome from './pages/SupervisorHome.jsx';
import SupervisorProfile from './pages/SupervisorProfile.jsx';
import SupervisorLoanCalculator from './pages/SupervisorLoanCalculator.jsx';
import SupervisorTodayDue from './pages/SupervisorTodayDue.jsx';
import SupervisorCollectionReport from './pages/SupervisorCollectionReport.jsx';
import SupervisorNewMember from './pages/SupervisorNewMember.jsx';
import SupervisorNewMemberReport from './pages/SupervisorNewMemberReport.jsx';
import SupervisorEmiPayment from './pages/SupervisorEmiPayment.jsx';
import SupervisorNpaRecovery from './pages/SupervisorNpaRecovery.jsx';
import SupervisorCenterVisits from './pages/SupervisorCenterVisits.jsx';
import SupervisorReports from './pages/SupervisorReports.jsx';
import SupervisorStaffAttendance from './pages/SupervisorStaffAttendance.jsx';
import SupervisorSalarySlips from './pages/SupervisorSalarySlips.jsx';
import SupervisorAttendance from './pages/SupervisorAttendance.jsx';
import SupervisorLeaveApproval from './pages/SupervisorLeaveApproval.jsx';
import SupervisorComplaints from './pages/SupervisorComplaints.jsx';
import SupervisorResignation from './pages/SupervisorResignation.jsx';
import SupervisorBranchTransferReport from './pages/SupervisorBranchTransferReport.jsx';
import SupervisorProductSaleReport from './pages/SupervisorProductSaleReport.jsx';
import SupervisorStaffRating from './pages/SupervisorStaffRating.jsx';
import SupervisorStaffRequisition from './pages/SupervisorStaffRequisition.jsx';
import SupervisorStaffList from './pages/SupervisorStaffList.jsx';
import SupervisorTasks from './pages/SupervisorTasks.jsx';

import './supervisor.css';

function SupervisorAppRoutes() {
  const { supUser } = useSupervisorApp();
  const location = useLocation();

  // Dynamic PWA manifest, theme color, and title switcher for Supervisor
  useEffect(() => {
    let manifestLink = document.querySelector('link[rel="manifest"]');
    const prevManifest = manifestLink ? manifestLink.getAttribute('href') : '/manifest.webmanifest';
    if (manifestLink) {
      manifestLink.setAttribute('href', '/manifest-supervisor.webmanifest');
    }

    let themeColorMeta = document.querySelector('meta[name="theme-color"]');
    const prevTheme = themeColorMeta ? themeColorMeta.getAttribute('content') : '#107870';
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', '#0f766e');
    }

    let appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const prevAppleTitle = appleTitleMeta ? appleTitleMeta.getAttribute('content') : 'Udgam Staff';
    if (appleTitleMeta) {
      appleTitleMeta.setAttribute('content', 'Udgam Supervisor');
    }

    const prevTitle = document.title;
    document.title = 'Udgam Microfinance - Supervisor Portal';

    return () => {
      if (manifestLink) manifestLink.setAttribute('href', prevManifest);
      if (themeColorMeta) themeColorMeta.setAttribute('content', prevTheme);
      if (appleTitleMeta) appleTitleMeta.setAttribute('content', prevAppleTitle);
      document.title = prevTitle;
    };
  }, []);

  const isAuthPage =
    location.pathname.includes('/login') ||
    location.pathname.includes('/register') ||
    location.pathname.includes('/create-mpin');

  return (
    <div className="sup-app-shell">
      <div className="sup-app-container">
        {!isAuthPage && <SupervisorHeader />}

        <main style={{ flex: 1, paddingBottom: !isAuthPage ? 80 : 0 }}>
          <div style={{ padding: '10px 16px 0', maxWidth: 480, margin: '0 auto' }}>
            <SupervisorPwaInstallBanner />
          </div>

          <Routes>
            <Route path="login" element={supUser ? <Navigate to="/supervisor" replace /> : <SupervisorLogin />} />
            <Route path="register" element={<SupervisorRegistration />} />
            <Route path="register-mpin" element={<SupervisorRegistration />} />
            <Route path="create-mpin" element={<SupervisorRegistration />} />

            {/* Authenticated Supervisor Routes */}
            <Route path="" element={supUser ? <SupervisorHome /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="profile" element={supUser ? <SupervisorProfile /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="calculator" element={supUser ? <SupervisorLoanCalculator /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="today-due" element={supUser ? <SupervisorTodayDue /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="collection-paid" element={supUser ? <SupervisorCollectionReport /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="new-member" element={supUser ? <SupervisorNewMember /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="new-member-report" element={supUser ? <SupervisorNewMemberReport /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="emi-payment" element={supUser ? <SupervisorEmiPayment /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="npa-recovery" element={supUser ? <SupervisorNpaRecovery /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="staff-attendance" element={supUser ? <SupervisorStaffAttendance /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="center-visits" element={supUser ? <SupervisorCenterVisits /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="reports" element={supUser ? <SupervisorReports /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="salary-slips" element={supUser ? <SupervisorSalarySlips /> : <Navigate to="/supervisor/login" replace />} />
            
            {/* Sheet 2 Specific Routes (Items 20 to 30) */}
            <Route path="attendance-records" element={supUser ? <SupervisorAttendance /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="leaves" element={supUser ? <SupervisorLeaveApproval /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="complaints" element={supUser ? <SupervisorComplaints /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="resignation" element={supUser ? <SupervisorResignation /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="branch-transfers" element={supUser ? <SupervisorBranchTransferReport /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="product-sales" element={supUser ? <SupervisorProductSaleReport /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="staff-rating" element={supUser ? <SupervisorStaffRating /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="staff-requisition" element={supUser ? <SupervisorStaffRequisition /> : <Navigate to="/supervisor/login" replace />} />

            {/* New Special Sheet Requirements */}
            <Route path="team-staff" element={supUser ? <SupervisorStaffList /> : <Navigate to="/supervisor/login" replace />} />
            <Route path="tasks" element={supUser ? <SupervisorTasks /> : <Navigate to="/supervisor/login" replace />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/supervisor" replace />} />
          </Routes>
        </main>

        {!isAuthPage && supUser && <SupervisorBottomNav />}
      </div>
    </div>
  );
}

export default function SupervisorApp() {
  return (
    <SupervisorAppProvider>
      <SupervisorAppRoutes />
    </SupervisorAppProvider>
  );
}

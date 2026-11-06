import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SupervisorAppProvider, useSupervisorApp } from './SupervisorAppContext.jsx';
import SupervisorHeader from './components/SupervisorHeader.jsx';
import SupervisorBottomNav from './components/SupervisorBottomNav.jsx';

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

import './supervisor.css';

function SupervisorAppRoutes() {
  const { supUser } = useSupervisorApp();
  const location = useLocation();

  const isAuthPage =
    location.pathname.includes('/login') ||
    location.pathname.includes('/register') ||
    location.pathname.includes('/create-mpin');

  return (
    <div className="sup-app-shell">
      <div className="sup-app-container">
        {!isAuthPage && <SupervisorHeader />}

        <main style={{ flex: 1, paddingBottom: !isAuthPage ? 80 : 0 }}>
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


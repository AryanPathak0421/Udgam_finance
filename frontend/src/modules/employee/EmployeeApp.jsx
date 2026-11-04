import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { EmployeeAppProvider, useEmployeeApp } from './EmployeeAppContext.jsx';
import EmployeeHeader from './components/EmployeeHeader.jsx';
import EmployeeBottomNav from './components/EmployeeBottomNav.jsx';

import EmployeeLogin from './pages/EmployeeLogin.jsx';
import EmployeeRegistration from './pages/EmployeeRegistration.jsx';
import EmployeeHome from './pages/EmployeeHome.jsx';
import EmployeeProfile from './pages/EmployeeProfile.jsx';
import EmployeeLoanCalculator from './pages/EmployeeLoanCalculator.jsx';
import EmployeeCollectionHistory from './pages/EmployeeCollectionHistory.jsx';
import EmployeeTodayDue from './pages/EmployeeTodayDue.jsx';
import EmployeeNewMember from './pages/EmployeeNewMember.jsx';
import EmployeeMemberKyc from './pages/EmployeeMemberKyc.jsx';
import EmployeeGuarantorChange from './pages/EmployeeGuarantorChange.jsx';
import EmployeeMemberSynopsis from './pages/EmployeeMemberSynopsis.jsx';
import EmployeeLoanRequisition from './pages/EmployeeLoanRequisition.jsx';

import './employee.css';

function EmployeeAppRoutes() {
  const { empUser, loading } = useEmployeeApp();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--emp-bg)' }}>
        <div style={{ color: 'var(--emp-primary)', fontWeight: 700 }}>Loading Employee Portal...</div>
      </div>
    );
  }

  const isAuthPage = location.pathname.includes('/login') || location.pathname.includes('/register');

  return (
    <div className="emp-app-shell">
      <div className="emp-app-container">
        {!isAuthPage && <EmployeeHeader />}

        <main style={{ flex: 1, paddingBottom: !isAuthPage ? 80 : 0 }}>
          <Routes>
            <Route path="login" element={empUser ? <Navigate to="/employee" replace /> : <EmployeeLogin />} />
            <Route path="register" element={<EmployeeRegistration />} />

            {/* Authenticated routes */}
            <Route path="" element={empUser ? <EmployeeHome /> : <Navigate to="/employee/login" replace />} />
            <Route path="profile" element={empUser ? <EmployeeProfile /> : <Navigate to="/employee/login" replace />} />
            <Route path="calculator" element={empUser ? <EmployeeLoanCalculator /> : <Navigate to="/employee/login" replace />} />
            <Route path="collection-history" element={empUser ? <EmployeeCollectionHistory /> : <Navigate to="/employee/login" replace />} />
            <Route path="today-due" element={empUser ? <EmployeeTodayDue /> : <Navigate to="/employee/login" replace />} />
            <Route path="new-member" element={empUser ? <EmployeeNewMember /> : <Navigate to="/employee/login" replace />} />
            <Route path="kyc" element={empUser ? <EmployeeMemberKyc /> : <Navigate to="/employee/login" replace />} />
            <Route path="guarantor-change" element={empUser ? <EmployeeGuarantorChange /> : <Navigate to="/employee/login" replace />} />
            <Route path="synopsis" element={empUser ? <EmployeeMemberSynopsis /> : <Navigate to="/employee/login" replace />} />
            <Route path="requisition" element={empUser ? <EmployeeLoanRequisition /> : <Navigate to="/employee/login" replace />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/employee" replace />} />
          </Routes>
        </main>

        {!isAuthPage && empUser && <EmployeeBottomNav />}
      </div>
    </div>
  );
}

export default function EmployeeApp() {
  return (
    <EmployeeAppProvider>
      <EmployeeAppRoutes />
    </EmployeeAppProvider>
  );
}

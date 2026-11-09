import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { EmployeeAppProvider, useEmployeeApp } from './EmployeeAppContext.jsx';
import EmployeeHeader from './components/EmployeeHeader.jsx';
import EmployeeBottomNav from './components/EmployeeBottomNav.jsx';
import PwaInstallBanner from './components/PwaInstallBanner.jsx';

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
import EmployeeGuarantorNominee from './pages/EmployeeGuarantorNominee.jsx';
import EmployeeMemberSynopsis from './pages/EmployeeMemberSynopsis.jsx';
import EmployeeLoanRequisition from './pages/EmployeeLoanRequisition.jsx';
import EmployeeEmiPayment from './pages/EmployeeEmiPayment.jsx';
import EmployeeAdvancePayment from './pages/EmployeeAdvancePayment.jsx';
import EmployeeNpaRecovery from './pages/EmployeeNpaRecovery.jsx';
import EmployeeTrackLoan from './pages/EmployeeTrackLoan.jsx';
import EmployeeBorrowerSavings from './pages/EmployeeBorrowerSavings.jsx';
import EmployeeReports from './pages/EmployeeReports.jsx';
import EmployeeAttendance from './pages/EmployeeAttendance.jsx';
import EmployeeSalarySlips from './pages/EmployeeSalarySlips.jsx';
import EmployeeCenterVisits from './pages/EmployeeCenterVisits.jsx';
import EmployeeHrServices from './pages/EmployeeHrServices.jsx';
import EmployeeProductSale from './pages/EmployeeProductSale.jsx';
import EmployeeTasks from './pages/EmployeeTasks.jsx';
import EmployeeHolidays from './pages/EmployeeHolidays.jsx';
import EmployeeCivilCheck from './pages/EmployeeCivilCheck.jsx';
import EmployeeDeathRequest from './pages/EmployeeDeathRequest.jsx';
import EmployeeNotifications from './pages/EmployeeNotifications.jsx';

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

  const isAuthPage = location.pathname.includes('/login') || location.pathname.includes('/register') || location.pathname.includes('/create-mpin');

  return (
    <div className="emp-app-shell">
      <div className="emp-app-container">
        {!isAuthPage && <EmployeeHeader />}

        <main style={{ flex: 1, paddingBottom: !isAuthPage ? 80 : 0 }}>
          <div style={{ padding: '10px 16px 0', maxWidth: 480, margin: '0 auto' }}>
            <PwaInstallBanner />
          </div>
          <Routes>
            <Route path="login" element={empUser ? <Navigate to="/employee" replace /> : <EmployeeLogin />} />
            <Route path="register" element={<EmployeeRegistration />} />
            <Route path="register-mpin" element={<EmployeeRegistration />} />
            <Route path="create-mpin" element={<EmployeeRegistration />} />

            {/* Authenticated routes */}
            <Route path="" element={empUser ? <EmployeeHome /> : <Navigate to="/employee/login" replace />} />
            <Route path="profile" element={empUser ? <EmployeeProfile /> : <Navigate to="/employee/login" replace />} />
            <Route path="calculator" element={empUser ? <EmployeeLoanCalculator /> : <Navigate to="/employee/login" replace />} />
            <Route path="collection-history" element={empUser ? <EmployeeCollectionHistory /> : <Navigate to="/employee/login" replace />} />
            <Route path="today-due" element={empUser ? <EmployeeTodayDue /> : <Navigate to="/employee/login" replace />} />
            <Route path="new-member" element={empUser ? <EmployeeNewMember /> : <Navigate to="/employee/login" replace />} />
            <Route path="kyc" element={empUser ? <EmployeeMemberKyc /> : <Navigate to="/employee/login" replace />} />
            <Route path="guarantor-nominee" element={empUser ? <EmployeeGuarantorNominee /> : <Navigate to="/employee/login" replace />} />
            <Route path="guarantor-change" element={empUser ? <EmployeeGuarantorNominee /> : <Navigate to="/employee/login" replace />} />
            <Route path="synopsis" element={empUser ? <EmployeeMemberSynopsis /> : <Navigate to="/employee/login" replace />} />
            <Route path="requisition" element={empUser ? <EmployeeLoanRequisition /> : <Navigate to="/employee/login" replace />} />
            <Route path="emi-payment" element={empUser ? <EmployeeEmiPayment /> : <Navigate to="/employee/login" replace />} />
            <Route path="advance-payment" element={empUser ? <EmployeeAdvancePayment /> : <Navigate to="/employee/login" replace />} />
            <Route path="npa-recovery" element={empUser ? <EmployeeNpaRecovery /> : <Navigate to="/employee/login" replace />} />
            <Route path="track-loan" element={empUser ? <EmployeeTrackLoan /> : <Navigate to="/employee/login" replace />} />
            <Route path="borrower-savings" element={empUser ? <EmployeeBorrowerSavings /> : <Navigate to="/employee/login" replace />} />
            <Route path="reports" element={empUser ? <EmployeeReports /> : <Navigate to="/employee/login" replace />} />
            <Route path="attendance" element={empUser ? <EmployeeAttendance /> : <Navigate to="/employee/login" replace />} />
            <Route path="salary-slips" element={empUser ? <EmployeeSalarySlips /> : <Navigate to="/employee/login" replace />} />
            <Route path="center-visits" element={empUser ? <EmployeeCenterVisits /> : <Navigate to="/employee/login" replace />} />
            <Route path="hr-services" element={empUser ? <EmployeeHrServices /> : <Navigate to="/employee/login" replace />} />
            <Route path="product-sale" element={empUser ? <EmployeeProductSale /> : <Navigate to="/employee/login" replace />} />
            <Route path="tasks" element={empUser ? <EmployeeTasks /> : <Navigate to="/employee/login" replace />} />
            <Route path="holidays" element={empUser ? <EmployeeHolidays /> : <Navigate to="/employee/login" replace />} />
            <Route path="civil-check" element={empUser ? <EmployeeCivilCheck /> : <Navigate to="/employee/login" replace />} />
            <Route path="death-request" element={empUser ? <EmployeeDeathRequest /> : <Navigate to="/employee/login" replace />} />
            <Route path="notifications" element={empUser ? <EmployeeNotifications /> : <Navigate to="/employee/login" replace />} />

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


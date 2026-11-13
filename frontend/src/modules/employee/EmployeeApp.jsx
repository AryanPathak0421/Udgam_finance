import React, { Component } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { EmployeeAppProvider, useEmployeeApp } from './EmployeeAppContext.jsx';

class EmpErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('EmpErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: 'center', margin: '24px auto', maxWidth: 420, background: '#fff', borderRadius: 12, border: '1px solid #fee2e2' }}>
          <h3 style={{ color: '#dc2626', marginBottom: 8, fontSize: '1rem' }}>Page Rendering Error</h3>
          <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: 14 }}>
            {this.state.error?.message || 'An unexpected error occurred while loading this page.'}
          </p>
          <button
            type="button"
            className="emp-btn-primary"
            style={{ width: 'auto', padding: '6px 18px', fontSize: '0.84rem' }}
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
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
  const { empUser, loading, logout } = useEmployeeApp();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--emp-bg)' }}>
        <div style={{ color: 'var(--emp-primary)', fontWeight: 700 }}>Loading Employee Portal...</div>
      </div>
    );
  }

  // Supervisor account notification banner (non-blocking so field staff & branch managers can use both apps)
  const isSupervisor = Boolean(empUser?.isSupervisor || ['supervisor'].includes(empUser?.role));

  const isAuthPage = location.pathname.includes('/login') || location.pathname.includes('/register') || location.pathname.includes('/create-mpin');

  return (
    <div className="emp-app-shell">
      <div className="emp-app-container">
        {!isAuthPage && <EmployeeHeader />}

        <main style={{ flex: 1, paddingBottom: !isAuthPage ? 80 : 0 }}>
          <div style={{ padding: '10px 16px 0', maxWidth: 480, margin: '0 auto' }}>
            <PwaInstallBanner />
          </div>
          <EmpErrorBoundary>
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
          </EmpErrorBoundary>
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


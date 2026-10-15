import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ModulePlaceholder from './pages/ModulePlaceholder.jsx';
import CompanyProfile from './pages/adminMaster/CompanyProfile.jsx';
import BranchMaster from './pages/adminMaster/BranchMaster.jsx';
import FinancialYear from './pages/adminMaster/FinancialYear.jsx';
import RankMaster from './pages/adminMaster/RankMaster.jsx';
import UserMaster from './pages/adminMaster/UserMaster.jsx';
import MenuPermission from './pages/adminMaster/MenuPermission.jsx';
import CodeSequence from './pages/adminMaster/CodeSequence.jsx';
import BankAccountMaster from './pages/adminMaster/BankAccountMaster.jsx';
import CommissionMaster from './pages/adminMaster/CommissionMaster.jsx';
import VoucherMaster from './pages/adminMaster/VoucherMaster.jsx';
import LoanCalculator from './pages/adminMaster/LoanCalculator.jsx';
import LoanScheme from './pages/adminMaster/LoanScheme.jsx';
import AccountGroupMaster from './pages/adminMaster/AccountGroupMaster.jsx';
import LedgerMaster from './pages/adminMaster/LedgerMaster.jsx';
import NewBorrower from './pages/NewBorrower.jsx';
import GuarantorNominee from './pages/GuarantorNominee.jsx';
import KycApproval from './pages/KycApproval.jsx';
import GuarantorChange from './pages/GuarantorChange.jsx';
import BorrowerSynopsis from './pages/BorrowerSynopsis.jsx';
import BorrowerBlock from './pages/BorrowerBlock.jsx';
import Groups from './pages/Groups.jsx';
import GroupCreate from './pages/GroupCreate.jsx';
import { PersonalLoanRequisition, GroupLoanRequisition, BusinessLoanRequisition, ProductLoanRequisition } from './pages/PersonalLoanRequisition.jsx';
import RequisitionList from './pages/RequisitionList.jsx';
import GroupMembers from './pages/GroupMembers.jsx';
import GroupLeaderCommission from './pages/GroupLeaderCommission.jsx';
import Layout from './components/Layout.jsx';
import { routableItems, canOpenPath } from './config/nav.js';

// Pages that exist; every other nav path renders the placeholder.
const PAGES = {
  '/members/new-borrower': NewBorrower,
  '/members/guarantor-detail': GuarantorNominee,
  '/members/kyc-approval': KycApproval,
  '/members/guarantor-change': GuarantorChange,
  '/members/borrower-synopsis': BorrowerSynopsis,
  '/members/block-unblock': BorrowerBlock,
  '/loan-requisition/personal': PersonalLoanRequisition,
  '/loan-requisition/group': GroupLoanRequisition,
  '/loan-requisition/business': BusinessLoanRequisition,
  '/loan-requisition/product': ProductLoanRequisition,
  '/loan-requisition/list': RequisitionList,
  '/group-master/create': GroupCreate,
  '/group-master/list': Groups,
  '/group-master/members': GroupMembers,
  '/group-leader-commission': GroupLeaderCommission,
  '/admin-master/company-profile': CompanyProfile,
  '/admin-master/branches': BranchMaster,
  '/admin-master/financial-years': FinancialYear,
  '/admin-master/ranks': RankMaster,
  '/admin-master/users': UserMaster,
  '/admin-master/menu-permissions': MenuPermission,
  '/admin-master/code-sequences': CodeSequence,
  '/admin-master/bank-accounts': BankAccountMaster,
  '/admin-master/commissions': CommissionMaster,
  '/admin-master/vouchers': VoucherMaster,
  '/admin-master/loan-calculator': LoanCalculator,
  '/admin-master/loan-schemes': LoanScheme,
  '/admin-master/account-groups': AccountGroupMaster,
  '/admin-master/ledgers': LedgerMaster,
};

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Loading…</div>;
  return user ? children : <Navigate to="/login" replace />;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Loading…</div>;
  return user ? <Navigate to="/" replace /> : children;
}

// Route-level guard mirrors sidebar visibility (the backend still enforces RBAC).
function RequirePath({ path, children }) {
  const { user } = useAuth();
  return canOpenPath(user, path) ? children : <Navigate to="/" replace />;
}

const routes = routableItems().filter((i) => i.path !== '/');

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="/admin-master" element={<Navigate to="/admin-master/company-profile" replace />} />
        <Route path="/groups" element={<Navigate to="/group-master/list" replace />} />
        <Route path="/members/nominee-detail" element={<Navigate to="/members/guarantor-detail" replace />} />
        <Route path="/loan-requisition" element={<Navigate to="/loan-requisition/list" replace />} />
        <Route path="/group-master" element={<Navigate to="/group-master/list" replace />} />
        {routes.map((r) => {
          const Page = PAGES[r.path] || ModulePlaceholder;
          return <Route key={r.path} path={r.path} element={<RequirePath path={r.path}><Page /></RequirePath>} />;
        })}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}






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
import KycApproval, { KycReupload } from './pages/KycApproval.jsx';
import GuarantorChange from './pages/GuarantorChange.jsx';
import BorrowerSynopsis from './pages/BorrowerSynopsis.jsx';
import BorrowerBlock from './pages/BorrowerBlock.jsx';
import Groups from './pages/Groups.jsx';
import GroupCreate from './pages/GroupCreate.jsx';
import CivilCheck from './pages/CivilCheck.jsx';
import StockProductMaster from './pages/adminMaster/StockProductMaster.jsx';
import ProductOrders from './pages/ProductOrders.jsx';
import StockTransfer from './pages/StockTransfer.jsx';
import Cashbook from './pages/Cashbook.jsx';
import { PaymentVoucher, ReceiveVoucher, BankDeposit, BankWithdraw, BranchTransfer } from './pages/AccountEntries.jsx';
import { LoanLedger, RequisitionReport, ApprovalReport, DisbursementReport, DueReport, OverdueReport, OutstandingReport, EmiCollectionReport, MemberJoiningReport, NpaReport, PersonalCollectionSheet, MsmeCollectionSheet, GroupCollectionSheet, AllCollectionSheet, WriteOffReport, StaffNpaReport, StaffNpaPaymentReport, StaffDisbursementReport, GroupCollectionReport } from './pages/Reports.jsx';
import CenterSurveys from './pages/CenterSurveys.jsx';
import { AppUsers, MemberApproval, EmiApproval } from './pages/AppSection.jsx';
import { StockEntry, QuantityReport } from './pages/StockEntryPages.jsx';
import { BulkNotification, HolidayMaster, ProfitLoss, ComplaintOverview, CompanySummary, Monitoring, CompanyGraph } from './pages/SuperAdminPages.jsx';
import { RoomRent, Tasks, Complaints, Requirements, LeaveApply, LeaveApproval, Resignations, PromotionTransfer, Letters, EmployeeList } from './pages/HrExtraPages.jsx';
import { DepartmentMaster, DesignationMaster, EmployeeRegistration, SetSalary, Attendance, SalaryGenerate, SalaryPayment, BranchSalary } from './pages/HrPages.jsx';
import DayClose from './pages/DayClose.jsx';
import DayCloseApproval from './pages/DayCloseApproval.jsx';
import { TrialBalance, BankBook, DayBook, ProductBranchDue } from './pages/AccountReports.jsx';
import { PersonalLoanRequisition, BusinessLoanRequisition, ProductLoanRequisition } from './pages/PersonalLoanRequisition.jsx';
import GroupLoanRequisition from './pages/GroupLoanRequisition.jsx';
import RequisitionList from './pages/RequisitionList.jsx';
import { PendingLoans, ApprovedLoans, RejectedLoans, GroupLoanApproval, PersonalLoanApproval, ProductLoanApproval, BusinessLoanApproval } from './pages/LoanApproval.jsx';
import { PendingPayments, PaidLoans } from './pages/LoanPayment.jsx';
import { RegularEmi, AdvanceEmi, EmiReceipts } from './pages/EmiPayment.jsx';
import { SingleLoanEmi, GroupLoanEmi } from './pages/EmiCollection.jsx';
import { LoanSettlement, DeathSettlement } from './pages/Settlement.jsx';
import { SecurityDeposits, SecurityWithdrawals, SecurityApproval, SecurityWithdraw } from './pages/Savings.jsx';
import GroupMembers from './pages/GroupMembers.jsx';
import GroupLeaderCommission from './pages/GroupLeaderCommission.jsx';
import CommissionGenerate from './pages/CommissionGenerate.jsx';
import GroupTransfer from './pages/GroupTransfer.jsx';
import MemberGroupTransfer from './pages/MemberGroupTransfer.jsx';
import Layout from './components/Layout.jsx';
import { routableItems, canOpenPath } from './config/nav.js';

// Pages that exist; every other nav path renders the placeholder.
const PAGES = {
  '/members/new-borrower': NewBorrower,
  '/members/guarantor-detail': GuarantorNominee,
  '/members/kyc-approval': KycApproval,
  '/members/kyc-reupload': KycReupload,
  '/members/guarantor-change': GuarantorChange,
  '/members/borrower-synopsis': BorrowerSynopsis,
  '/members/block-unblock': BorrowerBlock,
  '/loan-requisition/civil-check': CivilCheck,
  '/loan-requisition/personal': PersonalLoanRequisition,
  '/stock/products': StockProductMaster,
  '/stock/stock-entry': StockEntry,
  '/stock/quantity-report': QuantityReport,
  '/stock/orders': ProductOrders,
  '/stock/transfers': StockTransfer,
  '/cashbook': Cashbook,
  '/accounts/voucher-master': VoucherMaster,
  '/accounts/payment-voucher': PaymentVoucher,
  '/accounts/receive-voucher': ReceiveVoucher,
  '/accounts/bank-deposit': BankDeposit,
  '/accounts/bank-withdraw': BankWithdraw,
  '/accounts/branch-transfer': BranchTransfer,
  '/hr/departments': DepartmentMaster,
  '/hr/designations': DesignationMaster,
  '/hr/employees': EmployeeRegistration,
  '/hr/set-salary': SetSalary,
  '/hr/attendance': Attendance,
  '/hr/salary': SalaryGenerate,
  '/hr/salary-payment': SalaryPayment,
  '/hr/branch-salary': BranchSalary,
  '/super-admin/notifications': BulkNotification,
  '/super-admin/holidays': HolidayMaster,
  '/super-admin/profit-loss': ProfitLoss,
  '/super-admin/complaints': ComplaintOverview,
  '/super-admin/company-summary': CompanySummary,
  '/super-admin/monitoring': Monitoring,
  '/super-admin/graph': CompanyGraph,
  '/hr/room-rent': RoomRent,
  '/hr/tasks': Tasks,
  '/hr/complaints': Complaints,
  '/hr/requirements': Requirements,
  '/hr/leave-apply': LeaveApply,
  '/hr/leave-approval': LeaveApproval,
  '/hr/resignations': Resignations,
  '/hr/promotion-transfer': PromotionTransfer,
  '/hr/letters': Letters,
  '/hr/employee-list': EmployeeList,
  '/app/app-users': AppUsers,
  '/app/member-approval': MemberApproval,
  '/app/emi-approval': EmiApproval,
  '/reports/loan-ledger': LoanLedger,
  '/reports/requisition': RequisitionReport,
  '/reports/approval': ApprovalReport,
  '/reports/disbursement': DisbursementReport,
  '/reports/due': DueReport,
  '/reports/overdue': OverdueReport,
  '/reports/outstanding': OutstandingReport,
  '/reports/emi-collection': EmiCollectionReport,
  '/reports/member-joining': MemberJoiningReport,
  '/reports/npa': NpaReport,
  '/reports/personal-collection-sheet': PersonalCollectionSheet,
  '/reports/msme-collection-sheet': MsmeCollectionSheet,
  '/reports/group-collection-sheet': GroupCollectionSheet,
  '/reports/collection-sheet': AllCollectionSheet,
  '/reports/write-off': WriteOffReport,
  '/reports/staff-npa': StaffNpaReport,
  '/reports/staff-npa-payment': StaffNpaPaymentReport,
  '/reports/staff-disbursement': StaffDisbursementReport,
  '/reports/group-collection': GroupCollectionReport,
  '/reports/center-survey': CenterSurveys,
  '/accounts/denomination': DayClose,
  '/accounts/day-close-approval': DayCloseApproval,
  '/accounts/trial-balance': TrialBalance,
  '/accounts/bank-book': BankBook,
  '/accounts/day-book': DayBook,
  '/accounts/product-branch-due': ProductBranchDue,
  '/loan-requisition/group': GroupLoanRequisition,
  '/loan-requisition/business': BusinessLoanRequisition,
  '/loan-requisition/product': ProductLoanRequisition,
  '/loan-requisition/list': RequisitionList,
  '/emi/single': SingleLoanEmi,
  '/emi/group': GroupLoanEmi,
  '/emi/payment': RegularEmi,
  '/emi/advance': AdvanceEmi,
  '/emi/receipts': EmiReceipts,
  '/savings/deposits': SecurityDeposits,
  '/savings/withdrawals': SecurityWithdrawals,
  '/savings/withdraw': SecurityWithdraw,
  '/savings/approval': SecurityApproval,
  '/emi/settlement': LoanSettlement,
  '/emi/death-settlement': DeathSettlement,
  '/loan-payment/pending': PendingPayments,
  '/loan-payment/paid': PaidLoans,
  '/loan-approval/pending': PendingLoans,
  '/loan-approval/group': GroupLoanApproval,
  '/loan-approval/personal': PersonalLoanApproval,
  '/loan-approval/product': ProductLoanApproval,
  '/loan-approval/business': BusinessLoanApproval,
  '/loan-approval/approved': ApprovedLoans,
  '/loan-approval/rejected': RejectedLoans,
  '/group-master/create': GroupCreate,
  '/group-master/list': Groups,
  '/group-master/members': GroupMembers,
  '/group-master/transfer': GroupTransfer,
  '/group-master/member-transfer': MemberGroupTransfer,
  '/group-leader-commission': GroupLeaderCommission,
  '/commission/generate': CommissionGenerate,
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






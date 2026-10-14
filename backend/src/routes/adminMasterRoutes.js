import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import { getCompany, saveCompany } from '../controllers/companyController.js';
import {
  listBranches,
  branchOptions,
  getBranch,
  createBranch,
  updateBranch,
  setBranchStatus,
  deleteBranch,
} from '../controllers/branchController.js';
import {
  listFinancialYears,
  getActiveFinancialYear,
  previewFinancialYear,
  createFinancialYear,
  updateFinancialYear,
  activateFinancialYear,
  deleteFinancialYear,
} from '../controllers/financialYearController.js';
import { listRanks, rankOptions, createRank, updateRank, setRankStatus, deleteRank } from '../controllers/rankController.js';
import { listUsers, createUser, updateUser, setUserStatus, resetUserPassword } from '../controllers/userController.js';
import { getCatalogue, getRankPermissions, saveRankPermissions } from '../controllers/menuPermissionController.js';
import { listSequences, createSequence, updateSequence, deleteSequence } from '../controllers/codeSequenceController.js';
import {
  listBankAccounts,
  createBankAccount,
  updateBankAccount,
  setBankAccountStatus,
  deleteBankAccount,
} from '../controllers/bankAccountController.js';
import {
  listCommissions,
  createCommission,
  updateCommission,
  setCommissionStatus,
  deleteCommission,
} from '../controllers/commissionController.js';
import { listVouchers, createVoucher, updateVoucher, setVoucherStatus, deleteVoucher } from '../controllers/voucherController.js';
import { getLoanCalculatorOptions, runLoanCalculator } from '../controllers/loanCalculatorController.js';
import { getStates, getCities } from '../controllers/metaController.js';

const router = Router();
// Admin Master is configuration data: only super_admin/admin may view or change it.
const adminOnly = [requireAuth, requireRole('super_admin', 'admin')];

router.get('/meta/states', ...adminOnly, getStates);
router.get('/meta/cities', ...adminOnly, getCities);

router.get('/company', ...adminOnly, h(getCompany));
router.put('/company', ...adminOnly, h(saveCompany));

router.get('/branches', ...adminOnly, h(listBranches));
router.get('/branches/options', ...adminOnly, h(branchOptions));
router.post('/branches', ...adminOnly, h(createBranch));
router.get('/branches/:id', ...adminOnly, h(getBranch));
router.put('/branches/:id', ...adminOnly, h(updateBranch));
router.patch('/branches/:id/status', ...adminOnly, h(setBranchStatus));
router.delete('/branches/:id', ...adminOnly, h(deleteBranch));

router.get('/financial-years', ...adminOnly, h(listFinancialYears));
router.get('/financial-years/active', ...adminOnly, h(getActiveFinancialYear));
router.get('/financial-years/preview', ...adminOnly, h(previewFinancialYear));
router.post('/financial-years', ...adminOnly, h(createFinancialYear));
router.put('/financial-years/:id', ...adminOnly, h(updateFinancialYear));
router.patch('/financial-years/:id/activate', ...adminOnly, h(activateFinancialYear));
router.delete('/financial-years/:id', ...adminOnly, h(deleteFinancialYear));

router.get('/ranks', ...adminOnly, h(listRanks));
router.get('/ranks/options', ...adminOnly, h(rankOptions));
router.post('/ranks', ...adminOnly, h(createRank));
router.put('/ranks/:id', ...adminOnly, h(updateRank));
router.patch('/ranks/:id/status', ...adminOnly, h(setRankStatus));
router.delete('/ranks/:id', ...adminOnly, h(deleteRank));

router.get('/users', ...adminOnly, h(listUsers));
router.post('/users', ...adminOnly, h(createUser));
router.put('/users/:id', ...adminOnly, h(updateUser));
router.patch('/users/:id/status', ...adminOnly, h(setUserStatus));
router.patch('/users/:id/password', ...adminOnly, h(resetUserPassword));

router.get('/menu-permissions/catalogue', ...adminOnly, getCatalogue);
router.get('/menu-permissions/ranks/:id', ...adminOnly, h(getRankPermissions));
router.put('/menu-permissions/ranks/:id', ...adminOnly, h(saveRankPermissions));

router.get('/code-sequences', ...adminOnly, h(listSequences));
router.post('/code-sequences', ...adminOnly, h(createSequence));
router.put('/code-sequences/:type', ...adminOnly, h(updateSequence));
router.delete('/code-sequences/:type', ...adminOnly, h(deleteSequence));

router.get('/bank-accounts', ...adminOnly, h(listBankAccounts));
router.post('/bank-accounts', ...adminOnly, h(createBankAccount));
router.put('/bank-accounts/:id', ...adminOnly, h(updateBankAccount));
router.patch('/bank-accounts/:id/status', ...adminOnly, h(setBankAccountStatus));
router.delete('/bank-accounts/:id', ...adminOnly, h(deleteBankAccount));

router.get('/commissions', ...adminOnly, h(listCommissions));
router.post('/commissions', ...adminOnly, h(createCommission));
router.put('/commissions/:id', ...adminOnly, h(updateCommission));
router.patch('/commissions/:id/status', ...adminOnly, h(setCommissionStatus));
router.delete('/commissions/:id', ...adminOnly, h(deleteCommission));

router.get('/vouchers', ...adminOnly, h(listVouchers));
router.post('/vouchers', ...adminOnly, h(createVoucher));
router.put('/vouchers/:id', ...adminOnly, h(updateVoucher));
router.patch('/vouchers/:id/status', ...adminOnly, h(setVoucherStatus));
router.delete('/vouchers/:id', ...adminOnly, h(deleteVoucher));

router.get('/loan-calculator/options', ...adminOnly, getLoanCalculatorOptions);
router.post('/loan-calculator', ...adminOnly, runLoanCalculator);

export default router;




import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler as h } from '../utils/http.js';
import {
  departments, designations, listEmployees, getEmployee, employeePincode, pendingVerification, supervisorTransfer, sendEmployeeOtp, verifyEmployeeOtp, verifyEmployeeDocuments, saveSalarySetup, employeeStaffOptions, createEmployee, updateEmployee, setEmployeeStatus, syncFromUsers, hrOptions,
  hrBranchOptions, attendanceDay, markAttendance, setAttendanceLocation, punchAttendance, autoAttendance, generateSalary, listSalary, adjustSalary, sendSalary, paySalary, branchWiseSalary, monthWiseSalary, mySalarySlips,
} from '../controllers/hrController.js';

const router = Router();
const ADMIN = ['super_admin', 'admin'];
const HR = ['super_admin', 'admin', 'branch_manager', 'accountant']; // attendance and salary of their branches
const PAY = ['super_admin', 'admin', 'accountant'];
const PAYER = [...PAY, 'branch_manager']; // a branch pays the salaries of its own employees (the branch scope is applied)

router.get('/hr/options', requireAuth, requireRole(...HR), h(hrOptions));

router.get('/hr/departments', requireAuth, requireRole(...HR), h(departments.list));
router.post('/hr/departments', requireAuth, requireRole(...ADMIN), h(departments.create));
router.put('/hr/departments/:id', requireAuth, requireRole(...ADMIN), h(departments.update));
router.patch('/hr/departments/:id/status', requireAuth, requireRole(...ADMIN), h(departments.status));
router.delete('/hr/departments/:id', requireAuth, requireRole(...ADMIN), h(departments.remove));
router.get('/hr/designations', requireAuth, requireRole(...HR), h(designations.list));
router.post('/hr/designations', requireAuth, requireRole(...ADMIN), h(designations.create));
router.put('/hr/designations/:id', requireAuth, requireRole(...ADMIN), h(designations.update));
router.patch('/hr/designations/:id/status', requireAuth, requireRole(...ADMIN), h(designations.status));
router.delete('/hr/designations/:id', requireAuth, requireRole(...ADMIN), h(designations.remove));

router.get('/hr/employees', requireAuth, requireRole(...HR), h(listEmployees));
router.put('/hr/employees/:id/attendance-location', requireAuth, requireRole(...HR), h(setAttendanceLocation));
router.post('/hr/attendance/punch', requireAuth, h(punchAttendance));
router.post('/app/attendance/punch', requireAuth, h(punchAttendance));
router.post('/hr/supervisor-transfer', requireAuth, requireRole(...ADMIN), h(supervisorTransfer));
router.get('/hr/employees/pending-verification', requireAuth, requireRole(...ADMIN), h(pendingVerification));
router.post('/hr/employees/:id/otp', requireAuth, requireRole(...ADMIN), h(sendEmployeeOtp));
router.post('/hr/employees/:id/otp/verify', requireAuth, requireRole(...ADMIN), h(verifyEmployeeOtp));
router.post('/hr/employees/:id/verify-documents', requireAuth, requireRole(...ADMIN), h(verifyEmployeeDocuments));
router.put('/hr/employees/:id/salary-setup', requireAuth, requireRole(...ADMIN), h(saveSalarySetup));
router.get('/hr/employees/pincode/:pin', requireAuth, requireRole(...ADMIN), h(employeePincode));
router.get('/hr/employees/staff-options', requireAuth, requireRole(...ADMIN), h(employeeStaffOptions));
router.get('/hr/employees/:id', requireAuth, requireRole(...ADMIN), h(getEmployee));
router.post('/hr/employees/sync-from-users', requireAuth, requireRole(...ADMIN), h(syncFromUsers));
router.post('/hr/employees', requireAuth, requireRole(...ADMIN), h(createEmployee));
router.put('/hr/employees/:id', requireAuth, requireRole(...ADMIN), h(updateEmployee));
router.patch('/hr/employees/:id/status', requireAuth, requireRole(...ADMIN), h(setEmployeeStatus));

router.get('/hr/attendance', requireAuth, requireRole(...HR), h(attendanceDay));
router.post('/hr/attendance', requireAuth, requireRole(...HR), h(markAttendance));
router.post('/hr/attendance/auto', requireAuth, requireRole(...HR), h(autoAttendance));

router.get('/hr/branch-options', requireAuth, requireRole(...HR), h(hrBranchOptions));
router.get('/hr/salary', requireAuth, requireRole(...HR), h(listSalary));
router.get('/hr/salary/branch-wise', requireAuth, requireRole(...HR), h(branchWiseSalary));
router.post('/hr/salary/generate', requireAuth, requireRole(...PAY), h(generateSalary));
router.patch('/hr/salary/:id', requireAuth, requireRole(...PAY), h(adjustSalary));
router.post('/hr/salary/send', requireAuth, requireRole(...PAY), h(sendSalary));
router.post('/hr/salary/pay', requireAuth, requireRole(...PAYER), h(paySalary));
router.get('/hr/salary/month-wise', requireAuth, requireRole(...HR), h(monthWiseSalary));
router.get('/hr/my-salary-slips', requireAuth, h(mySalarySlips));
router.get('/app/my-salary-slips', requireAuth, h(mySalarySlips));

export default router;

import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Employee, Department, Designation } from '../models/Hr.js';
import { Branch } from '../models/Branch.js';
import { EmployeeMpin } from '../modules/employee/employeeAppModel.js';

const mobile = process.env.SEED_MOBILE || '8643041429';
const mpin = process.env.SEED_MPIN || '0430';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/udgam_finance';
await mongoose.connect(uri);
console.log('Connected to MongoDB');

// 1. Get or create Branch
let branch = await Branch.findOne({ isDeleted: false });
if (!branch) {
  branch = await Branch.create({
    code: 'BR001',
    name: 'Head Office Branch',
    city: 'Patna',
    state: 'Bihar',
    pincode: '800001',
    address: 'Main Road',
    openingDate: new Date('2024-01-01'),
    isActive: true,
  });
  console.log('Created default branch:', branch.code);
}

// 2. Get or create Department & Designation
let dept = await Department.findOne({ name: 'Operations' });
if (!dept) {
  dept = await Department.create({ name: 'Operations', description: 'Field Operations & Collections' });
}

let desig = await Designation.findOne({ name: 'Field Officer' });
if (!desig) {
  desig = await Designation.create({ name: 'Field Officer', department: dept._id, level: 1 });
}

// 3. Find or create Employee & User
let emp = await Employee.findOne({ mobile });
let user = await User.findOne({ mobile });

const empCode = emp?.employeeCode || user?.employeeCode || `EMP${mobile.slice(-4)}`;

if (!user) {
  const email = `${empCode.toLowerCase()}@udgam.local`;
  user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name: 'Field Officer',
      email,
      mobile,
      employeeCode: empCode,
      password: 'password123',
      role: 'field_officer',
      branches: [branch._id],
      isActive: true,
    });
    console.log('Created User:', user.name, user.mobile, user.employeeCode);
  } else {
    user.mobile = mobile;
    user.employeeCode = empCode;
    user.isActive = true;
    await user.save();
  }
} else {
  user.isActive = true;
  if (!user.employeeCode) user.employeeCode = empCode;
  await user.save();
}

if (!emp) {
  emp = await Employee.create({
    employeeCode: empCode,
    user: user._id,
    name: user.name || 'Field Officer',
    email: user.email,
    mobile: mobile,
    branch: branch._id,
    department: dept._id,
    designation: desig._id,
    status: 'active',
    joiningDate: new Date(),
    salary: 25000,
  });
  console.log('Created Employee:', emp.name, emp.employeeCode, emp.mobile);
} else {
  emp.status = 'active';
  emp.user = user._id;
  if (!emp.branch) emp.branch = branch._id;
  await emp.save();
  console.log('Updated Employee:', emp.name, emp.employeeCode, emp.mobile);
}

// 4. Set EmployeeMpin
const mpinHash = await EmployeeMpin.hashMpin(mpin);
let mpinDoc = await EmployeeMpin.findOne({ employeeCode: emp.employeeCode });
if (mpinDoc) {
  mpinDoc.mpinHash = mpinHash;
  mpinDoc.mobile = mobile;
  mpinDoc.user = user._id;
  mpinDoc.employee = emp._id;
  await mpinDoc.save();
  console.log(`Updated EmployeeMpin for ${emp.employeeCode}: mobile=${mobile}, mpin=${mpin}`);
} else {
  mpinDoc = await EmployeeMpin.create({
    employee: emp._id,
    user: user._id,
    employeeCode: emp.employeeCode,
    mobile: mobile,
    email: emp.email,
    mpinHash,
    isSupervisor: false,
  });
  console.log(`Created EmployeeMpin for ${emp.employeeCode}: mobile=${mobile}, mpin=${mpin}`);
}

console.log('\n--- SEED SUCCESSFUL ---');
console.log('Mobile Number:', mobile);
console.log('Employee Code:', emp.employeeCode);
console.log('mPIN:', mpin);
console.log('Name:', emp.name);
console.log('Branch:', branch.name);
console.log('------------------------\n');

await mongoose.disconnect();

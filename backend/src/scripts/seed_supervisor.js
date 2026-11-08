import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Employee, Department, Designation } from '../models/Hr.js';
import { Branch } from '../models/Branch.js';
import { EmployeeMpin } from '../modules/employee/employeeAppModel.js';

const mobile = process.env.SEED_SUP_MOBILE || '9876543210';
const empCode = (process.env.SEED_SUP_CODE || 'SUP001').toUpperCase();
const mpin = process.env.SEED_SUP_MPIN || '1234';
const name = process.env.SEED_SUP_NAME || 'Rajesh Sharma (Supervisor)';
const email = process.env.SEED_SUP_EMAIL || 'supervisor@udgam.local';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/udgam_finance';
console.log('Connecting to MongoDB...');
await mongoose.connect(uri);
console.log('Connected to MongoDB');

// 1. Get or create Branches
let branches = await Branch.find({ isDeleted: false });
if (!branches.length) {
  const branch = await Branch.create({
    code: 'BR001',
    name: 'Head Office Branch',
    city: 'Patna',
    state: 'Bihar',
    pincode: '800001',
    address: 'Main Road',
    openingDate: new Date('2024-01-01'),
    isActive: true,
  });
  branches = [branch];
  console.log('Created default branch:', branch.code);
}
const primaryBranch = branches[0];
const allBranchIds = branches.map((b) => b._id);

// 2. Get or create Department & Designation
let dept = await Department.findOne({ name: 'Operations' });
if (!dept) {
  dept = await Department.create({ name: 'Operations', description: 'Field Operations & Supervisory Monitoring' });
}

let desig = await Designation.findOne({ name: 'Area Supervisor' });
if (!desig) {
  desig = await Designation.findOne({ name: { $regex: /supervisor/i } });
}
if (!desig) {
  desig = await Designation.create({ name: 'Area Supervisor', department: dept._id, level: 3 });
}

// 3. Find or create Supervisor User
let user = await User.findOne({
  $or: [{ mobile }, { employeeCode: empCode }, { email: email.toLowerCase() }],
});

if (!user) {
  user = await User.create({
    name,
    email: email.toLowerCase(),
    mobile,
    employeeCode: empCode,
    password: 'password123',
    role: 'branch_manager',
    branches: allBranchIds,
    isActive: true,
  });
  console.log('Created Supervisor User:', user.name, user.mobile, user.employeeCode);
} else {
  user.name = name;
  user.mobile = mobile;
  user.employeeCode = empCode;
  user.email = email.toLowerCase();
  user.role = 'branch_manager';
  user.branches = allBranchIds;
  user.isActive = true;
  await user.save();
  console.log('Updated Supervisor User:', user.name, user.employeeCode);
}

// 4. Find or create Supervisor Employee record
let emp = await Employee.findOne({
  $or: [{ mobile }, { employeeCode: empCode }, { email: email.toLowerCase() }],
  isDeleted: false,
});

if (!emp) {
  emp = await Employee.create({
    employeeCode: empCode,
    user: user._id,
    name,
    email: email.toLowerCase(),
    mobile,
    branch: primaryBranch._id,
    supervisedBranches: allBranchIds,
    department: dept._id,
    designation: desig._id,
    status: 'active',
    joiningDate: new Date('2024-01-01'),
    salary: 45000,
  });
  console.log('Created Supervisor Employee:', emp.name, emp.employeeCode, emp.mobile);
} else {
  emp.name = name;
  emp.status = 'active';
  emp.user = user._id;
  emp.branch = primaryBranch._id;
  emp.supervisedBranches = allBranchIds;
  emp.department = dept._id;
  emp.designation = desig._id;
  await emp.save();
  console.log('Updated Supervisor Employee:', emp.name, emp.employeeCode, emp.mobile);
}

// 5. Create or update EmployeeMpin
const mpinHash = await EmployeeMpin.hashMpin(mpin);
let mpinDoc = await EmployeeMpin.findOne({
  $or: [{ employeeCode: empCode }, { mobile }],
});

if (mpinDoc) {
  mpinDoc.employeeCode = empCode;
  mpinDoc.mobile = mobile;
  mpinDoc.email = email.toLowerCase();
  mpinDoc.mpinHash = mpinHash;
  mpinDoc.user = user._id;
  mpinDoc.employee = emp._id;
  mpinDoc.isSupervisor = true;
  await mpinDoc.save();
  console.log(`Updated EmployeeMpin for Supervisor: mobile=${mobile}, mpin=${mpin}`);
} else {
  mpinDoc = await EmployeeMpin.create({
    employee: emp._id,
    user: user._id,
    employeeCode: empCode,
    mobile,
    email: email.toLowerCase(),
    mpinHash,
    isSupervisor: true,
  });
  console.log(`Created EmployeeMpin for Supervisor: mobile=${mobile}, mpin=${mpin}`);
}

// 6. Link active field staff to this supervisor so supervisor sees their team
const staffUpdated = await Employee.updateMany(
  {
    isDeleted: false,
    _id: { $ne: emp._id },
    $or: [{ supervisor: null }, { supervisor: { $exists: false } }],
  },
  {
    $set: {
      supervisor: emp._id,
      supervisorCode: emp.employeeCode,
    },
  }
);
console.log(`Linked ${staffUpdated.modifiedCount} field staff to Supervisor ${emp.employeeCode}`);

console.log('\n======================================================');
console.log('       UDGAM SUPERVISOR SEED SUCCESSFUL');
console.log('======================================================');
console.log('  Mobile Number   : ', mobile);
console.log('  Supervisor Code : ', empCode);
console.log('  Secret mPIN     : ', mpin);
console.log('  Full Name       : ', name);
console.log('  Email           : ', email);
console.log('  Web Password    :  password123');
console.log('  Supervised      : ', branches.map((b) => b.name).join(', '));
console.log('======================================================\n');

await mongoose.disconnect();

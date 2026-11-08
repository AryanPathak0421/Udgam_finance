import { User } from '../models/User.js';
import { Employee, Department, Designation } from '../models/Hr.js';
import { Branch } from '../models/Branch.js';
import { EmployeeMpin } from '../modules/employee/employeeAppModel.js';

export async function ensureSupervisorSeed() {
  try {
    const mobile = process.env.SEED_SUP_MOBILE || '9876543210';
    const empCode = (process.env.SEED_SUP_CODE || 'SUP001').toUpperCase();
    const mpin = process.env.SEED_SUP_MPIN || '1234';
    const name = process.env.SEED_SUP_NAME || 'Rajesh Sharma (Supervisor)';
    const email = process.env.SEED_SUP_EMAIL || 'supervisor@udgam.local';

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
    }
    const primaryBranch = branches[0];
    const allBranchIds = branches.map((b) => b._id);

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
    } else {
      user.name = name;
      user.mobile = mobile;
      user.employeeCode = empCode;
      user.email = email.toLowerCase();
      user.role = 'branch_manager';
      user.branches = allBranchIds;
      user.isActive = true;
      await user.save();
    }

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
    } else {
      emp.name = name;
      emp.status = 'active';
      emp.user = user._id;
      emp.branch = primaryBranch._id;
      emp.supervisedBranches = allBranchIds;
      emp.department = dept._id;
      emp.designation = desig._id;
      await emp.save();
    }

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
    }

    await Employee.updateMany(
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

    console.log(`[Seed] Supervisor dummy credentials ready: ${mobile} (${empCode}) / mPIN: ${mpin}`);
  } catch (err) {
    console.warn('[Seed] Supervisor auto-seed notice:', err.message);
  }
}

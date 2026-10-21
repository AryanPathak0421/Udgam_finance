import mongoose from 'mongoose';

const ci = { locale: 'en', strength: 2 };

// ---- HR Department ------------------------------------------------------------------------------------------------------

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdByCode: String,
  },
  { timestamps: true }
);
departmentSchema.index({ name: 1 }, { unique: true, collation: ci, partialFilterExpression: { isDeleted: false } });
export const Department = mongoose.model('Department', departmentSchema);

const designationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdByCode: String,
  },
  { timestamps: true }
);
designationSchema.index({ name: 1 }, { unique: true, collation: ci, partialFilterExpression: { isDeleted: false } });
export const Designation = mongoose.model('Designation', designationSchema);

// An employee of the company: the HR record behind a staff login (User Master) or a person without a login yet.
const employeeSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true, uppercase: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // the staff login of this employee, when there is one
    name: { type: String, required: true, trim: true },
    mobile: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    designation: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation' },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    joiningDate: { type: Date },
    monthlySalaryPaise: { type: Number, default: 0, min: 0 },
    bankName: String,
    ifsc: { type: String, uppercase: true, trim: true },
    accountNumber: String,
    status: { type: String, enum: ['active', 'left'], default: 'active' },
    leftOn: Date,
    isDeleted: { type: Boolean, default: false },
    createdByCode: String,
  },
  { timestamps: true }
);
employeeSchema.index({ employeeCode: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
employeeSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { user: { $type: 'objectId' }, isDeleted: false } });
employeeSchema.index({ branch: 1, status: 1 });
export const Employee = mongoose.model('Employee', employeeSchema);

export const ATTENDANCE_STATUS = ['present', 'absent', 'half_day', 'leave', 'holiday'];
// One employee, one day. "auto" is worked out from what the employee did in the system that day; "manual" is marked by hand and is never overwritten by auto.
const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_STATUS, required: true },
    source: { type: String, enum: ['auto', 'manual'], default: 'manual' },
    firstActivity: Date,
    lastActivity: Date,
    remark: String,
    markedByCode: String,
  },
  { timestamps: true }
);
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });
export const Attendance = mongoose.model('Attendance', attendanceSchema);

export const SALARY_STATUS = ['generated', 'sent', 'paid'];
// The salary of one employee for one month, worked out from the attendance.
const salarySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    employeeCode: String,
    name: String,
    mobile: String,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    department: String,
    designation: String,
    month: { type: String, required: true }, // YYYY-MM
    daysInMonth: Number,
    sundays: Number,
    presentDays: Number,
    halfDays: Number,
    leaveDays: Number,
    holidayDays: Number,
    absentDays: Number, // including the days that were not marked
    unmarkedDays: Number,
    payableDays: Number,
    grossPaise: Number, // monthly salary
    earnedPaise: Number, // for the payable days
    bonusPaise: { type: Number, default: 0 },
    otherDeductionPaise: { type: Number, default: 0 },
    netPaise: Number,
    remark: String,
    status: { type: String, enum: SALARY_STATUS, default: 'generated' },
    sentAt: Date,
    sentTo: String,
    paidOn: Date,
    payMode: String,
    bankAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'BankAccount' },
    cashEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'CashEntry' }, // the Cashbook entry of the payment
    paidByCode: String,
    generatedByCode: String,
  },
  { timestamps: true }
);
salarySchema.index({ employee: 1, month: 1 }, { unique: true });
salarySchema.index({ month: 1, branch: 1 });
export const Salary = mongoose.model('Salary', salarySchema);

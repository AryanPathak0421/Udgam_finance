import mongoose from 'mongoose';

const ref = (to) => ({ type: mongoose.Schema.Types.ObjectId, ref: to });
const history = [{ _id: false, status: String, remark: String, byCode: String, at: Date }];

// Rent of the room (office) of a branch. Paying it is an entry of the branch Cashbook (Room rent).
const roomRentSchema = new mongoose.Schema(
  {
    branch: { ...ref('Branch'), required: true },
    month: { type: String, required: true }, // the month the rent is for, YYYY-MM
    landlord: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['room', 'messenger', 'other'], default: 'other' },
    party: ref('RentParty'),
    rentPaise: Number, // the rent; amountPaise is the total paid (rent + electricity)
    prevReading: Number, // the electricity meter of the room: old reading, current reading, units, rate and amount
    currentReading: Number,
    units: Number,
    perUnitPaise: Number,
    electricityPaise: { type: Number, default: 0 },
    meterPhoto: { type: String, select: false }, // photo of the current meter reading
    amountPaise: { type: Number, required: true, min: 100 },
    paidOn: { type: Date, required: true },
    payMode: { type: String, enum: ['cash', 'bank', 'upi', 'cheque'], required: true },
    bankAccount: ref('BankAccount'),
    reference: String,
    remark: String,
    status: { type: String, enum: ['paid', 'cancelled'], default: 'paid' },
    cancelReason: String,
    cashEntry: ref('CashEntry'),
    enteredByCode: String,
  },
  { timestamps: true }
);
roomRentSchema.index({ branch: 1, month: 1 });

// A room owner (with the electricity meter of the room, when it is included) or a messenger, registered by the admin; rent is paid to them in Room / Messenger Rent.
const rentPartySchema = new mongoose.Schema(
  {
    branch: { ...ref('Branch'), required: true },
    kind: { type: String, enum: ['room', 'messenger'], required: true },
    name: { type: String, required: true, trim: true },
    mobile: { type: String, trim: true },
    address: { type: String, trim: true },
    meterIncluded: { type: Boolean, default: false },
    meterPhoto: { type: String, select: false },
    openingReading: { type: Number, default: 0 },
    lastReading: { type: Number, default: 0 }, // the reading of the last rent paid: the old reading of the next one
    perUnitPaise: { type: Number, default: 0 },
    amountPaise: { type: Number, default: 0 }, // the monthly room rent, or the amount paid to the messenger
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdByCode: String,
  },
  { timestamps: true }
);
rentPartySchema.index({ branch: 1, kind: 1, isDeleted: 1 });
export const RentParty = mongoose.model('RentParty', rentPartySchema);
export const RoomRent = mongoose.model('RoomRent', roomRentSchema);

export const TASK_STATUS = ['open', 'in_progress', 'done', 'cancelled'];
const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: String,
    branch: ref('Branch'),
    assignedTo: { ...ref('Employee'), required: true },
    assignedToCode: String,
    assignedToName: String,
    dueDate: Date,
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: TASK_STATUS, default: 'open' },
    history,
    createdByCode: String,
  },
  { timestamps: true }
);
taskSchema.index({ status: 1, dueDate: 1 });
taskSchema.index({ branch: 1 });
export const Task = mongoose.model('Task', taskSchema);

export const COMPLAINT_STATUS = ['open', 'in_progress', 'resolved'];
// A complaint received on the toll free number.
const complaintSchema = new mongoose.Schema(
  {
    complaintNo: { type: String, required: true, uppercase: true },
    date: { type: Date, required: true },
    callerName: { type: String, required: true, trim: true },
    callerMobile: String,
    branch: ref('Branch'),
    memberCode: String,
    category: { type: String, enum: ['loan', 'emi', 'staff', 'insurance', 'other'], default: 'other' },
    // what the caller can tell about the member (all optional)
    husbandName: { type: String, trim: true },
    groupCode: { type: String, trim: true, uppercase: true },
    groupName: { type: String, trim: true },
    groupLeaderName: { type: String, trim: true },
    description: { type: String, required: true },
    assignedTo: ref('Employee'),
    assignedToCode: String,
    status: { type: String, enum: COMPLAINT_STATUS, default: 'open' },
    resolution: String,
    resolvedAt: Date,
    history,
    enteredByCode: String,
  },
  { timestamps: true }
);
complaintSchema.index({ complaintNo: 1 }, { unique: true });
complaintSchema.index({ status: 1, date: -1 });
export const Complaint = mongoose.model('Complaint', complaintSchema);

export const REQUIREMENT_STATUS = ['pending', 'approved', 'rejected', 'filled'];
// A branch asks for new employees.
const requirementSchema = new mongoose.Schema(
  {
    reqNo: { type: String, required: true, uppercase: true },
    branch: { ...ref('Branch'), required: true },
    department: ref('Department'),
    designation: ref('Designation'),
    count: { type: Number, required: true, min: 1 },
    reason: String,
    requiredBy: Date,
    expectedTime: { type: String, trim: true }, // in what time the employees are expected to join (e.g. 15 days)
    status: { type: String, enum: REQUIREMENT_STATUS, default: 'pending' },
    remark: String,
    decidedByCode: String,
    decidedAt: Date,
    requestedByCode: String,
  },
  { timestamps: true }
);
requirementSchema.index({ reqNo: 1 }, { unique: true });
requirementSchema.index({ status: 1, branch: 1 });
export const Requirement = mongoose.model('Requirement', requirementSchema);

export const LEAVE_TYPES = ['casual', 'sick', 'earned', 'other'];
const leaveSchema = new mongoose.Schema(
  {
    employee: { ...ref('Employee'), required: true },
    employeeCode: String,
    employeeName: String,
    branch: ref('Branch'),
    type: { type: String, enum: LEAVE_TYPES, default: 'casual' },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    days: Number, // calendar days without the Sundays (the weekly off)
    reason: String,
    approver: ref('Employee'), // the supervisor of the employee (set at the registration): the leave goes to them
    approverCode: String,
    approverName: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectReason: String,
    decisionRemark: String, // what the approver wrote when approving
    decidedByCode: String,
    decidedAt: Date,
    appliedByCode: String,
  },
  { timestamps: true }
);
leaveSchema.index({ status: 1, branch: 1, from: -1 });
leaveSchema.index({ employee: 1, from: 1 });
export const Leave = mongoose.model('Leave', leaveSchema);

const resignationSchema = new mongoose.Schema(
  {
    employee: { ...ref('Employee'), required: true },
    employeeCode: String,
    employeeName: String,
    branch: ref('Branch'),
    appliedOn: { type: Date, required: true },
    lastWorkingDate: { type: Date, required: true },
    noticePeriodDate: Date, // set when it is approved: the day the notice period ends (the employee leaves on it)
    reason: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectReason: String,
    decidedByCode: String,
    decidedAt: Date,
    appliedByCode: String,
  },
  { timestamps: true }
);
resignationSchema.index({ status: 1, branch: 1 });
export const Resignation = mongoose.model('Resignation', resignationSchema);

// A promotion (new designation, maybe a new salary) or a transfer (new branch) of an employee, with the letter number.
const changeSchema = new mongoose.Schema(
  {
    letterNo: { type: String, required: true, uppercase: true },
    kind: { type: String, enum: ['promotion', 'transfer'], required: true },
    employee: { ...ref('Employee'), required: true },
    employeeCode: String,
    employeeName: String,
    effectiveDate: { type: Date, required: true },
    fromDesignation: String,
    toDesignation: String,
    fromBranch: ref('Branch'),
    toBranch: ref('Branch'),
    fromBranchName: String,
    toBranchName: String,
    fromSalaryPaise: Number,
    toSalaryPaise: Number,
    salaryLines: [{ _id: false, key: String, label: String, amountPaise: Number }], // the salary boxes of a promotion (basic, HRA, ...) with their new amounts
    remark: String,
    byCode: String,
  },
  { timestamps: true }
);
changeSchema.index({ letterNo: 1 }, { unique: true });
changeSchema.index({ employee: 1, effectiveDate: -1 });
export const EmployeeChange = mongoose.model('EmployeeChange', changeSchema);

// A target task: for a period (from date to date) the employees of a rank (or chosen employees) get targets: new members, D6, new groups and NPA recovery.
// What is achieved is counted from the work in the system (D6 is entered by hand); what is still to do shows as pending (−).
const targetTaskSchema = new mongoose.Schema(
  {
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    rank: ref('Rank'),
    rankName: String,
    branch: ref('Branch'),
    employees: [{ _id: false, employee: ref('Employee'), code: String, name: String, branch: ref('Branch'), d6Achieved: { type: Number, default: 0 } }],
    targets: { newMember: { type: Number, default: 0 }, d6: { type: Number, default: 0 }, newGroup: { type: Number, default: 0 }, npaRecoveryPaise: { type: Number, default: 0 } },
    remark: String,
    status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
    createdByCode: String,
  },
  { timestamps: true }
);
targetTaskSchema.index({ fromDate: -1 });
export const TargetTask = mongoose.model('TargetTask', targetTaskSchema);

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const employeeMpinSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    employeeCode: { type: String, required: true, uppercase: true, trim: true, unique: true },
    mobile: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    mpinHash: { type: String, required: true, select: false },
    isSupervisor: { type: Boolean, default: false },
    ratings: [
      {
        _id: false,
        stars: { type: Number, min: 1, max: 5, required: true },
        review: String,
        supervisorCode: String,
        supervisorName: String,
        date: { type: Date, default: Date.now },
      },
    ],
    averageRating: { type: Number, default: 5 },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

employeeMpinSchema.methods.compareMpin = async function (enteredMpin) {
  return bcrypt.compare(String(enteredMpin), this.mpinHash);
};

employeeMpinSchema.statics.hashMpin = async function (plainMpin) {
  return bcrypt.hash(String(plainMpin), 10);
};

export const EmployeeMpin = mongoose.model('EmployeeMpin', employeeMpinSchema);

// Guarantor Change Request (Requested by Employee/Field Officer, Approved by Branch Manager)
const guarantorChangeRequestSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    memberCode: { type: String, required: true, uppercase: true },
    memberName: { type: String, required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    oldGuarantor: {
      name: String,
      mobile: String,
      aadhaar: String,
      relation: String,
      address: String,
    },
    newGuarantor: {
      name: { type: String, required: true, trim: true },
      mobile: { type: String, required: true, trim: true },
      aadhaar: { type: String, trim: true },
      relation: { type: String, required: true, trim: true },
      address: { type: String, trim: true },
      photo: String,
      signature: String,
      aadhaarPhoto: String,
      aadhaarBackPhoto: String,
      panPhoto: String,
      jointPhoto: String,
      pan: { type: String, trim: true },
    },
    reason: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    requestedByCode: { type: String, required: true },
    requestedByName: String,
    decidedByCode: String,
    decidedByName: String,
    decidedAt: Date,
    decisionRemark: String,
  },
  { timestamps: true }
);

guarantorChangeRequestSchema.index({ member: 1, status: 1 });
guarantorChangeRequestSchema.index({ branch: 1, status: 1 });

export const GuarantorChangeRequest = mongoose.model('GuarantorChangeRequest', guarantorChangeRequestSchema);

// -----------------------------------------------------------------------------
// NEW CENTER VISIT
// -----------------------------------------------------------------------------
const centerVisitSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true },
    employeeName: String,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    centerName: { type: String, required: true },
    contactName: { type: String, required: true },
    contactNumber: { type: String, required: true },
    location: {
      lat: Number,
      lng: Number,
      address: String,
    },
    image: String,
    visitDate: { type: Date, default: Date.now },
    notes: String,
  },
  { timestamps: true }
);

export const CenterVisit = mongoose.model('CenterVisit', centerVisitSchema);

// -----------------------------------------------------------------------------
// CGT (CONTINUOUS GROUP TRAINING) VISIT
// -----------------------------------------------------------------------------
const cgtVisitSchema = new mongoose.Schema(
  {
    centerName: { type: String, required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    employeeCode: { type: String, required: true },
    day1: {
      date: Date,
      photo: String,
      byCode: String,
    },
    day2: {
      date: Date,
      photo: String,
      byCode: String,
    },
    day3: {
      date: Date,
      photo: String,
      byCode: String,
    },
    status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
  },
  { timestamps: true }
);

export const CgtVisit = mongoose.model('CgtVisit', cgtVisitSchema);

// -----------------------------------------------------------------------------
// FIRST MEETING ATTENDANCE
// -----------------------------------------------------------------------------
const firstMeetingAttendanceSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true },
    employeeName: String,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    date: { type: Date, required: true },
    photo: { type: String, required: true },
    location: {
      lat: Number,
      lng: Number,
      address: String,
    },
    status: { type: String, default: 'present' },
  },
  { timestamps: true }
);
firstMeetingAttendanceSchema.index({ employeeCode: 1, date: 1 });

export const FirstMeetingAttendance = mongoose.model('FirstMeetingAttendance', firstMeetingAttendanceSchema);

// -----------------------------------------------------------------------------
// PRODUCT SALE ORDER
// -----------------------------------------------------------------------------
const productSaleOrderSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, uppercase: true },
    employeeCode: { type: String, required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    memberCode: { type: String, required: true },
    memberName: String,
    productCode: { type: String, required: true },
    productName: String,
    quantity: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    payMode: { type: String, enum: ['cash', 'upi', 'loan_adjust'], default: 'cash' },
    status: { type: String, enum: ['completed', 'pending'], default: 'completed' },
  },
  { timestamps: true }
);

export const ProductSaleOrder = mongoose.model('ProductSaleOrder', productSaleOrderSchema);



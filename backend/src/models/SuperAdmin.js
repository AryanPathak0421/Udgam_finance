import mongoose from 'mongoose';

const ref = (to) => ({ type: mongoose.Schema.Types.ObjectId, ref: to });

// A day the company is closed (Diwali, Holi ...). For all branches, or for one. It is a paid holiday in the salary.
const holidaySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    name: { type: String, required: true, trim: true },
    branch: { ...ref('Branch'), default: null }, // empty = every branch
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdByCode: String,
  },
  { timestamps: true }
);
holidaySchema.index({ date: 1, branch: 1 });
export const Holiday = mongoose.model('Holiday', holidaySchema);

export const AUDIENCES = ['all_staff', 'branch_staff', 'role_staff', 'all_members', 'branch_members'];
// A message the super admin sends to many people at once: to the staff in the app (the bell) and / or by SMS, or by SMS to the members.
const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    audience: { type: String, enum: AUDIENCES, required: true },
    branch: ref('Branch'),
    role: String,
    inApp: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
    recipients: { type: Number, default: 0 },
    appCount: { type: Number, default: 0 },
    smsSent: { type: Number, default: 0 },
    smsFailed: { type: Number, default: 0 },
    createdByCode: String,
    createdBy: ref('User'),
  },
  { timestamps: true }
);
notificationSchema.index({ createdAt: -1 });
export const Notification = mongoose.model('Notification', notificationSchema);

// The copy of a notification in the bell of one staff member.
const userNotificationSchema = new mongoose.Schema(
  {
    user: { ...ref('User'), required: true },
    notification: ref('Notification'),
    title: String,
    message: String,
    readAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
userNotificationSchema.index({ user: 1, createdAt: -1 });
export const UserNotification = mongoose.model('UserNotification', userNotificationSchema);

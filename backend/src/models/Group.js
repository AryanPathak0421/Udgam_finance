import mongoose from 'mongoose';

export const MEETING_TYPES = ['daily', 'weekly', 'monthly'];

// A borrowing group (JLG). The leader is the person who earns the group leader commission.
const groupSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    name: { type: String, required: true, trim: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    // After creation the opening date can only be changed by an Admin (enforced in the API).
    openingDate: { type: Date },
    // Staff ID of the employee who looks after the group (name is looked up from it).
    employeeCode: { type: String, trim: true, uppercase: true },
    leaderName: { type: String, required: true, trim: true },
    // OTPs go here. After a group is created only an Admin may change it (enforced in the API).
    leaderMobile: { type: String, required: true, trim: true },
    // Set when the number was verified with an OTP (groups made before that have none).
    leaderMobileVerifiedAt: { type: Date },
    // How often the group meets / collects. weekly: 1 (Mon) – 7 (Sun); monthly: day of month 1–28; daily: none.
    meetingType: { type: String, enum: MEETING_TYPES },
    collectionDay: { type: Number },
    meetingTime: { type: String }, // 'HH:MM', 24 hour
    members: [
      {
        _id: false,
        member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
        addedAt: { type: Date, default: Date.now },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    formationDate: { type: Date }, // legacy, replaced by openingDate
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

groupSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
groupSchema.index(
  { branch: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { isDeleted: false } }
);
groupSchema.index({ 'members.member': 1 });

export const Group = mongoose.model('Group', groupSchema);

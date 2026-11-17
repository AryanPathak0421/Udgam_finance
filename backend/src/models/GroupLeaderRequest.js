import mongoose from 'mongoose';

export const LEADER_REQUEST_STATUS = ['pending', 'approved', 'rejected'];

// A branch asks to change the leader of a group to one of the group's own members. Nothing changes until an admin approves:
// then the leader name and mobile of the group become the name and mobile of that member.
const groupLeaderRequestSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    groupCode: String,
    groupName: String,
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true }, // the member who becomes the leader
    memberCode: String,
    memberName: String,
    memberMobile: String,
    oldLeaderName: String,
    oldLeaderMobile: String,
    status: { type: String, enum: LEADER_REQUEST_STATUS, default: 'pending' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedByCode: String,
    requestedByName: String,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedByCode: String,
    decidedAt: Date,
    rejectReason: String,
  },
  { timestamps: true }
);

groupLeaderRequestSchema.index({ group: 1, status: 1 });
groupLeaderRequestSchema.index({ status: 1, createdAt: -1 });

export const GroupLeaderRequest = mongoose.model('GroupLeaderRequest', groupLeaderRequestSchema);

import mongoose from 'mongoose';

export const SURVEY_STATUS = ['surveyed', 'under_review', 'approved', 'rejected', 'formed'];

// The survey of a place where a new center (group) may be opened: who surveyed it, what was found, and where it stands (status update).
const centerSurveySchema = new mongoose.Schema(
  {
    surveyNo: { type: String, required: true, uppercase: true, trim: true, immutable: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    centerName: { type: String, required: true, trim: true },
    area: { type: String, trim: true }, // village / locality
    pincode: { type: String, trim: true },
    district: { type: String, trim: true },
    surveyDate: { type: Date, required: true },
    expectedMembers: { type: Number, min: 0, default: 0 },
    meetingType: { type: String, enum: ['daily', 'weekly', 'monthly', ''], default: '' },
    leaderName: { type: String, trim: true },
    leaderMobile: { type: String, trim: true },
    remark: { type: String, trim: true },
    status: { type: String, enum: SURVEY_STATUS, default: 'surveyed' },
    statusHistory: [{ _id: false, status: String, remark: String, byCode: String, at: Date }],
    surveyedByCode: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

centerSurveySchema.index({ surveyNo: 1 }, { unique: true });
centerSurveySchema.index({ branch: 1, surveyDate: -1 });
centerSurveySchema.index({ status: 1 });

export const CenterSurvey = mongoose.model('CenterSurvey', centerSurveySchema);

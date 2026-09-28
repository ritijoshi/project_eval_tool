const mongoose = require('mongoose');

const scoreBreakdownSchema = new mongoose.Schema(
  {
    score: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    reason: { type: String, default: '' },
  },
  { _id: false }
);

const assignmentStudentResultSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AssignmentEvalSession',
      required: true,
      index: true,
    },
    studentName: { type: String, default: '' },
    rollNumber: { type: String, default: '' },
    submissionType: {
      type: String,
      enum: ['text', 'code', 'mixed'],
      default: 'text',
    },
    submissionContent: { type: String, default: '' },
    evaluationStatus: {
      type: String,
      enum: ['COMPLETED', 'FAILED'],
      default: 'COMPLETED',
    },
    score: { type: Number, default: 0 },
    overallScore: { type: Number, default: null },
    maxScore: { type: Number, default: 0 },
    confidence: { type: Number, default: null },
    gradeLabel: { type: String, default: '' },
    scoreBreakdown: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    strengths: { type: [String], default: [] },
    mistakes: { type: [String], default: [] },
    weakAreas: { type: [String], default: [] },
    requiredConcepts: { type: [String], default: [] },
    missingConcepts: { type: [String], default: [] },
    missingKeyPoints: { type: [String], default: [] },
    expectedConcepts: { type: [String], default: [] },
    conceptsCovered: { type: [String], default: [] },
    improvementSuggestions: { type: [String], default: [] },
    improvements: { type: [String], default: [] },
    overallFeedback: { type: String, default: '' },
    summaryInsights: { type: String, default: '' },
    scoreExplanation: { type: String, default: '' },
    fileName: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    evaluatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

assignmentStudentResultSchema.index({ sessionId: 1, rollNumber: 1, studentName: 1 }, { unique: false });

module.exports = mongoose.model('AssignmentStudentResult', assignmentStudentResultSchema);

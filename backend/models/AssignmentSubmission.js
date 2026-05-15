const mongoose = require('mongoose');

const submissionFileSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const scoreBreakdownSchema = new mongoose.Schema(
  {
    correctness: { type: Number, default: 0 },
    topicUnderstanding: { type: Number, default: 0 },
    completeness: { type: Number, default: 0 },
    technicalAccuracy: { type: Number, default: 0 },
  },
  { _id: false }
);

const evaluationSchema = new mongoose.Schema(
  {
    totalScore: { type: Number, default: 0 },
    maxScore: { type: Number, default: 100 },
    gradeLabel: { type: String, default: '' },
    isRelevant: { type: Boolean, default: true },
    isIncomplete: { type: Boolean, default: false },
    scoreBreakdown: { type: scoreBreakdownSchema, default: () => ({}) },
    strengths: { type: [String], default: [] },
    mistakes: { type: [String], default: [] },
    missingConcepts: { type: [String], default: [] },
    improvementSuggestions: { type: [String], default: [] },
    summary: { type: String, default: '' },
    detailedFeedback: { type: String, default: '' },
    raw: { type: mongoose.Schema.Types.Mixed, default: {} },
    generatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const professorEvaluationSchema = new mongoose.Schema(
  {
    approved: { type: Boolean, default: false },
    edited: { type: Boolean, default: false },
    totalScore: { type: Number, default: null },
    maxScore: { type: Number, default: 100 },
    gradeLabel: { type: String, default: '' },
    scoreBreakdown: { type: scoreBreakdownSchema, default: () => ({}) },
    feedback: { type: String, default: '' },
    summary: { type: String, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const assignmentSubmissionSchema = new mongoose.Schema(
  {
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assignment',
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    submissionText: {
      type: String,
      default: '',
    },
    submissionFiles: {
      type: [submissionFileSchema],
      default: [],
    },
    extractedSubmissionText: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['submitted', 'resubmitted', 'graded', 'unsubmitted'],
      default: 'submitted',
      index: true,
    },
    gradingStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    gradingSource: {
      type: String,
      enum: ['ai', 'professor'],
      default: 'ai',
      index: true,
    },
    aiEvaluation: {
      type: evaluationSchema,
      default: null,
    },
    professorEvaluation: {
      type: professorEvaluationSchema,
      default: null,
    },
    submittedAt: { type: Date, default: Date.now },
    evaluatedAt: { type: Date, default: null },
    lastUpdatedAt: { type: Date, default: Date.now },
    activityLog: {
      type: [
        {
          action: { type: String, required: true },
          actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          at: { type: Date, default: Date.now },
          note: { type: String, default: '' },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

assignmentSubmissionSchema.index({ assignment: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('AssignmentSubmission', assignmentSubmissionSchema);

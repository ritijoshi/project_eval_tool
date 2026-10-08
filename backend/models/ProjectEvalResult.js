const mongoose = require('mongoose');

const scoreHistoryEntrySchema = new mongoose.Schema(
  {
    weekLabel: { type: String, default: '' },
    score: { type: Number, default: 0 },
    evaluatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const projectEvalResultSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectEvalSession',
      required: true,
      index: true,
    },
    identifier: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    teamName: {
      type: String,
      default: '',
      trim: true,
    },
    studentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    repoUrl: {
      type: String,
      default: '',
      trim: true,
    },
    repoOwner: {
      type: String,
      default: '',
      trim: true,
    },
    repoName: {
      type: String,
      default: '',
      trim: true,
    },
    overallScore: {
      type: Number,
      default: 0,
    },
    maxScore: {
      type: Number,
      default: 100,
    },
    gradeLabel: {
      type: String,
      default: '',
    },
    healthStatus: {
      type: String,
      enum: ['ON_TRACK', 'AT_RISK', 'BEHIND', 'UNKNOWN'],
      default: 'UNKNOWN',
      index: true,
    },
    criterionScores: {
      type: mongoose.Schema.Types.Mixed,
      default: [],
    },
    requirementCoverage: {
      type: Number,
      default: 0,
    },
    codeQuality: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    architecture: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    testing: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    documentation: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    projectProgress: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    techCompliance: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    missingRequirements: {
      type: [String],
      default: [],
    },
    missingConcepts: {
      type: [String],
      default: [],
    },
    strengths: {
      type: [String],
      default: [],
    },
    feedback: {
      type: String,
      default: '',
    },
    nextWeekTasks: {
      type: [String],
      default: [],
    },
    githubEvidence: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    weeklyClaims: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    scoreHistory: {
      type: [scoreHistoryEntrySchema],
      default: [],
    },
    badges: {
      type: mongoose.Schema.Types.Mixed,
      default: [],
    },
    evaluationStatus: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED'],
      default: 'COMPLETED',
    },
    errorMessage: {
      type: String,
      default: '',
    },
    evaluatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

projectEvalResultSchema.index({ sessionId: 1, identifier: 1 });
projectEvalResultSchema.index({ sessionId: 1, overallScore: -1 });
projectEvalResultSchema.index({ sessionId: 1, healthStatus: 1 });

module.exports = mongoose.model('ProjectEvalResult', projectEvalResultSchema);

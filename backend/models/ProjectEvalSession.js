const mongoose = require('mongoose');

const rubricCriterionSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    title: { type: String, default: '' },
    maxScore: { type: Number, default: 10 },
    description: { type: String, default: '' },
    requirements: { type: [String], default: [] },
  },
  { _id: false }
);

const milestoneSchema = new mongoose.Schema(
  {
    weekLabel: { type: String, default: '' },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    dueDate: { type: Date, default: null },
  },
  { _id: false }
);

const repoLinkSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    identifier: { type: String, default: '', trim: true },
    teamName: { type: String, default: '', trim: true },
    weeklyReportPath: { type: String, default: '' },
  },
  { _id: false }
);

const projectEvalSessionSchema = new mongoose.Schema(
  {
    professorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      default: null,
      index: true,
    },
    sessionLabel: {
      type: String,
      default: '',
      trim: true,
    },
    projectGoal: {
      type: String,
      default: '',
      trim: true,
    },
    projectType: {
      type: String,
      enum: ['individual', 'team'],
      default: 'individual',
    },
    rubricPath: {
      type: String,
      default: '',
    },
    rubricCriteria: {
      type: [rubricCriterionSchema],
      default: [],
    },
    totalMaxScore: {
      type: Number,
      default: 100,
    },
    techRequirements: {
      type: [String],
      default: [],
    },
    milestones: {
      type: [milestoneSchema],
      default: [],
    },
    repoLinks: {
      type: [repoLinkSchema],
      default: [],
    },
    mode: {
      type: String,
      enum: ['batch', 'individual'],
      default: 'batch',
    },
    status: {
      type: String,
      enum: [
        'UPLOADED',
        'PARSING_RUBRIC',
        'ANALYZING_REPOS',
        'PARSING_REPORTS',
        'EVALUATING',
        'COMPLETED',
        'FAILED',
      ],
      default: 'UPLOADED',
    },
    totalRepos: {
      type: Number,
      default: 0,
    },
    processedRepos: {
      type: Number,
      default: 0,
    },
    progressPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    failureMetadata: {
      errorMessage: { type: String, default: '' },
      failedStage: { type: String, default: '' },
      logs: [{ type: String }],
    },
  },
  { timestamps: true }
);

projectEvalSessionSchema.index({ professorId: 1, courseId: 1, createdAt: -1 });

module.exports = mongoose.model('ProjectEvalSession', projectEvalSessionSchema);

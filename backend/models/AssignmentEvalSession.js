const mongoose = require('mongoose');

const assignmentEvalSessionSchema = new mongoose.Schema(
  {
    professorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assignment',
      default: null,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      default: null,
      index: true,
    },
    rubricId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Rubric',
      default: null,
    },
    rubricPath: {
      type: String,
      default: '',
    },
    submissionsZipPath: {
      type: String,
      default: '',
    },
    assignmentType: {
      type: String,
      enum: ['text', 'code', 'mixed'],
      default: 'text',
    },
    status: {
      type: String,
      enum: ['UPLOADED', 'EXTRACTING', 'PARSING_RUBRIC', 'EVALUATING', 'COMPLETED', 'FAILED'],
      default: 'UPLOADED',
    },
    totalStudents: {
      type: Number,
      default: 0,
    },
    processedStudents: {
      type: Number,
      default: 0,
    },
    progressPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    sessionLabel: {
      type: String,
      default: '',
    },
    failureMetadata: {
      errorMessage: { type: String, default: '' },
      failedStage: { type: String, default: '' },
      logs: [{ type: String }],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

assignmentEvalSessionSchema.index({ professorId: 1, courseId: 1, createdAt: -1 });
module.exports = mongoose.model('AssignmentEvalSession', assignmentEvalSessionSchema);

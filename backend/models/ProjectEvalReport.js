const mongoose = require('mongoose');

const projectEvalReportSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectEvalSession',
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      default: null,
      index: true,
    },
    professorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sessionLabel: {
      type: String,
      default: '',
    },
    courseCode: {
      type: String,
      default: '',
    },
    filePath: {
      type: String,
      required: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    repoCount: {
      type: Number,
      default: 0,
    },
    averageScore: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

projectEvalReportSchema.index({ courseId: 1, generatedAt: -1 });
projectEvalReportSchema.index({ sessionId: 1 });

module.exports = mongoose.model('ProjectEvalReport', projectEvalReportSchema);

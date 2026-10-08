const mongoose = require('mongoose');

const projectWeeklyProgressSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectEvalSession',
      required: true,
      index: true,
    },
    resultId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProjectEvalResult',
      default: null,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    identifier: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    weekLabel: {
      type: String,
      default: 'Week 1',
      trim: true,
    },
    filePath: {
      type: String,
      default: '',
    },
    fileText: {
      type: String,
      default: '',
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    processed: {
      type: Boolean,
      default: false,
    },
    parsedReport: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

projectWeeklyProgressSchema.index({ sessionId: 1, weekLabel: 1 });
projectWeeklyProgressSchema.index({ sessionId: 1, identifier: 1 });

module.exports = mongoose.model('ProjectWeeklyProgress', projectWeeklyProgressSchema);

const mongoose = require('mongoose');

const assignmentEvalReportSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AssignmentEvalSession',
      required: true,
      unique: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true,
    },
    professorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assignment',
      default: null,
    },
    assignmentTitle: { type: String, default: '' },
    courseCode: { type: String, default: '' },
    filePath: { type: String, required: true },
    fileName: { type: String, required: true },
    generatedAt: { type: Date, default: Date.now },
    studentCount: { type: Number, default: 0 },
    averageScore: { type: Number, default: null },
  },
  { timestamps: true }
);

assignmentEvalReportSchema.index({ courseId: 1, generatedAt: -1 });

module.exports = mongoose.model('AssignmentEvalReport', assignmentEvalReportSchema);

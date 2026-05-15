const mongoose = require('mongoose');

const assignmentDeletionLogSchema = new mongoose.Schema(
  {
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
    title: { type: String, default: '' },
    courseKey: { type: String, default: '' },
    professorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: Date.now },
    submissionCount: { type: Number, default: 0 },
    studentCount: { type: Number, default: 0 },
    snapshot: {
      description: { type: String, default: '' },
      rubric: { type: String, default: '' },
      deadline: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

assignmentDeletionLogSchema.index({ assignmentId: 1, deletedAt: -1 });
assignmentDeletionLogSchema.index({ professorId: 1, deletedAt: -1 });

module.exports = mongoose.model('AssignmentDeletionLog', assignmentDeletionLogSchema);

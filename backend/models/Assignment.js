const mongoose = require('mongoose');

const assignmentFileSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
  },
  { _id: false }
);

const assignmentSchema = new mongoose.Schema(
  {
    professor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    courseKey: {
      type: String,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    rubric: {
      type: String,
      default: '',
    },
    deadline: {
      type: Date,
      required: true,
      index: true,
    },
    assignmentFiles: {
      type: [assignmentFileSchema],
      default: [],
    },
    extractedAssignmentText: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

assignmentSchema.index({ professor: 1, courseKey: 1, createdAt: -1 });

module.exports = mongoose.model('Assignment', assignmentSchema);

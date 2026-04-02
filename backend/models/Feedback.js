const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    evaluationId: {
      type: String,
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    professor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    courseKey: {
      type: String,
      required: true,
      index: true,
    },
    aiEvaluation: {
      score: String,
      feedback: String,
      details: mongoose.Schema.Types.Mixed,
      rubric: String,
    },
    professorReview: {
      reviewed: {
        type: Boolean,
        default: false,
      },
      manualFeedback: String,
      scoreAdjustment: Number, // Percentage adjustment to AI score
      timestamp: Date,
    },
    studentResponses: [
      {
        message: String,
        timestamp: Date,
        isQuestion: Boolean, // true if asking for clarification
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'resolved', 'awaiting_response'],
      default: 'pending',
    },
    submissionContent: {
      text: String,
      files: [String], // file names/paths
    },
  },
  { timestamps: true }
);

// Compound index for efficient queries
feedbackSchema.index({ student: 1, courseKey: 1, createdAt: -1 });
feedbackSchema.index({ professor: 1, courseKey: 1, status: 1 });

module.exports = mongoose.model('Feedback', feedbackSchema);

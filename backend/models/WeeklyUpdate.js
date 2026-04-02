const mongoose = require('mongoose');

const weeklyUpdateSchema = new mongoose.Schema(
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
      trim: true,
      lowercase: true,
      index: true,
    },
    weekLabel: {
      type: String,
      default: 'Weekly Update',
      trim: true,
    },
    newTopics: {
      type: [String],
      default: [],
    },
    announcements: {
      type: [String],
      default: [],
    },
    revisedExpectations: {
      type: [String],
      default: [],
    },
    updateText: {
      type: String,
      default: '',
    },
    embedded: {
      type: Boolean,
      default: false,
    },
    chunksAdded: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

weeklyUpdateSchema.index({ courseKey: 1, createdAt: -1 });

module.exports = mongoose.model('WeeklyUpdate', weeklyUpdateSchema);

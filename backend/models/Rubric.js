const mongoose = require('mongoose');

const rubricCriterionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    weight: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: false }
);

const rubricSchema = new mongoose.Schema(
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
    name: {
      type: String,
      required: true,
      trim: true,
    },
    criteria: {
      type: [rubricCriterionSchema],
      default: [],
    },
    maxScore: {
      type: Number,
      default: 100,
      min: 10,
      max: 1000,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

rubricSchema.index({ professor: 1, courseKey: 1, createdAt: -1 });

module.exports = mongoose.model('Rubric', rubricSchema);

const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
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
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    content: {
      type: String,
      default: '',
    },
    attachments: {
      type: [String],
      default: [],
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    scheduledAt: {
      type: Date,
      default: null,
      index: true,
    },
    publishedAt: {
      type: Date,
      default: null,
      index: true,
    },
    // Used for sorting (publishedAt when published, otherwise scheduledAt)
    sortAt: {
      type: Date,
      required: true,
      index: true,
    },
    readBy: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    notificationsSent: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

announcementSchema.index({ courseId: 1, isPinned: -1, sortAt: -1, _id: -1 });
announcementSchema.index({ courseId: 1, publishedAt: -1 });
announcementSchema.index({ scheduledAt: 1, publishedAt: 1, notificationsSent: 1 });

module.exports = mongoose.model('Announcement', announcementSchema);

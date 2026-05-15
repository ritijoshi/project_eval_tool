const mongoose = require('mongoose');

const courseEngagementSchema = new mongoose.Schema(
    {
        studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
        moduleKey: { type: String, required: true, trim: true, index: true },
        materialTitle: { type: String, default: '', trim: true },
        viewCount: { type: Number, default: 0, min: 0 },
        totalTimeSpentSeconds: { type: Number, default: 0, min: 0 },
        completionStatus: { type: String, enum: ['not_started', 'in_progress', 'completed'], default: 'not_started' },
        lastViewedAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

courseEngagementSchema.index({ studentId: 1, courseId: 1, moduleKey: 1 }, { unique: true });
courseEngagementSchema.index({ courseId: 1, studentId: 1 });

module.exports = mongoose.model('CourseEngagement', courseEngagementSchema);

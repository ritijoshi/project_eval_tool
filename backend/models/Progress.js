const mongoose = require('mongoose');

const topicProgressSchema = new mongoose.Schema(
    {
        topicName: { type: String, required: true, trim: true },
        masteryLevel: { type: Number, default: 0, min: 0, max: 100 },
        attempts: { type: Number, default: 0, min: 0 },
        accuracy: { type: Number, default: 0, min: 0, max: 100 },
        lastPracticed: { type: Date, default: null },
    },
    { _id: false }
);

const progressSchema = new mongoose.Schema(
    {
        studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
        overallProgress: { type: Number, default: 0, min: 0, max: 100 },
        modulesCompleted: { type: Number, default: 0, min: 0 },
        totalModules: { type: Number, default: 0, min: 0 },
        assignmentStats: {
            avgScore: { type: Number, default: 0, min: 0, max: 100 },
            completed: { type: Number, default: 0, min: 0 },
            pending: { type: Number, default: 0, min: 0 },
            onTimeRate: { type: Number, default: 0, min: 0, max: 100 },
            lateCount: { type: Number, default: 0, min: 0 },
        },
        testStats: {
            avgScore: { type: Number, default: 0, min: 0, max: 100 },
            attempts: { type: Number, default: 0, min: 0 },
            latestScore: { type: Number, default: 0, min: 0, max: 100 },
        },
        weakTopics: { type: [String], default: [] },
        strongTopics: { type: [String], default: [] },
        topicProgress: { type: [topicProgressSchema], default: [] },
        activityScore: { type: Number, default: 0, min: 0, max: 100 },
        activityLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
        engagement: {
            loginCount: { type: Number, default: 0, min: 0 },
            timeSpentMinutes: { type: Number, default: 0, min: 0 },
            chatInteractions: { type: Number, default: 0, min: 0 },
            materialsViewed: { type: Number, default: 0, min: 0 },
            lastLoginAt: { type: Date, default: null },
        },
        aiInsights: {
            summary: { type: String, default: '' },
            recommendations: { type: [String], default: [] },
            generatedAt: { type: Date, default: null },
        },
        lastUpdated: { type: Date, default: Date.now },
    },
    { timestamps: true }
);

progressSchema.index({ studentId: 1, courseId: 1 }, { unique: true });
progressSchema.index({ courseId: 1, overallProgress: 1 });

module.exports = mongoose.model('Progress', progressSchema);

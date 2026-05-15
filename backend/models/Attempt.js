const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
    {
        questionId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        selectedIndex: {
            type: Number,
            required: true,
            min: 0,
        },
        isCorrect: {
            type: Boolean,
            default: false,
        },
    },
    { _id: false }
);

const attemptSchema = new mongoose.Schema(
    {
        studentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        courseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            index: true,
        },
        testId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Test',
            required: true,
            index: true,
        },
        answers: {
            type: [answerSchema],
            default: [],
        },
        score: {
            // 0..100
            type: Number,
            default: 0,
        },
        timeTakenSeconds: {
            type: Number,
            default: 0,
            min: 0,
        },
        weakAreas: {
            type: [String],
            default: [],
        },
        feedbackMode: {
            type: String,
            enum: ['immediate', 'delayed'],
            default: 'delayed',
        },
    },
    { timestamps: true }
);

attemptSchema.index({ studentId: 1, courseId: 1, createdAt: -1 });
attemptSchema.index({ courseId: 1, testId: 1, createdAt: -1 });

module.exports = mongoose.model('Attempt', attemptSchema);

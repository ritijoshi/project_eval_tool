const mongoose = require('mongoose');

const studentEvaluationSchema = new mongoose.Schema(
    {
        sessionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'EvaluationSession',
            required: true,
        },
        studentName: {
            type: String,
            default: 'Unknown Student',
        },
        rollNumber: {
            type: String,
            default: 'Unknown Roll',
        },
        summaryText: {
            type: String,
            required: true,
            description: 'The raw, parsed text extracted from the student HTML submission',
        },
        score: {
            type: Number,
            min: 0,
            max: 10,
            default: null,
        },
        feedback: {
            type: String,
            default: '',
        },
        evaluationStatus: {
            type: String,
            enum: ['PENDING', 'COMPLETED', 'FAILED'],
            default: 'PENDING',
        },
        errorMessage: {
            type: String,
            default: '',
        },
    },
    { timestamps: true }
);

// Index for efficiently listing all evaluation results for a given session
studentEvaluationSchema.index({ sessionId: 1, evaluationStatus: 1 });

module.exports = mongoose.model('StudentEvaluation', studentEvaluationSchema);

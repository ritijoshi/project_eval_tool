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
        rollNo: {
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
        metrics: {
            similarity: { type: Number, default: null },
            coverage: { type: Number, default: null },
            completeness: { type: Number, default: null },
            relevance: { type: Number, default: null },
            clarity: { type: Number, default: null },
            keywordCoverage: { type: Number, default: null },
            plagiarismSimilarity: { type: Number, default: null },
        },
        aiEvaluation: {
            metrics: {
                topicCoverage: { score: Number, reason: String },
                conceptUnderstanding: { score: Number, reason: String },
                clarityReadability: { score: Number, reason: String },
                technicalAccuracy: { score: Number, reason: String },
                completeness: { score: Number, reason: String },
                conciseness: { score: Number, reason: String },
                logicalFlow: { score: Number, reason: String },
                keywordMatch: { score: Number, reason: String },
                criticalThinkingDepth: { score: Number, reason: String },
                aiConfidence: { score: Number, reason: String },
            },
            strengths: { type: [String], default: [] },
            weakAreas: { type: [String], default: [] },
            improvements: { type: [String], default: [] },
            summaryInsights: { type: String, default: '' },
            missingKeyPoints: { type: [String], default: [] },
            conceptsCovered: { type: [String], default: [] },
            overallScore: { type: Number, default: null },
            scoreBreakdown: { type: [Object], default: [] },
            scoreExplanation: { type: String, default: '' },
            fallback: { type: Boolean, default: false },
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

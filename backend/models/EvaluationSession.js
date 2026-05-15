const mongoose = require('mongoose');

const evaluationSessionSchema = new mongoose.Schema(
    {
        professorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        courseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course',
            required: false,
            default: null,
        },
        transcriptPath: {
            type: String,
            required: true,
            description: 'Path or URL to the uploaded lecture transcript (.vtt or .txt)',
        },
        uploadZipPath: {
            type: String,
            required: true,
            description: 'Path or URL to the uploaded zip containing student submissions',
        },
        transcriptMetadata: {
            lectureDate: { type: Date },
            lectureTopic: { type: String, default: '' },
            courseNameSnapshot: { type: String, default: '' },
        },
        totalStudents: {
            type: Number,
            default: 0,
        },
        processedStudents: {
            type: Number,
            default: 0,
        },
        progressPercent: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        status: {
            type: String,
            enum: ['UPLOADED', 'EXTRACTING', 'PROCESSING', 'ANALYZING_TRANSCRIPT', 'ANALYSIS', 'EVALUATING', 'COMPLETED', 'FAILED'],
            default: 'UPLOADED',
        },
        failureMetadata: {
            errorMessage: { type: String, default: '' },
            failedStage: { type: String, default: '' },
            logs: [{ type: String }],
        },
    },
    { timestamps: true }
);

// Helpful index to query sessions belonging to a specific course / professor
evaluationSessionSchema.index({ professorId: 1, courseId: 1, createdAt: -1 });

module.exports = mongoose.model('EvaluationSession', evaluationSessionSchema);

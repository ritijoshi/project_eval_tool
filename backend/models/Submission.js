const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema(
    {
        filename: { type: String, required: true },
        originalName: { type: String, required: true },
        mimeType: { type: String, default: '' },
        size: { type: Number, default: 0 },
        url: { type: String, required: true },
    },
    { _id: false }
);

const submissionSchema = new mongoose.Schema(
    {
        student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
        files: [fileSchema],
        submittedAt: { type: Date, default: Date.now },
        score: { type: Number, default: null },
        feedback: { type: String, default: '' },
        version: { type: Number, default: 1 },
        isLate: { type: Boolean, default: false },
        isLatest: { type: Boolean, default: true },
    },
    { timestamps: true }
);

submissionSchema.index({ student: 1, assignment: 1, version: -1 });

module.exports = mongoose.model('Submission', submissionSchema);

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

const assignmentSchema = new mongoose.Schema(
    {
        title: { type: String, required: true, trim: true },
        description: { type: String, default: '', trim: true },
        course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
        deadline: { type: Date, required: true },
        maxPoints: { type: Number, required: true, min: 1, default: 100 },
        rubric: { type: String, default: '' },
        attachments: [fileSchema],
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    },
    { timestamps: true }
);

assignmentSchema.index({ course: 1, deadline: 1 });

module.exports = mongoose.model('Assignment', assignmentSchema);

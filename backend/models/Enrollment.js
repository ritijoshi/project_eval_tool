const mongoose = require('mongoose');

const gradeSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        score: { type: Number, default: 0 },
        maxScore: { type: Number, default: 100 },
        feedback: { type: String, default: '' },
        recordedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const enrollmentSchema = new mongoose.Schema(
    {
        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        course: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
        },
        progress: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        grades: [gradeSchema],
    },
    { timestamps: true }
);

enrollmentSchema.index({ student: 1, course: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', enrollmentSchema);

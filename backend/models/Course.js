const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        body: { type: String, default: '' },
        postedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const assignmentSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        description: { type: String, default: '' },
        dueAt: { type: Date },
        postedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const courseSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: '',
            trim: true,
        },
        professor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        courseCode: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
        },
        students: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
            },
        ],
        announcements: [announcementSchema],
        assignments: [assignmentSchema],
    },
    { timestamps: true }
);

courseSchema.index({ professor: 1, createdAt: -1 });

module.exports = mongoose.model('Course', courseSchema);

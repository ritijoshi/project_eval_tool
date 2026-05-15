const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
        select: false, // do not return passwords by default
    },
    role: {
        type: String,
        enum: ['student', 'professor'],
        required: true,
    },
    enrolledCourses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course'
    }],
    createdCourses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course'
    }],
    lastActiveCourse: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        default: null,
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);

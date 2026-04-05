const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema(
    {
        questionText: {
            type: String,
            required: true,
            trim: true,
        },
        options: {
            type: [String],
            required: true,
            validate: {
                validator: (arr) => Array.isArray(arr) && arr.length >= 2 && arr.every((s) => typeof s === 'string' && s.trim()),
                message: 'options must be an array of at least 2 non-empty strings',
            },
        },
        correctAnswer: {
            // 0-based index into options
            type: Number,
            required: true,
            min: 0,
        },
        explanation: {
            type: String,
            default: '',
            trim: true,
        },
        topic: {
            type: String,
            default: '',
            trim: true,
        },
    },
    { _id: true }
);

const testSchema = new mongoose.Schema(
    {
        courseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        topics: {
            type: [String],
            default: [],
        },
        difficulty: {
            type: String,
            enum: ['easy', 'medium', 'hard'],
            default: 'medium',
            index: true,
        },
        createdBy: {
            // Who authored the test content.
            type: String,
            enum: ['professor', 'ai'],
            default: 'professor',
        },
        createdByUser: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: false,
        },
        questions: {
            type: [questionSchema],
            default: [],
        },
    },
    { timestamps: true }
);

testSchema.index({ courseId: 1, createdAt: -1 });

testSchema.pre('validate', function validateQuestions() {
    if (!Array.isArray(this.questions) || this.questions.length === 0) {
        throw new Error('At least one question is required');
    }

    for (const q of this.questions) {
        const optionsLen = Array.isArray(q.options) ? q.options.length : 0;
        const correctIndex = Number(q.correctAnswer);
        if (!(Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < optionsLen)) {
            throw new Error('correctAnswer must be a valid index into options');
        }
    }
});

module.exports = mongoose.model('Test', testSchema);

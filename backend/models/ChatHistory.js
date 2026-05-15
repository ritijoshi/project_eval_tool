const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
    {
        sender: {
            type: String,
            enum: ['user', 'agent'],
            required: true,
        },
        type: {
            type: String,
            enum: ['text', 'voice', 'image', 'document'],
            default: 'text',
        },
        text: {
            type: String,
            trim: true,
            default: '',
        },
        content: {
            type: String,
            trim: true,
            default: '',
        },
        fileUrl: {
            type: String,
            trim: true,
            default: '',
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: false }
);

const chatHistorySchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        courseKey: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            default: 'general',
            index: true,
        },
        messages: {
            type: [chatMessageSchema],
            default: [],
        },
    },
    { timestamps: true }
);

chatHistorySchema.index({ user: 1, courseKey: 1 }, { unique: true });

module.exports = mongoose.model('ChatHistory', chatHistorySchema);

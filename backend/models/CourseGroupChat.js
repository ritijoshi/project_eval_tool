const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
    originalName: String,
    fileName: String,
    fileUrl: String,
    mimeType: String,
    size: Number,
    kind: { type: String, enum: ['image', 'document', 'voice', 'video', 'other'], default: 'other' }
});

const courseGroupChatSchema = new mongoose.Schema({
    course: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Course', 
        required: true, 
        index: true 
    },
    sender: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    messageType: { 
        type: String, 
        enum: ['text', 'file'], 
        default: 'text' 
    },
    text: { 
        type: String 
    },
    attachments: [attachmentSchema],
}, { timestamps: true });

// Index to quickly fetch the latest messages for a course
courseGroupChatSchema.index({ course: 1, createdAt: -1 });

module.exports = mongoose.model('CourseGroupChat', courseGroupChatSchema);

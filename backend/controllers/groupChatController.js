const path = require('path');
const fs = require('fs');
const CourseGroupChat = require('../models/CourseGroupChat');
const Course = require('../models/Course');
const User = require('../models/User');

const GROUPCHAT_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'groupchat');

// Ensure upload directory exists
if (!fs.existsSync(GROUPCHAT_UPLOAD_DIR)) {
    fs.mkdirSync(GROUPCHAT_UPLOAD_DIR, { recursive: true });
}

const sanitizeFileName = (name) => {
    const safe = String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
    return safe.replace(/^-|-$/g, '') || 'file';
};

const getCourseChatHistory = async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user._id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;

        // Verify enrollment or professor status
        const course = await Course.findOne({
            _id: courseId,
            $or: [{ professor: userId }, { students: userId }]
        });

        if (!course) {
            return res.status(403).json({ message: 'Not authorized to access this course chat.' });
        }

        const skip = (page - 1) * limit;

        const messages = await CourseGroupChat.find({ course: courseId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('sender', 'name email role profilePicture')
            .lean();

        // The frontend usually expects oldest messages first to display top-down, 
        // but we fetch newest first for pagination, so we reverse it here
        res.status(200).json({ messages: messages.reverse() });
    } catch (error) {
        console.error('Fetch group chat error:', error);
        res.status(500).json({ message: 'Failed to fetch chat history.' });
    }
};

const uploadGroupChatAttachment = async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user._id;

        // Verify enrollment or professor status
        const course = await Course.findOne({
            _id: courseId,
            $or: [{ professor: userId }, { students: userId }]
        });

        if (!course) {
            return res.status(403).json({ message: 'Not authorized to upload to this course chat.' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded.' });
        }

        const attachments = req.files.map((file) => {
            const safeName = `${Date.now()}-${sanitizeFileName(file.originalname)}`;
            const storedPath = path.join(GROUPCHAT_UPLOAD_DIR, safeName);
            
            // Memory storage is used by multer, so we write the buffer to disk
            fs.writeFileSync(storedPath, file.buffer);

            let kind = 'other';
            if (file.mimetype.startsWith('image/')) kind = 'image';
            else if (file.mimetype.startsWith('audio/')) kind = 'voice';
            else if (file.mimetype.startsWith('video/')) kind = 'video';
            else if (file.mimetype.includes('pdf') || file.mimetype.includes('document')) kind = 'document';

            return {
                originalName: file.originalname,
                fileName: safeName,
                fileUrl: `/uploads/groupchat/${safeName}`,
                mimeType: file.mimetype,
                size: file.size,
                kind,
            };
        });

        res.status(200).json({ attachments });
    } catch (error) {
        console.error('Group chat upload error:', error);
        res.status(500).json({ message: 'Failed to upload attachments.' });
    }
};

module.exports = {
    getCourseChatHistory,
    uploadGroupChatAttachment
};

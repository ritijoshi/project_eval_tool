const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');
const {
    getCourseChatHistory,
    uploadGroupChatAttachment
} = require('../controllers/groupChatController');

// Multer config for group chat attachments
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB limit
        files: 10,
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/webp',
            'image/gif',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
            'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
            'application/zip',
            'application/x-zip-compressed',
            'audio/mpeg',
            'audio/wav',
            'audio/mp4',
            'audio/webm',
            'audio/ogg',
            'video/mp4',
            'video/webm'
        ];
        
        const fileName = String(file.originalname || '').toLowerCase();
        const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.docx', '.xlsx', '.pptx', '.zip', '.mp3', '.wav', '.m4a', '.webm', '.ogg', '.mp4'];
        
        const extOk = allowedExtensions.some((suffix) => fileName.endsWith(suffix));
        if (allowedMimeTypes.includes(file.mimetype) || extOk) {
            return cb(null, true);
        }
        return cb(new Error('Invalid file type'));
    },
});

router.get('/:courseId', protect, getCourseChatHistory);
router.post('/:courseId/upload', protect, upload.array('files', 10), uploadGroupChatAttachment);

module.exports = router;

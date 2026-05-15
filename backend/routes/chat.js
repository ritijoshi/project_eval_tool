const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');
const {
	handleChat,
	handleVoiceChat,
	handleUploadChat,
	getSavedChatHistory,
	deleteSavedChatHistory,
} = require('../controllers/chatController');

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 25 * 1024 * 1024,
		files: 8,
	},
	fileFilter: (req, file, cb) => {
		const allowedMimeTypes = [
			'image/png',
			'image/jpeg',
			'image/jpg',
			'image/webp',
			'application/pdf',
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'audio/mpeg',
			'audio/wav',
			'audio/mp4',
			'audio/webm',
			'audio/ogg',
		];
		const fileName = String(file.originalname || '').toLowerCase();
		const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.docx', '.mp3', '.wav', '.m4a', '.webm', '.ogg', '.mp4'];
		const extOk = allowedExtensions.some((suffix) => fileName.endsWith(suffix));
		if (allowedMimeTypes.includes(file.mimetype) || extOk) {
			return cb(null, true);
		}
		return cb(new Error('Invalid file type'));
	},
});

router.post('/', protect, handleChat);
router.post('/voice', protect, upload.single('audio'), handleVoiceChat);
router.post('/upload', protect, upload.array('files', 8), handleUploadChat);
router.get('/history', protect, getSavedChatHistory);
router.delete('/history', protect, deleteSavedChatHistory);

module.exports = router;

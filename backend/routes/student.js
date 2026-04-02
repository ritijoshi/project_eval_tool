const express = require('express');
const router = express.Router();
const {
	getLearningPath,
	getLeaderboard,
	submitProposal,
	evaluateProject,
	evaluateProjectFiles,
	updatePersonalizationInputs,
} = require('../controllers/studentController');
const { listCourses } = require('../controllers/courseController');
const { handleChat, getSavedChatHistory, deleteSavedChatHistory } = require('../controllers/chatController');
const { protect, isStudent } = require('../middleware/authMiddleware');
const multer = require('multer');

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 20 * 1024 * 1024,
		files: 10,
	},
});

router.get('/learning-path', protect, isStudent, getLearningPath);
router.get('/leaderboard', protect, isStudent, getLeaderboard);
router.post('/submit-proposal', protect, isStudent, submitProposal);
router.post('/evaluate', protect, isStudent, evaluateProject);
router.post('/evaluate-files', protect, isStudent, upload.array('files', 10), evaluateProjectFiles);
router.post('/personalization-inputs', protect, isStudent, updatePersonalizationInputs);
router.get('/courses', protect, isStudent, listCourses);

// Course-aware chat (RAG over professor-uploaded materials)
router.post('/course-chat', protect, isStudent, handleChat);
router.get('/chat-history', protect, isStudent, getSavedChatHistory);
router.delete('/chat-history', protect, isStudent, deleteSavedChatHistory);

module.exports = router;

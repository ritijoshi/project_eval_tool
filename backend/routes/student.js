const express = require('express');
const router = express.Router();
const {
	getLearningPath,
	getLeaderboard,
	submitProposal,
	evaluateProject,
	evaluateProjectFiles,
	updatePersonalizationInputs,
	getActiveRubricForCourse,
} = require('../controllers/studentController');
const { listCourses, joinCourse, unenrollCourse } = require('../controllers/courseController');
const { handleChat, getSavedChatHistory, deleteSavedChatHistory } = require('../controllers/chatController');
const { protect, isStudent } = require('../middleware/authMiddleware');
const multer = require('multer');
const assignmentController = require('../controllers/assignmentController');
const path = require('path');
const fs = require('fs');

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 20 * 1024 * 1024,
		files: 10,
	},
});

const ensureUploadsDir = (dirPath) => {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
};

const submissionStorage = multer.diskStorage({
	destination: (req, file, cb) => {
		const dest = path.join(__dirname, '..', 'uploads', 'submissions');
		ensureUploadsDir(dest);
		cb(null, dest);
	},
	filename: (req, file, cb) => {
		const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
		cb(null, safeName);
	},
});

const submissionUpload = multer({
	storage: submissionStorage,
	limits: {
		fileSize: 25 * 1024 * 1024,
		files: 10,
	},
	fileFilter: (req, file, cb) => {
		const ext = (file.originalname || '').toLowerCase();
		const okExts = [
			'.pdf', '.txt', '.md', '.zip', '.js', '.ts', '.py', '.java', '.cpp', '.c', '.json'
		];
		const extOk = okExts.some((suffix) => ext.endsWith(suffix));
		if (extOk) return cb(null, true);
		return cb(new Error('Invalid file type'));
	},
});

router.get('/learning-path', protect, isStudent, getLearningPath);
router.get('/leaderboard', protect, isStudent, getLeaderboard);
router.post('/submit-proposal', protect, isStudent, submitProposal);
router.post('/evaluate', protect, isStudent, evaluateProject);
router.post('/evaluate-files', protect, isStudent, upload.array('files', 10), evaluateProjectFiles);
router.post('/personalization-inputs', protect, isStudent, updatePersonalizationInputs);
router.get('/rubric', protect, isStudent, getActiveRubricForCourse);
router.get('/courses', protect, isStudent, listCourses);
router.post('/courses/join', protect, isStudent, joinCourse);
router.post('/courses/:courseId/unenroll', protect, isStudent, unenrollCourse);
router.get('/assignments', protect, isStudent, assignmentController.listAssignmentsForStudent);
router.get('/assignments/upcoming', protect, isStudent, assignmentController.listUpcomingAssignments);
router.post('/assignments/:assignmentId/submissions', protect, isStudent, submissionUpload.array('files', 10), assignmentController.submitAssignment);
router.get('/assignments/:assignmentId/submissions', protect, isStudent, assignmentController.listMySubmissions);

// Course-aware chat (RAG over professor-uploaded materials)
router.post('/course-chat', protect, isStudent, handleChat);
router.get('/chat-history', protect, isStudent, getSavedChatHistory);
router.delete('/chat-history', protect, isStudent, deleteSavedChatHistory);

module.exports = router;

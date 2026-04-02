const express = require('express');
const router = express.Router();
const {
    uploadMaterial,
    defineRubric,
    sendWeeklyUpdate,
    getAnalytics,
    getRubrics,
    getWeeklyUpdates,
} = require('../controllers/professorController');
const { protect, isProfessor } = require('../middleware/authMiddleware');
const multer = require('multer');
const courseController = require('../controllers/courseController');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB per file
        files: 10,
    },
    fileFilter: (req, file, cb) => {
        const okTypes = [
            'application/pdf', // pdf
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
            'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
            'audio/mpeg',
            'audio/wav',
            'audio/mp4',
        ];
        const ext = (file.originalname || '').toLowerCase();
        const extOk =
            ext.endsWith('.pdf') ||
            ext.endsWith('.docx') ||
            ext.endsWith('.pptx') ||
            ext.endsWith('.mp3') ||
            ext.endsWith('.wav') ||
            ext.endsWith('.m4a');
        const typeOk = okTypes.includes(file.mimetype);
        if (extOk || typeOk) return cb(null, true);
        return cb(new Error('Invalid file type'));
    },
});

router.post(
    '/materials',
    protect,
    isProfessor,
    upload.array('files', 10),
    uploadMaterial
);
router.post('/rubrics', protect, isProfessor, defineRubric);
router.get('/rubrics', protect, isProfessor, getRubrics);
router.post('/weekly-updates', protect, isProfessor, sendWeeklyUpdate);
router.get('/weekly-updates', protect, isProfessor, getWeeklyUpdates);
router.get('/analytics', protect, isProfessor, getAnalytics);
router.get('/courses', protect, isProfessor, courseController.listCourses);

module.exports = router;

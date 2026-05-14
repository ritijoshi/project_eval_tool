const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect, requireRole } = require('../middleware/authMiddleware');
const { startEvaluationSession, handleAIWebhook, getSessionResults } = require('../controllers/evaluationController');

// Ensure temporary uploads directory exists
const tempUploadDir = path.join(__dirname, '..', 'uploads', 'temp');
if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
}

// Configure multer for transcript (.vtt/.txt) and zip files
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempUploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    },
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (file.fieldname === 'transcript' && !['.vtt', '.txt'].includes(ext)) {
            return cb(new Error('Transcript must be .vtt or .txt'), false);
        }
        if (file.fieldname === 'submissions' && ext !== '.zip') {
            return cb(new Error('Submissions must be a .zip file'), false);
        }
        cb(null, true);
    },
});

// Routes
// 1. Professor initiates evaluation logic
router.post(
    '/start',
    protect,
    requireRole('professor'),
    upload.fields([
        { name: 'transcript', maxCount: 1 },
        { name: 'submissions', maxCount: 1 }
    ]),
    startEvaluationSession
);

// 2. Fetch results for a specific session
router.get('/:sessionId/results', protect, getSessionResults);

// 3. Webhook callback for the Python AI Service to push updates
// Note: This endpoint is unauthenticated for internal microservice access,
// but should ideally check a shared secret in production.
router.post('/webhook', handleAIWebhook);

module.exports = router;

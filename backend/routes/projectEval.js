const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { protect, requireRole } = require('../middleware/authMiddleware');
const {
  startProjectEvalSession,
  getSessionResults,
  getSingleProjectResult,
  triggerSingleProjectEval,
  submitWeeklyProgress,
  listSessionsForCourse,
  exportSessionReport,
  listCourseReports,
  downloadReport,
  deleteSession,
  deleteReport,
} = require('../controllers/projectEvalController');

const router = express.Router();
const tempUploadDir = path.join(__dirname, '..', 'uploads', 'temp');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempUploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'rubric' && !['.pdf', '.docx', '.txt', '.md'].includes(ext)) {
      return cb(new Error('Rubric must be a PDF, DOCX, TXT, or MD file'), false);
    }
    if (file.fieldname === 'weeklyDoc' && !['.pdf', '.docx', '.txt', '.md'].includes(ext)) {
      return cb(new Error('Weekly progress document must be a PDF, DOCX, TXT, or MD file'), false);
    }
    cb(null, true);
  },
});

// Start / create project evaluation session
router.post(
  '/start',
  protect,
  requireRole('professor'),
  upload.fields([
    { name: 'rubric', maxCount: 1 },
    { name: 'weeklyDoc', maxCount: 1 },
  ]),
  startProjectEvalSession
);

// Submit weekly progress report (can be submitted by students or professors)
router.post(
  '/weekly-progress',
  protect,
  upload.fields([{ name: 'weeklyDoc', maxCount: 1 }]),
  submitWeeklyProgress
);

// Static-segment routes BEFORE /:sessionId to prevent Express param collision
router.get('/course/:courseId/sessions', protect, listSessionsForCourse);
router.get('/course/:courseId/reports', protect, requireRole('professor'), listCourseReports);
router.get('/reports/:reportId/download', protect, requireRole('professor'), downloadReport);
router.delete('/reports/:reportId', protect, requireRole('professor'), deleteReport);

// Session-specific routes
router.get('/:sessionId/results', protect, getSessionResults);
router.get('/:sessionId/export', protect, requireRole('professor'), exportSessionReport);
router.delete('/:sessionId', protect, requireRole('professor'), deleteSession);

// Individual project result within a session
router.get('/:sessionId/result/:resultId', protect, getSingleProjectResult);
router.post('/:sessionId/result/:resultId/re-eval', protect, requireRole('professor'), triggerSingleProjectEval);

module.exports = router;

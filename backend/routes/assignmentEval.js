const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { protect, requireRole } = require('../middleware/authMiddleware');
const {
  startBatchEvalSession,
  handleAssignmentWebhook,
  triggerSingleEval,
  getSessionResults,
  exportSessionReport,
} = require('../controllers/assignmentEvalController');

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
    if (file.fieldname === 'submissions' && ext !== '.zip') {
      return cb(new Error('Submissions must be a ZIP file'), false);
    }
    cb(null, true);
  },
});

router.post('/start', protect, requireRole('professor'), upload.fields([
  { name: 'rubric', maxCount: 1 },
  { name: 'submissions', maxCount: 1 },
]), startBatchEvalSession);

router.get('/:sessionId/results', protect, getSessionResults);
router.get('/:sessionId/export', protect, requireRole('professor'), exportSessionReport);
router.post('/webhook', handleAssignmentWebhook);
router.post('/:submissionId/single', protect, requireRole('professor'), triggerSingleEval);

module.exports = router;

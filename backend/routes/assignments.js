const express = require('express');
const multer = require('multer');

const {
  createAssignment,
  getProfessorAssignments,
  getStudentAssignments,
  submitAssignment,
  unsubmitAssignment,
  getProfessorSubmissions,
  getStudentSubmissionResult,
  overrideSubmissionEvaluation,
} = require('../controllers/assignmentController');
const { protect, isProfessor, isStudent } = require('../middleware/authMiddleware');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 12,
  },
});

router.post('/', protect, isProfessor, upload.array('files', 12), createAssignment);
router.get('/professor', protect, isProfessor, getProfessorAssignments);
router.get('/student', protect, isStudent, getStudentAssignments);
router.get('/:assignmentId/submissions', protect, isProfessor, getProfessorSubmissions);
router.get('/:assignmentId/result', protect, isStudent, getStudentSubmissionResult);
router.post('/:assignmentId/submit', protect, isStudent, upload.array('files', 12), submitAssignment);
router.delete('/:assignmentId/submission', protect, isStudent, unsubmitAssignment);
router.patch('/submissions/:submissionId/override', protect, isProfessor, overrideSubmissionEvaluation);

module.exports = router;

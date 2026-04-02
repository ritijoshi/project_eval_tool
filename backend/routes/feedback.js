const express = require('express');
const {
  getStudentEvaluations,
  getEvaluationDetail,
  addProfessorFeedback,
  getStudentFeedback,
  getFeedbackDetail,
  addStudentResponse,
  createFeedbackFromEvaluation,
} = require('../controllers/feedbackController');
const { protect, isProfessor, isStudent } = require('../middleware/authMiddleware');

const router = express.Router();

// ===== PROFESSOR ROUTES =====

// Get all evaluations for professor (for a course)
router.get('/evaluations', protect, isProfessor, getStudentEvaluations);

// Get specific evaluation detail
router.get('/evaluations/:feedbackId', protect, isProfessor, getEvaluationDetail);

// Add professor feedback to evaluation
router.post('/evaluations/:feedbackId/feedback', protect, isProfessor, addProfessorFeedback);

// ===== STUDENT ROUTES =====

// Get all feedback for student
router.get('/', protect, isStudent, getStudentFeedback);

// Get specific feedback detail
router.get('/:feedbackId', protect, isStudent, getFeedbackDetail);

// Add student response to feedback
router.post('/:feedbackId/response', protect, isStudent, addStudentResponse);

// ===== SHARED ROUTES =====

// Create feedback from evaluation (called after AI evaluation)
router.post('/', protect, isStudent, createFeedbackFromEvaluation);

module.exports = router;

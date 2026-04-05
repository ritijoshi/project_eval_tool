const express = require('express');
const router = express.Router();

const { protect, isProfessor, isStudent } = require('../middleware/authMiddleware');
const testController = require('../controllers/testController');

// API (as requested):
// POST /tests (professor)
// GET /tests?courseId=
// POST /attempt (student)
// GET /results?studentId=&courseId=

router.get('/tests', protect, testController.listTests);
router.post('/tests', protect, isProfessor, testController.createTest);

// Professor: generate questions with AI for a course (professor can edit before saving).
router.post('/tests/generate', protect, isProfessor, testController.generateTestQuestions);

// Student: start test (questions without answers). `count` optionally limits questions.
router.get('/tests/:testId', protect, isStudent, testController.getTestForStudent);

// Student: immediate feedback per question.
router.post('/attempt/check', protect, isStudent, testController.checkAnswer);

// Student: submit attempt for scoring.
router.post('/attempt', protect, isStudent, testController.submitAttempt);

// Results: student gets own results; professor can query studentId.
router.get('/results', protect, testController.getResults);

// Optional: leaderboard for course.
router.get('/tests/leaderboard', protect, testController.getLeaderboard);

module.exports = router;

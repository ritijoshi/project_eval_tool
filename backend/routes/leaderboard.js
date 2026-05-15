const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/authMiddleware');
const {
    getLeaderboard,
    refreshLeaderboard,
    getStudentDetail,
} = require('../controllers/leaderboardController');

// GET /api/leaderboard/:sessionId — fetch ranked leaderboard for a session
router.get('/:sessionId', protect, getLeaderboard);

// POST /api/leaderboard/:sessionId/refresh — recompute + broadcast (professor only)
router.post('/:sessionId/refresh', protect, requireRole('professor'), refreshLeaderboard);

// GET /api/leaderboard/:sessionId/student/:evaluationId — full drill-down for one student
router.get('/:sessionId/student/:evaluationId', protect, getStudentDetail);

module.exports = router;

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getProjectLeaderboard,
  getProjectDetail,
} = require('../controllers/projectLeaderboardController');

// GET /api/project-leaderboard/:sessionId
router.get('/:sessionId', protect, getProjectLeaderboard);

// GET /api/project-leaderboard/:sessionId/project/:resultId
router.get('/:sessionId/project/:resultId', protect, getProjectDetail);

module.exports = router;

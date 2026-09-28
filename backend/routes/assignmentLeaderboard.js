const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getAssignmentLeaderboard,
  getStudentDetail,
} = require('../controllers/assignmentLeaderboardController');

router.get('/:sessionId', protect, getAssignmentLeaderboard);
router.get('/:sessionId/student/:resultId', protect, getStudentDetail);

module.exports = router;

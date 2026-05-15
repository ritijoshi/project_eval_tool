const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const {
    getProgress,
    getAllCoursesProgress,
    triggerProgressUpdate,
    getCourseAnalytics,
} = require('../controllers/progressController');

router.get('/progress', protect, getProgress);
router.get('/progress/all-courses', protect, getAllCoursesProgress);
router.post('/progress/update', protect, triggerProgressUpdate);
router.get('/analytics/course/:courseId', protect, getCourseAnalytics);

module.exports = router;

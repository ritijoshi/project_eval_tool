const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getActiveCourse, setActiveCourse } = require('../controllers/userController');

router.get('/active-course', protect, getActiveCourse);
router.put('/active-course', protect, setActiveCourse);

module.exports = router;

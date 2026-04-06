const express = require('express');
const router = express.Router();

const { protect, isProfessor, isStudent } = require('../middleware/authMiddleware');
const {
  createAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
  markAnnouncementRead,
} = require('../controllers/announcementController');

router.post('/', protect, isProfessor, createAnnouncement);
router.get('/', protect, listAnnouncements);
router.patch('/:id', protect, isProfessor, updateAnnouncement);
router.delete('/:id', protect, isProfessor, deleteAnnouncement);
router.post('/:id/read', protect, isStudent, markAnnouncementRead);

module.exports = router;

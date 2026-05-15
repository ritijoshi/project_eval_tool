const express = require('express');
const router = express.Router();

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { protect, isProfessor, isStudent } = require('../middleware/authMiddleware');
const {
  createAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
  markAnnouncementRead,
} = require('../controllers/announcementController');

const ensureUploadsDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const announcementStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, '..', 'uploads', 'announcements');
    ensureUploadsDir(dest);
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
    cb(null, safeName);
  },
});

const announcementUpload = multer({
  storage: announcementStorage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname || '').toLowerCase();
    const okExts = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.xls', '.xlsx', '.csv'];
    const extOk = okExts.some((suffix) => ext.endsWith(suffix));

    // Some clients may omit correct mimetype; rely primarily on ext.
    if (extOk) return cb(null, true);
    return cb(new Error('Invalid file type'));
  },
});

router.post('/', protect, isProfessor, announcementUpload.array('files', 10), createAnnouncement);
router.get('/', protect, listAnnouncements);
router.patch('/:id', protect, isProfessor, announcementUpload.array('files', 10), updateAnnouncement);
router.delete('/:id', protect, isProfessor, deleteAnnouncement);
router.post('/:id/read', protect, isStudent, markAnnouncementRead);

module.exports = router;

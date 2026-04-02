const express = require('express');
const router = express.Router();
const {
  getNotifications,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  clearOldNotifications,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

// Get all notifications for user
router.get('/', protect, getNotifications);

// Get unread count
router.get('/unread/count', protect, getUnreadCount);

// Get single notification
router.get('/:id', protect, getNotificationById);

// Mark notification as read
router.patch('/:id/read', protect, markAsRead);

// Mark all as read
router.patch('/read/all', protect, markAllAsRead);

// Delete notification
router.delete('/:id', protect, deleteNotification);

// Clear old notifications (admin only)
router.delete('/clear/old', protect, clearOldNotifications);

module.exports = router;

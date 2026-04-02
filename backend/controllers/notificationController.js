const Notification = require('../models/Notification');
const { resolveCourseCode } = require('../utils/courseContext');

// Get all unread notifications for a user
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { read, limit = 50, page = 1, type, courseId } = req.query;

    let query = { recipient: userId };
    if (read !== undefined) query.read = read === 'true';
    if (type) query.type = type;
    if (courseId) {
      const resolved = await resolveCourseCode(courseId);
      if (resolved) query.resourceId = resolved;
    }

    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate('sender', 'name avatar email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments(query),
    ]);

    res.json({
      notifications,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

// Get notification by ID
exports.getNotificationById = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id)
      .populate('sender', 'name avatar email')
      .populate('recipient', 'name email');

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Check ownership
    if (notification.recipient._id.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json(notification);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notification' });
  }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.recipient.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    notification.read = true;
    await notification.save();

    res.json(notification);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user.id, read: false },
      { read: true }
    );

    res.json({ modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.recipient.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await Notification.deleteOne({ _id: req.params.id });

    res.json({ message: 'Notification deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};

// Get unread count
exports.getUnreadCount = async (req, res) => {
  try {
    const { courseId } = req.query;
    const query = { recipient: req.user.id, read: false };

    if (courseId) {
      const resolved = await resolveCourseCode(courseId);
      if (resolved) query.resourceId = resolved;
    }

    const count = await Notification.countDocuments(query);

    res.json({ unreadCount: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
};

// Create notification (internal function, called by other controllers)
exports.createNotification = async (data) => {
  try {
    const notification = new Notification(data);
    await notification.save();
    return notification.populate('sender', 'name avatar email');
  } catch (err) {
    console.error('Failed to create notification:', err);
    return null;
  }
};

// Clear old notifications (can be job scheduled)
exports.clearOldNotifications = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await Notification.deleteMany({
      createdAt: { $lt: thirtyDaysAgo },
      read: true,
    });

    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
};

const mongoose = require('mongoose');
const Announcement = require('../models/Announcement');
const Course = require('../models/Course');
const { notifyCourseUpdate } = require('../utils/notificationUtils');

const ensureDbConnected = () => mongoose.connection.readyState === 1;

const publishDueAnnouncements = async (io, batchSize = 50) => {
  const now = new Date();

  // Step 1: publish (set publishedAt/sortAt) for any due scheduled announcements.
  const due = await Announcement.find({
    publishedAt: null,
    scheduledAt: { $ne: null, $lte: now },
  })
    .select('_id scheduledAt')
    .sort({ scheduledAt: 1 })
    .limit(batchSize)
    .lean();

  if (due.length) {
    await Promise.all(
      due.map((row) => {
        const publishAt = row.scheduledAt ? new Date(row.scheduledAt) : now;
        return Announcement.updateOne(
          { _id: row._id, publishedAt: null },
          {
            $set: {
              publishedAt: publishAt,
              sortAt: publishAt,
              scheduledAt: null,
              notificationsSent: false,
            },
          }
        );
      })
    );
  }

  // Step 2: send notifications for published announcements where we haven't sent yet.
  const pendingNotify = await Announcement.find({
    publishedAt: { $ne: null, $lte: now },
    notificationsSent: false,
  })
    .select('_id courseId title')
    .sort({ publishedAt: 1 })
    .limit(batchSize)
    .lean();

  for (const announcement of pendingNotify) {
    try {
      const course = await Course.findById(announcement.courseId).select('students courseCode');
      if (!course) {
        await Announcement.updateOne({ _id: announcement._id }, { $set: { notificationsSent: true } });
        continue;
      }

      const studentIds = Array.isArray(course.students) ? course.students.map((id) => String(id)) : [];
      if (studentIds.length) {
        const title = `New announcement • ${course.courseCode}`;
        const message = String(announcement.title || '').trim() || 'New announcement posted.';
        await notifyCourseUpdate(io, String(course.courseCode || '').trim().toLowerCase(), title, message, studentIds);
      }

      await Announcement.updateOne({ _id: announcement._id }, { $set: { notificationsSent: true } });

      if (io) {
        const courseKey = String(course.courseCode || '').trim().toLowerCase();
        io.to(`course:${courseKey}`).emit('announcements-updated', {
          reason: 'published',
          courseId: String(course._id),
          courseKey,
          announcementId: String(announcement._id),
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      // Keep notificationsSent=false so we retry later.
      console.error('Announcement scheduler notify error:', err);
    }
  }
};

const startAnnouncementScheduler = (app, options = {}) => {
  const intervalMs = Number(options.intervalMs) || 30_000;

  const tick = async () => {
    if (!ensureDbConnected()) return;
    try {
      const io = app?.get('io');
      await publishDueAnnouncements(io);
    } catch (err) {
      console.error('Announcement scheduler error:', err);
    }
  };

  // Start immediately and then on interval.
  tick();
  const timer = setInterval(tick, intervalMs);

  return () => clearInterval(timer);
};

module.exports = { startAnnouncementScheduler };

const mongoose = require('mongoose');
const Announcement = require('../models/Announcement');
const Course = require('../models/Course');
const { notifyCourseUpdate, getIO } = require('../utils/notificationUtils');

const ensureDbConnected = () => mongoose.connection.readyState === 1;

const parseOptionalDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
};

const normalizeAttachments = (value) => {
  if (!Array.isArray(value)) return [];
  const urls = value
    .map((u) => String(u || '').trim())
    .filter(Boolean);

  if (urls.length > 20) {
    return { error: 'attachments cannot exceed 20 items' };
  }

  for (const url of urls) {
    if (url.length > 2048) {
      return { error: 'attachment url too long' };
    }
  }

  return { attachments: urls };
};

const canStudentAccessCourse = async (courseId, studentId) => {
  const course = await Course.findById(courseId).select('students courseCode title').lean();
  if (!course) return { ok: false, status: 404, message: 'Course not found' };
  const enrolled = Array.isArray(course.students) && course.students.some((id) => String(id) === String(studentId));
  if (!enrolled) return { ok: false, status: 403, message: 'Not enrolled in this course' };
  return { ok: true, course };
};

const canProfessorAccessCourse = async (courseId, professorId) => {
  const course = await Course.findById(courseId).select('professor students courseCode title').lean();
  if (!course) return { ok: false, status: 404, message: 'Course not found' };
  if (String(course.professor) !== String(professorId)) {
    return { ok: false, status: 403, message: 'Not authorized for this course' };
  }
  return { ok: true, course };
};

const encodeCursor = (cursor) => {
  const json = JSON.stringify(cursor);
  return Buffer.from(json, 'utf8').toString('base64url');
};

const decodeCursor = (cursor) => {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch {
    return null;
  }
};

const buildCursorFilter = (cursor) => {
  if (!cursor) return null;

  const pinned = cursor.isPinned ? 1 : 0;
  const sortAt = cursor.sortAt ? new Date(cursor.sortAt) : null;
  const id = cursor.id ? String(cursor.id) : '';

  if (!sortAt || Number.isNaN(sortAt.getTime()) || !id) return null;

  let idObj = null;
  try {
    idObj = new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }

  return {
    $or: [
      { isPinned: { $lt: Boolean(pinned) } },
      { isPinned: Boolean(pinned), sortAt: { $lt: sortAt } },
      { isPinned: Boolean(pinned), sortAt, _id: { $lt: idObj } },
    ],
  };
};

const emitAnnouncementUpdated = (io, course, announcementId, reason) => {
  if (!io || !course) return;
  const courseId = String(course._id);
  const courseKey = String(course.courseCode || '').trim().toLowerCase();

  const payload = {
    reason,
    courseId,
    courseKey,
    announcementId: announcementId ? String(announcementId) : undefined,
    timestamp: new Date().toISOString(),
  };

  io.to(`course:${courseKey}`).emit('announcements-updated', payload);

  const students = Array.isArray(course.students) ? course.students : [];
  students.forEach((studentId) => {
    io.to(`user:${studentId}`).emit('announcements-updated', payload);
  });
};

const sendAnnouncementNotifications = async (io, course, professorId, announcement) => {
  const studentIds = Array.isArray(course.students) ? course.students.map((id) => String(id)) : [];
  if (!studentIds.length) return;

  const title = `New announcement • ${course.courseCode}`;
  const message = String(announcement.title || '').trim() || 'New announcement posted.';

  await notifyCourseUpdate(io, String(course.courseCode || '').trim().toLowerCase(), title, message, studentIds);
};

// POST /announcements
const createAnnouncement = async (req, res) => {
  if (!ensureDbConnected()) {
    return res.status(503).json({ message: 'Database is not connected' });
  }

  try {
    const professorId = req.user?._id;
    const { courseId, title, content, attachments, scheduledAt, isPinned } = req.body || {};

    if (!professorId) return res.status(401).json({ message: 'Unauthorized' });
    if (!courseId) return res.status(400).json({ message: 'courseId is required' });
    if (!String(title || '').trim()) return res.status(400).json({ message: 'title is required' });

    const courseCheck = await canProfessorAccessCourse(courseId, professorId);
    if (!courseCheck.ok) return res.status(courseCheck.status).json({ message: courseCheck.message });

    const parsedScheduledAt = parseOptionalDate(scheduledAt);
    if (parsedScheduledAt === undefined) {
      return res.status(400).json({ message: 'scheduledAt is invalid' });
    }

    const normalized = normalizeAttachments(attachments);
    if (normalized.error) return res.status(400).json({ message: normalized.error });

    const now = new Date();
    const shouldPublishNow = !parsedScheduledAt || parsedScheduledAt <= now;

    const publishedAt = shouldPublishNow ? now : null;
    const scheduledAtValue = shouldPublishNow ? null : parsedScheduledAt;
    const sortAt = shouldPublishNow ? publishedAt : scheduledAtValue;

    const announcement = await Announcement.create({
      courseId,
      professorId,
      title: String(title).trim(),
      content: String(content || ''),
      attachments: normalized.attachments,
      isPinned: Boolean(isPinned),
      scheduledAt: scheduledAtValue,
      publishedAt,
      sortAt,
      notificationsSent: false,
      readBy: [],
    });

    const io = getIO(req);

    if (shouldPublishNow) {
      await sendAnnouncementNotifications(io, courseCheck.course, professorId, announcement);
      await Announcement.updateOne({ _id: announcement._id }, { $set: { notificationsSent: true } });
      emitAnnouncementUpdated(io, courseCheck.course, announcement._id, 'created');
    } else {
      emitAnnouncementUpdated(io, courseCheck.course, announcement._id, 'scheduled');
    }

    return res.status(201).json({
      message: shouldPublishNow ? 'Announcement posted.' : 'Announcement scheduled.',
      announcement,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to create announcement' });
  }
};

// GET /announcements?courseId=&limit=&cursor=
const listAnnouncements = async (req, res) => {
  if (!ensureDbConnected()) {
    return res.status(503).json({ message: 'Database is not connected' });
  }

  try {
    const userId = req.user?._id;
    const role = req.user?.role;
    const { courseId } = req.query || {};

    if (!courseId) return res.status(400).json({ message: 'courseId is required' });

    let course = null;
    if (role === 'student') {
      const check = await canStudentAccessCourse(courseId, userId);
      if (!check.ok) return res.status(check.status).json({ message: check.message });
      course = check.course;
    } else if (role === 'professor') {
      const check = await canProfessorAccessCourse(courseId, userId);
      if (!check.ok) return res.status(check.status).json({ message: check.message });
      course = check.course;
    } else {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

    const cursor = decodeCursor(req.query?.cursor);
    const cursorFilter = buildCursorFilter(cursor);

    const now = new Date();
    const baseMatch = { courseId: new mongoose.Types.ObjectId(courseId) };

    if (role === 'student') {
      baseMatch.publishedAt = { $ne: null, $lte: now };
    } else {
      const includeScheduled = String(req.query?.includeScheduled || 'true').toLowerCase() !== 'false';
      if (!includeScheduled) {
        baseMatch.publishedAt = { $ne: null, $lte: now };
      }
    }

    const matchStage = cursorFilter ? { $and: [baseMatch, cursorFilter] } : baseMatch;

    const pipeline = [
      { $match: matchStage },
      { $sort: { isPinned: -1, sortAt: -1, _id: -1 } },
      { $limit: limit + 1 },
    ];

    if (role === 'student') {
      pipeline.push(
        {
          $addFields: {
            isRead: {
              $in: [new mongoose.Types.ObjectId(userId), '$readBy'],
            },
          },
        },
        {
          $project: {
            readBy: 0,
            notificationsSent: 0,
            __v: 0,
          },
        }
      );
    } else {
      pipeline.push(
        {
          $addFields: {
            readCount: { $size: { $ifNull: ['$readBy', []] } },
          },
        },
        {
          $project: {
            readBy: 0,
            notificationsSent: 0,
            __v: 0,
          },
        }
      );
    }

    const rows = await Announcement.aggregate(pipeline);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore
      ? encodeCursor({
          isPinned: Boolean(items[items.length - 1].isPinned),
          sortAt: items[items.length - 1].sortAt,
          id: String(items[items.length - 1]._id),
        })
      : null;

    return res.status(200).json({
      course: { _id: course._id, courseCode: course.courseCode, title: course.title },
      announcements: items,
      nextCursor,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch announcements' });
  }
};

// PATCH /announcements/:id
const updateAnnouncement = async (req, res) => {
  if (!ensureDbConnected()) {
    return res.status(503).json({ message: 'Database is not connected' });
  }

  try {
    const professorId = req.user?._id;
    const { id } = req.params;

    if (!professorId) return res.status(401).json({ message: 'Unauthorized' });

    const announcement = await Announcement.findById(id);
    if (!announcement) return res.status(404).json({ message: 'Announcement not found' });

    if (String(announcement.professorId) !== String(professorId)) {
      return res.status(403).json({ message: 'Not authorized to edit this announcement' });
    }

    const courseCheck = await canProfessorAccessCourse(announcement.courseId, professorId);
    if (!courseCheck.ok) return res.status(courseCheck.status).json({ message: courseCheck.message });

    const patch = req.body || {};

    if (patch.title !== undefined) {
      if (!String(patch.title || '').trim()) return res.status(400).json({ message: 'title cannot be empty' });
      announcement.title = String(patch.title).trim();
    }

    if (patch.content !== undefined) {
      announcement.content = String(patch.content || '');
    }

    if (patch.attachments !== undefined) {
      const normalized = normalizeAttachments(patch.attachments);
      if (normalized.error) return res.status(400).json({ message: normalized.error });
      announcement.attachments = normalized.attachments;
    }

    if (patch.isPinned !== undefined) {
      announcement.isPinned = Boolean(patch.isPinned);
    }

    let publishedNow = false;

    if (patch.scheduledAt !== undefined) {
      const parsedScheduledAt = parseOptionalDate(patch.scheduledAt);
      if (parsedScheduledAt === undefined) {
        return res.status(400).json({ message: 'scheduledAt is invalid' });
      }

      const now = new Date();

      // Disallow moving already-published announcements to the future.
      if (announcement.publishedAt && parsedScheduledAt && parsedScheduledAt > now) {
        return res.status(400).json({ message: 'Cannot schedule an already published announcement' });
      }

      if (!parsedScheduledAt || parsedScheduledAt <= now) {
        if (!announcement.publishedAt) {
          announcement.publishedAt = now;
          announcement.scheduledAt = null;
          announcement.sortAt = now;
          announcement.notificationsSent = false;
          publishedNow = true;
        } else {
          announcement.scheduledAt = null;
          announcement.sortAt = announcement.publishedAt;
        }
      } else {
        // schedule in future (only allowed if not yet published)
        if (announcement.publishedAt) {
          return res.status(400).json({ message: 'Cannot schedule an already published announcement' });
        }
        announcement.scheduledAt = parsedScheduledAt;
        announcement.sortAt = parsedScheduledAt;
      }
    }

    await announcement.save();

    const io = getIO(req);
    if (publishedNow) {
      await sendAnnouncementNotifications(io, courseCheck.course, professorId, announcement);
      await Announcement.updateOne({ _id: announcement._id }, { $set: { notificationsSent: true } });
      emitAnnouncementUpdated(io, courseCheck.course, announcement._id, 'published');
    } else {
      emitAnnouncementUpdated(io, courseCheck.course, announcement._id, 'updated');
    }

    return res.status(200).json({ message: 'Announcement updated.', announcement });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update announcement' });
  }
};

// DELETE /announcements/:id
const deleteAnnouncement = async (req, res) => {
  if (!ensureDbConnected()) {
    return res.status(503).json({ message: 'Database is not connected' });
  }

  try {
    const professorId = req.user?._id;
    const { id } = req.params;

    if (!professorId) return res.status(401).json({ message: 'Unauthorized' });

    const announcement = await Announcement.findById(id).lean();
    if (!announcement) return res.status(404).json({ message: 'Announcement not found' });

    if (String(announcement.professorId) !== String(professorId)) {
      return res.status(403).json({ message: 'Not authorized to delete this announcement' });
    }

    const courseCheck = await canProfessorAccessCourse(announcement.courseId, professorId);
    if (!courseCheck.ok) return res.status(courseCheck.status).json({ message: courseCheck.message });

    await Announcement.deleteOne({ _id: id });

    const io = getIO(req);
    emitAnnouncementUpdated(io, courseCheck.course, id, 'deleted');

    return res.status(200).json({ message: 'Announcement deleted.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to delete announcement' });
  }
};

// POST /announcements/:id/read
const markAnnouncementRead = async (req, res) => {
  if (!ensureDbConnected()) {
    return res.status(503).json({ message: 'Database is not connected' });
  }

  try {
    const studentId = req.user?._id;
    const { id } = req.params;

    if (!studentId) return res.status(401).json({ message: 'Unauthorized' });

    const announcement = await Announcement.findById(id).select('courseId publishedAt');
    if (!announcement) return res.status(404).json({ message: 'Announcement not found' });

    const courseCheck = await canStudentAccessCourse(announcement.courseId, studentId);
    if (!courseCheck.ok) return res.status(courseCheck.status).json({ message: courseCheck.message });

    // Students can only read-track published announcements.
    if (!announcement.publishedAt || new Date(announcement.publishedAt) > new Date()) {
      return res.status(403).json({ message: 'Announcement not published yet' });
    }

    const isRead = req.body?.isRead;
    const shouldRead = isRead === undefined ? true : Boolean(isRead);

    const update = shouldRead
      ? { $addToSet: { readBy: studentId } }
      : { $pull: { readBy: studentId } };

    await Announcement.updateOne({ _id: id }, update);

    return res.status(200).json({ message: shouldRead ? 'Marked as read.' : 'Marked as unread.' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update read status' });
  }
};

module.exports = {
  createAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  deleteAnnouncement,
  markAnnouncementRead,
};

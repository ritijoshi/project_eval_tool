/**
 * Notification Helper Utilities
 * Used across controllers to send real-time notifications via WebSocket + save to DB
 */

const Notification = require('../models/Notification');

/**
 * Send feedback reviewed notification
 * @param {Object} io - Socket.io instance
 * @param {String} studentId - Recipient student ID
 * @param {String} professorId - Sender professor ID
 * @param {String} feedbackId - Feedback ID
 * @param {String} courseKey - Course key
 * @param {String} professorName - Professor name for message
 */
exports.notifyFeedbackReviewed = async (io, studentId, professorId, feedbackId, courseKey, professorName) => {
  try {
    const notification = await Notification.create({
      recipient: studentId,
      sender: professorId,
      type: 'feedback_reviewed',
      title: 'Your Feedback Has Been Reviewed',
      message: `${professorName} has reviewed and provided feedback on your submission.`,
      resourceType: 'feedback',
      resourceId: feedbackId,
      priority: 'high',
      actionUrl: `/feedback/${feedbackId}`,
    });

    // Real-time via WebSocket
    if (io) {
      io.to(`user:${studentId}`).emit('feedback-reviewed', {
        feedbackId,
        courseKey,
        professorName,
        message: `${professorName} has reviewed your submission`,
      });
    }

    return notification;
  } catch (err) {
    console.error('Error sending feedback reviewed notification:', err);
  }
};

/**
 * Send student response notification to professor
 * @param {Object} io - Socket.io instance
 * @param {String} professorId - Recipient professor ID
 * @param {String} studentId - Sender student ID
 * @param {String} feedbackId - Feedback ID
 * @param {String} courseKey - Course key
 * @param {String} studentName - Student name
 * @param {Boolean} isQuestion - Is it a question or response
 */
exports.notifyStudentResponse = async (io, professorId, studentId, feedbackId, courseKey, studentName, isQuestion = false) => {
  try {
    const notification = await Notification.create({
      recipient: professorId,
      sender: studentId,
      type: 'feedback_response',
      title: isQuestion ? 'Student Question' : 'Student Response',
      message: `${studentName} has ${isQuestion ? 'asked a question' : 'responded'} to your feedback.`,
      resourceType: 'feedback',
      resourceId: feedbackId,
      priority: 'medium',
      actionUrl: `/evaluations/${feedbackId}`,
    });

    // Real-time via WebSocket
    if (io) {
      io.to(`user:${professorId}`).emit('student-responded', {
        feedbackId,
        courseKey,
        studentName,
        messageType: isQuestion ? 'question' : 'response',
        message: `${studentName} has ${isQuestion ? 'asked a question' : 'responded'} to your feedback`,
      });
    }

    return notification;
  } catch (err) {
    console.error('Error sending student response notification:', err);
  }
};

/**
 * Send evaluation completed notification
 * @param {Object} io - Socket.io instance
 * @param {String} studentId - Recipient student ID
 * @param {String} evaluationId - Evaluation ID
 * @param {String} courseKey - Course key
 * @param {Number} score - Score percentage
 */
exports.notifyEvaluationCompleted = async (io, studentId, evaluationId, courseKey, score) => {
  try {
    const notification = await Notification.create({
      recipient: studentId,
      type: 'evaluation_ready',
      title: 'Your Evaluation is Ready',
      message: `Your submission for ${courseKey} has been evaluated with a score of ${score}%.`,
      resourceType: 'evaluation',
      resourceId: evaluationId,
      priority: 'high',
      actionUrl: `/feedback/${evaluationId}`,
    });

    // Real-time via WebSocket
    if (io) {
      io.to(`user:${studentId}`).emit('evaluation-completed', {
        evaluationId,
        courseKey,
        score,
        message: `Your evaluation is ready! Score: ${score}%`,
      });
    }

    return notification;
  } catch (err) {
    console.error('Error sending evaluation completed notification:', err);
  }
};

/**
 * Send chat message notification
 * @param {Object} io - Socket.io instance
 * @param {String} recipientId - Recipient user ID
 * @param {String} senderId - Sender user ID
 * @param {String} senderName - Sender name
 * @param {String} message - Message content
 */
exports.notifyChatMessage = async (io, recipientId, senderId, senderName, message) => {
  try {
    const notification = await Notification.create({
      recipient: recipientId,
      sender: senderId,
      type: 'chat_message',
      title: 'New Message from ' + senderName,
      message: message.substring(0, 100),
      resourceType: 'chat',
      priority: 'medium',
    });

    // Real-time via WebSocket
    if (io) {
      io.to(`user:${recipientId}`).emit('notification', {
        type: 'chat_message',
        title: 'New Message from ' + senderName,
        message: message.substring(0, 100),
      });
    }

    return notification;
  } catch (err) {
    console.error('Error sending chat notification:', err);
  }
};

/**
 * Send course update notification
 * @param {Object} io - Socket.io instance
 * @param {String} courseKey - Course key
 * @param {String} title - Notification title
 * @param {String} message - Notification message
 * @param {Array<String>} studentIds - Student IDs to notify
 */
exports.notifyCourseUpdate = async (io, courseKey, title, message, studentIds) => {
  try {
    // Create notifications for all students
    const notifications = await Notification.insertMany(
      studentIds.map((studentId) => ({
        recipient: studentId,
        type: 'course_update',
        title,
        message,
        resourceType: 'course',
        resourceId: courseKey,
        priority: 'medium',
      }))
    );

    // Real-time via WebSocket to course room
    if (io) {
      io.to(`course:${courseKey}`).emit('course-update', {
        title,
        message,
        courseKey,
        timestamp: new Date(),
      });
    }

    return notifications;
  } catch (err) {
    console.error('Error sending course update notification:', err);
  }
};

/**
 * Send material uploaded notification
 * @param {Object} io - Socket.io instance
 * @param {String} courseKey - Course key
 * @param {String} materialName - Material name
 * @param {Array<String>} studentIds - Student IDs to notify
 */
exports.notifyMaterialUploaded = async (io, courseKey, materialName, studentIds) => {
  try {
    const notifications = await Notification.insertMany(
      studentIds.map((studentId) => ({
        recipient: studentId,
        type: 'material_uploaded',
        title: 'New Course Material Available',
        message: `${materialName} has been uploaded for ${courseKey}.`,
        resourceType: 'material',
        resourceId: courseKey,
        priority: 'medium',
        actionUrl: `/course/${courseKey}`,
      }))
    );

    // Real-time via WebSocket
    if (io) {
      io.to(`course:${courseKey}`).emit('material-uploaded', {
        materialName,
        courseKey,
        timestamp: new Date(),
      });
    }

    return notifications;
  } catch (err) {
    console.error('Error sending material uploaded notification:', err);
  }
};

/**
 * Send announcement to all professors
 * @param {Object} io - Socket.io instance
 * @param {String} title - Announcement title
 * @param {String} message - Announcement message
 * @param {String} priority - Priority level
 */
exports.broadcastToProfessors = async (io, title, message, priority = 'medium') => {
  try {
    // Real-time broadcast
    if (io) {
      io.to('role:professor').emit('admin-announcement', {
        title,
        message,
        priority,
        timestamp: new Date(),
      });
    }
  } catch (err) {
    console.error('Error broadcasting to professors:', err);
  }
};

/**
 * Send generic notification
 * @param {Object} io - Socket.io instance
 * @param {String} recipientId - Recipient user ID
 * @param {String} type - Notification type
 * @param {String} title - Title
 * @param {String} message - Message
 * @param {String} priority - Priority level
 * @param {Object} metadata - Additional metadata
 */
exports.sendNotification = async (io, recipientId, type, title, message, priority = 'medium', metadata = {}) => {
  try {
    const notificationData = {
      recipient: recipientId,
      type,
      title,
      message,
      priority,
      ...metadata,
    };

    const notification = await Notification.create(notificationData);

    // Real-time via WebSocket
    if (io) {
      io.to(`user:${recipientId}`).emit('notification', {
        type,
        title,
        message,
        priority,
        ...metadata,
      });
    }

    return notification;
  } catch (err) {
    console.error('Error sending notification:', err);
  }
};

/**
 * Get socket.io instance from Express request
 * Usage in controller: const io = getIO(req);
 */
exports.getIO = (req) => {
  return req.app.get('io');
};

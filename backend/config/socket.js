const socketIO = require('socket.io');
const Notification = require('../models/Notification');
const jwt = require('jsonwebtoken');
const { getAllowedOrigins } = require('./services');

// Store active connections: userId -> socketId
const activeUsers = new Map();

const initializeSocket = (server) => {
  const allowedOrigins = getAllowedOrigins();
  const io = socketIO(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  // Middleware: Verify JWT token
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // Connection handlers
  io.on('connection', (socket) => {
    console.log(`User ${socket.userId} connected with socket ${socket.id}`);

    // Store user connection
    activeUsers.set(socket.userId, socket.id);

    // Emit user online event
    socket.broadcast.emit('user-online', {
      userId: socket.userId,
      timestamp: new Date(),
    });

    // Join user's personal room
    socket.join(`user:${socket.userId}`);
    socket.join(`role:${socket.userRole}`);

    // ===== REAL-TIME CHAT =====
    socket.on('chat-message', async (data) => {
      try {
        const { courseKey, message, recipientId } = data;

        // Emit to course room
        socket.broadcast.to(`course:${courseKey}`).emit('chat-message', {
          senderId: socket.userId,
          message,
          courseKey,
          timestamp: new Date(),
        });

        // Send notification to recipient
        if (recipientId) {
          await Notification.create({
            recipient: recipientId,
            sender: socket.userId,
            type: 'chat_message',
            title: 'New Chat Message',
            message,
            resourceType: 'chat',
            resourceId: courseKey,
            priority: 'medium',
          });

          io.to(`user:${recipientId}`).emit('notification', {
            type: 'chat_message',
            message: 'You have a new message',
          });
        }
      } catch (err) {
        console.error('Chat error:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Join course room
    socket.on('join-course', (courseKey) => {
      socket.join(`course:${courseKey}`);
      socket.broadcast.to(`course:${courseKey}`).emit('user-joined', {
        userId: socket.userId,
        courseKey,
      });
    });

    // Leave course room
    socket.on('leave-course', (courseKey) => {
      socket.leave(`course:${courseKey}`);
      socket.broadcast.to(`course:${courseKey}`).emit('user-left', {
        userId: socket.userId,
        courseKey,
      });
    });

    // ===== FEEDBACK NOTIFICATIONS =====
    socket.on('feedback-reviewed', async (data) => {
      try {
        const { feedbackId, studentId, professorName } = data;

        await Notification.create({
          recipient: studentId,
          sender: socket.userId,
          type: 'feedback_reviewed',
          title: 'Your Feedback Has Been Reviewed',
          message: `${professorName} has reviewed and provided feedback on your submission.`,
          resourceType: 'feedback',
          resourceId: feedbackId,
          priority: 'high',
          actionUrl: `/feedback/${feedbackId}`,
        });

        io.to(`user:${studentId}`).emit('feedback-reviewed', {
          feedbackId,
          message: 'Your feedback has been reviewed',
        });
      } catch (err) {
        console.error('Feedback review notification error:', err);
      }
    });

    socket.on('student-responded', async (data) => {
      try {
        const { feedbackId, professorId, studentName } = data;

        await Notification.create({
          recipient: professorId,
          sender: socket.userId,
          type: 'feedback_response',
          title: 'Student Responded to Feedback',
          message: `${studentName} has responded to your feedback.`,
          resourceType: 'feedback',
          resourceId: feedbackId,
          priority: 'medium',
          actionUrl: `/evaluations/${feedbackId}`,
        });

        io.to(`user:${professorId}`).emit('student-responded', {
          feedbackId,
          message: 'Student has responded to your feedback',
        });
      } catch (err) {
        console.error('Student response notification error:', err);
      }
    });

    // ===== EVALUATION NOTIFICATIONS =====
    socket.on('evaluation-completed', async (data) => {
      try {
        const { evaluationId, studentId, courseKey, score } = data;

        await Notification.create({
          recipient: studentId,
          type: 'evaluation_ready',
          title: 'Your Project Has Been Evaluated',
          message: `Your submission for ${courseKey} has been evaluated with a score of ${score}%.`,
          resourceType: 'evaluation',
          resourceId: evaluationId,
          priority: 'high',
          actionUrl: `/feedback/${evaluationId}`,
        });

        io.to(`user:${studentId}`).emit('evaluation-completed', {
          evaluationId,
          courseKey,
          score,
          message: 'Your evaluation is ready',
        });
      } catch (err) {
        console.error('Evaluation notification error:', err);
      }
    });

    // ===== GENERAL NOTIFICATIONS =====
    socket.on('send-notification', async (data) => {
      try {
        const { recipientId, type, title, message, priority = 'medium' } = data;

        const notification = await Notification.create({
          recipient: recipientId,
          sender: socket.userId,
          type,
          title,
          message,
          priority,
        });

        io.to(`user:${recipientId}`).emit('notification', notification);
      } catch (err) {
        console.error('Notification send error:', err);
      }
    });

    // ===== BROADCAST TO ROLE =====
    socket.on('broadcast-to-professors', async (data) => {
      try {
        const { title, message, priority = 'medium' } = data;

        io.to('role:professor').emit('admin-announcement', {
          title,
          message,
          timestamp: new Date(),
          priority,
        });
      } catch (err) {
        console.error('Broadcast error:', err);
      }
    });

    // ===== TYPING INDICATORS =====
    socket.on('typing', (data) => {
      const { courseKey } = data;
      socket.broadcast.to(`course:${courseKey}`).emit('user-typing', {
        userId: socket.userId,
      });
    });

    socket.on('stop-typing', (data) => {
      const { courseKey } = data;
      socket.broadcast.to(`course:${courseKey}`).emit('user-stop-typing', {
        userId: socket.userId,
      });
    });

    // ===== PRESENCE TRACKING =====
    socket.on('request-active-users', (courseKey) => {
      const users = Array.from(activeUsers.entries()).map(([userId]) => userId);
      socket.emit('active-users', { users, courseKey });
    });

    // Disconnect handler
    socket.on('disconnect', () => {
      console.log(`User ${socket.userId} disconnected`);

      // Remove from active users
      activeUsers.delete(socket.userId);

      // Emit user offline event
      socket.broadcast.emit('user-offline', {
        userId: socket.userId,
        timestamp: new Date(),
      });
    });

    // Error handler
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  return io;
};

module.exports = { initializeSocket, activeUsers };

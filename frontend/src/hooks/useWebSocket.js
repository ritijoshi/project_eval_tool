import { useEffect, useState, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { API_BASE } from '../config/api';

/**
 * Custom hook for WebSocket connection and events
 * Usage: const { socket, isConnected, on, emit, off } = useWebSocket();
 */
export const useWebSocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);
  const eventsRef = useRef({});

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const socketUrl = API_BASE;

    // Initialize socket connection
    socketRef.current = io(socketUrl, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    // Connection handlers
    socketRef.current.on('connect', () => {
      setIsConnected(true);
      console.log('WebSocket connected');
    });

    socketRef.current.on('disconnect', () => {
      setIsConnected(false);
      console.log('WebSocket disconnected');
    });

    socketRef.current.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const on = useCallback((event, callback) => {
    if (socketRef.current) {
      socketRef.current.on(event, callback);
      if (!eventsRef.current[event]) {
        eventsRef.current[event] = [];
      }
      eventsRef.current[event].push(callback);
    }
  }, []);

  const off = useCallback((event, callback) => {
    if (socketRef.current) {
      socketRef.current.off(event, callback);
      if (eventsRef.current[event]) {
        eventsRef.current[event] = eventsRef.current[event].filter(
          (cb) => cb !== callback
        );
      }
    }
  }, []);

  const emit = useCallback((event, data) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit(event, data);
    }
  }, [isConnected]);

  return {
    socket: socketRef.current,
    isConnected,
    on,
    off,
    emit,
  };
};

/**
 * Hook for listening to feedback updates
 */
export const useFeedbackUpdates = (feedbackId, onFeedbackReviewed, onStudentResponded) => {
  const { on, off, emit } = useWebSocket();

  useEffect(() => {
    if (!feedbackId) return;

    on('feedback-reviewed', (data) => {
      if (data.feedbackId === feedbackId && onFeedbackReviewed) {
        onFeedbackReviewed(data);
      }
    });

    on('student-responded', (data) => {
      if (data.feedbackId === feedbackId && onStudentResponded) {
        onStudentResponded(data);
      }
    });

    return () => {
      off('feedback-reviewed', onFeedbackReviewed);
      off('student-responded', onStudentResponded);
    };
  }, [feedbackId, on, off, onFeedbackReviewed, onStudentResponded]);
};

/**
 * Hook for listening to notifications
 */
export const useNotifications = (onNotification) => {
  const { on, off } = useWebSocket();

  useEffect(() => {
    on('notification', onNotification);
    on('feedback-reviewed', onNotification);
    on('student-responded', onNotification);
    on('evaluation-completed', onNotification);

    return () => {
      off('notification', onNotification);
      off('feedback-reviewed', onNotification);
      off('student-responded', onNotification);
      off('evaluation-completed', onNotification);
    };
  }, [on, off, onNotification]);
};

/**
 * Hook for course chat with real-time updates
 */
export const useCourseChat = (courseKey) => {
  const { on, off, emit } = useWebSocket();
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!courseKey) return;

    // Join course room
    emit('join-course', courseKey);

    // Listen for new messages
    on('chat-message', (data) => {
      setMessages((prev) => [...prev, data]);
    });

    // Listen for user typing
    on('user-typing', (data) => {
      console.log(`${data.userId} is typing...`);
    });

    on('user-stop-typing', (data) => {
      console.log(`${data.userId} stopped typing`);
    });

    return () => {
      emit('leave-course', courseKey);
      off('chat-message', null);
      off('user-typing', null);
      off('user-stop-typing', null);
    };
  }, [courseKey, emit, on, off]);

  const sendMessage = useCallback((message, recipientId = null) => {
    emit('chat-message', {
      courseKey,
      message,
      recipientId,
    });
  }, [courseKey, emit]);

  const sendTyping = useCallback(() => {
    emit('typing', { courseKey });
  }, [courseKey, emit]);

  const sendStopTyping = useCallback(() => {
    emit('stop-typing', { courseKey });
  }, [courseKey, emit]);

  return {
    messages,
    sendMessage,
    sendTyping,
    sendStopTyping,
    setMessages,
  };
};

/**
 * Hook for real-time presence tracking
 */
export const usePresence = (courseKey) => {
  const { on, off, emit, isConnected } = useWebSocket();
  const [activeUsers, setActiveUsers] = useState([]);

  useEffect(() => {
    if (!courseKey || !isConnected) return;

    on('user-online', (data) => {
      console.log(`User ${data.userId} came online`);
    });

    on('user-offline', (data) => {
      console.log(`User ${data.userId} went offline`);
    });

    on('active-users', (data) => {
      setActiveUsers(data.users);
    });

    // Request active users on mount
    emit('request-active-users', courseKey);

    return () => {
      off('user-online', null);
      off('user-offline', null);
      off('active-users', null);
    };
  }, [courseKey, isConnected, emit, on, off]);

  return { activeUsers };
};

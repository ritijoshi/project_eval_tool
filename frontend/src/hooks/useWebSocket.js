import { useEffect, useState, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { API_BASE } from '../config/api';

/**
 * Custom hook for WebSocket connection and events
 * Usage: const { isConnected, on, emit, off } = useWebSocket();
 */
export const useWebSocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);
  const eventsRef = useRef({});
  const [token, setToken] = useState(() => localStorage.getItem('token'));

  useEffect(() => {
    const syncToken = () => {
      const nextToken = localStorage.getItem('token');
      setToken(nextToken);
      if (!nextToken) {
        setIsConnected(false);
      }
    };

    const handleStorage = (e) => {
      if (e.key === 'token' || e.key === 'role' || e.key === 'user') {
        syncToken();
      }
    };

    // Same-tab updates (we dispatch this after login/logout)
    window.addEventListener('auth-changed', syncToken);

    // Cross-tab updates
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('auth-changed', syncToken);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const socketUrl = API_BASE;

    // Initialize socket connection
    socketRef.current = io(socketUrl, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });

    // Attach any listeners that were registered before the socket existed.
    Object.entries(eventsRef.current).forEach(([event, callbacks]) => {
      (callbacks || []).forEach((cb) => {
        if (typeof cb === 'function') {
          socketRef.current.on(event, cb);
        }
      });
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
        socketRef.current = null;
      }
    };
  }, [token]);

  const on = useCallback((event, callback) => {
    if (!eventsRef.current[event]) {
      eventsRef.current[event] = [];
    }
    if (callback && !eventsRef.current[event].includes(callback)) {
      eventsRef.current[event].push(callback);
    }

    if (socketRef.current && typeof callback === 'function') {
      socketRef.current.on(event, callback);
    }
  }, []);

  const off = useCallback((event, callback) => {
    if (socketRef.current) {
      socketRef.current.off(event, callback);
    }

    if (eventsRef.current[event]) {
      eventsRef.current[event] = eventsRef.current[event].filter((cb) => cb !== callback);
    }
  }, []);

  const emit = useCallback((event, data) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit(event, data);
    }
  }, [isConnected]);

  return {
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
  const { on, off } = useWebSocket();

  useEffect(() => {
    if (!feedbackId) return;

    const handleReviewed = (data) => {
      if (data.feedbackId === feedbackId && onFeedbackReviewed) {
        onFeedbackReviewed(data);
      }
    };

    const handleResponded = (data) => {
      if (data.feedbackId === feedbackId && onStudentResponded) {
        onStudentResponded(data);
      }
    };

    on('feedback-reviewed', handleReviewed);
    on('student-responded', handleResponded);

    return () => {
      off('feedback-reviewed', handleReviewed);
      off('student-responded', handleResponded);
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

    const handleChatMessage = (data) => {
      setMessages((prev) => [...prev, data]);
    };

    const handleTyping = (data) => {
      console.log(`${data.userId} is typing...`);
    };

    const handleStopTyping = (data) => {
      console.log(`${data.userId} stopped typing`);
    };

    // Join course room
    emit('join-course', courseKey);

    // Listen for new messages
    on('chat-message', handleChatMessage);
    on('user-typing', handleTyping);
    on('user-stop-typing', handleStopTyping);

    return () => {
      emit('leave-course', courseKey);
      off('chat-message', handleChatMessage);
      off('user-typing', handleTyping);
      off('user-stop-typing', handleStopTyping);
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

    const handleOnline = (data) => {
      console.log(`User ${data.userId} came online`);
    };

    const handleOffline = (data) => {
      console.log(`User ${data.userId} went offline`);
    };

    const handleActiveUsers = (data) => {
      setActiveUsers(data.users);
    };

    on('user-online', handleOnline);
    on('user-offline', handleOffline);
    on('active-users', handleActiveUsers);

    // Request active users on mount
    emit('request-active-users', courseKey);

    return () => {
      off('user-online', handleOnline);
      off('user-offline', handleOffline);
      off('active-users', handleActiveUsers);
    };
  }, [courseKey, isConnected, emit, on, off]);

  return { activeUsers };
};

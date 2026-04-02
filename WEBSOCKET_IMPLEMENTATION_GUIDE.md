# Implementation Guide: WebSockets & Real-Time Updates

## Quick Start

### 1. Backend Setup - Already Complete ✅
- WebSocket server initialized with Socket.io
- JWT authentication for WebSocket connections
- Notification model and REST API endpoints
- Notification utilities for easy integration

### 2. Frontend Setup - Already Complete ✅
- Socket.io client hooks (`useWebSocket`, `useFeedbackUpdates`, etc.)
- Installed in package.json
- Ready to use in React components

---

## Using WebSocket in Controllers

### Example 1: Emit notification when professor reviews feedback

```javascript
// backend/controllers/feedbackController.js
const { notifyFeedbackReviewed } = require('../utils/notificationUtils');

const addProfessorFeedback = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { manualFeedback, scoreAdjustment } = req.body;
    const io = req.app.get('io'); // Already done in implementation

    // ... existing code ...

    // Send real-time notification
    await notifyFeedbackReviewed(
      io,
      feedback.student._id,
      req.user._id,
      feedbackId,
      feedback.courseKey,
      req.user.name
    );

    res.json({ message: 'Feedback added', feedback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
```

### Example 2: Send notification when material is uploaded

```javascript
// backend/controllers/professorController.js
const { notifyMaterialUploaded } = require('../utils/notificationUtils');

const uploadMaterial = async (req, res) => {
  try {
    const { courseKey } = req.body;
    const io = req.app.get('io');
    
    // ... existing upload code ...

    // Get all students in course
    const students = await User.find({ courses: courseKey });
    const studentIds = students.map(s => s._id);

    // Send notifications
    await notifyMaterialUploaded(
      io,
      courseKey,
      req.files[0].originalname,
      studentIds
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
```

### Example 3: Custom notification

```javascript
// In any controller
const { sendNotification } = require('../utils/notificationUtils');

const customAction = async (req, res) => {
  try {
    const io = req.app.get('io');
    
    // ... your logic ...

    // Send custom notification
    await sendNotification(
      io,
      studentId,
      'general',
      'Action Completed',
      'Your action has been processed successfully',
      'medium',
      {
        actionUrl: '/dashboard',
        resourceId: actionId
      }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
```

---

## Using WebSocket Hooks in React Components

### Example 1: Real-time Feedback Updates

```javascript
// frontend/src/components/FeedbackViewer.jsx
import { useFeedbackUpdates } from '../hooks/useWebSocket';
import { useState, useEffect } from 'react';
import axios from 'axios';

export function FeedbackViewer({ feedbackId }) {
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch feedback from REST API
  useEffect(() => {
    const fetchFeedback = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(
          `http://localhost:5000/api/feedback/${feedbackId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setFeedback(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchFeedback();
  }, [feedbackId]);

  // Listen for real-time updates
  const handleFeedbackReviewed = (data) => {
    console.log('Feedback was reviewed:', data);
    // Automatically refresh feedback from DB
    setFeedback(prev => ({
      ...prev,
      status: 'reviewed',
      professorReview: data
    }));
    
    // Show toast notification
    showNotification('Feedback Reviewed', data.message, 'success');
  };

  const handleStudentResponded = (data) => {
    console.log('Student responded:', data);
    // Update feedback with new response
    setFeedback(prev => ({
      ...prev,
      status: 'awaiting_response'
    }));
  };

  // Hook automatically sets up listeners
  useFeedbackUpdates(feedbackId, handleFeedbackReviewed, handleStudentResponded);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="feedback-viewer">
      <h2>Feedback for {feedback.courseKey}</h2>
      <p>Status: {feedback.status}</p>
      {feedback.professorReview?.manualFeedback && (
        <div className="professor-feedback">
          <h3>Professor Feedback</h3>
          <p>{feedback.professorReview.manualFeedback}</p>
        </div>
      )}
      {/* More UI ... */}
    </div>
  );
}
```

### Example 2: Notification Center with Real-Time Updates

```javascript
// frontend/src/components/NotificationCenter.jsx
import { useNotifications } from '../hooks/useWebSocket';
import { useState } from 'react';
import axios from 'axios';

export function NotificationCenter() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const handleNewNotification = (data) => {
    console.log('New notification received:', data);
    
    // Add to list
    setNotifications(prev => [data, ...prev]);
    
    // Update unread count
    setUnreadCount(prev => prev + 1);
    
    // Show toast
    showToast(data.title, data.message, data.priority);
  };

  // Real-time notifications via WebSocket
  useNotifications(handleNewNotification);

  // Fetch existing notifications on mount
  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(
        'http://localhost:5000/api/notifications?limit=20',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setNotifications(res.data.notifications);
      setUnreadCount(res.data.unreadCount || 0);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  const markAsRead = async (notificationId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `http://localhost:5000/api/notifications/${notificationId}/read`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      // Update local state
      setNotifications(prev =>
        prev.map(n => n._id === notificationId ? { ...n, read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  };

  return (
    <div className="notification-center">
      <h2>Notifications {unreadCount > 0 && <span className="badge">{unreadCount}</span>}</h2>
      
      <div className="notification-list">
        {notifications.map(notif => (
          <div
            key={notif._id}
            className={`notification-item ${notif.read ? 'read' : 'unread'}`}
            onClick={() => markAsRead(notif._id)}
          >
            <div className="notification-content">
              <h4>{notif.title}</h4>
              <p>{notif.message}</p>
              <small>{new Date(notif.createdAt).toLocaleString()}</small>
            </div>
            <span className={`priority priority-${notif.priority}`}>
              {notif.priority}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Example 3: Real-Time Course Chat

```javascript
// frontend/src/components/Chatbot.jsx
import { useCourseChat } from '../hooks/useWebSocket';
import { useState } from 'react';

export function Chatbot() {
  const courseKey = 'CS501'; // From props or context
  const { messages, sendMessage, sendTyping, sendStopTyping } = useCourseChat(courseKey);
  const [input, setInput] = useState('');
  const typingTimeoutRef = useRef(null);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    
    // Send typing indicator
    sendTyping();
    
    // Debounce stop typing
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendStopTyping();
    }, 1000);
  };

  const handleSendMessage = () => {
    if (!input.trim()) return;
    
    // Send via WebSocket (real-time)
    sendMessage(input);
    
    // Clear input
    setInput('');
    sendStopTyping();
  };

  return (
    <div className="chatbot">
      <div className="message-list">
        {messages.map((msg, idx) => (
          <div key={idx} className="message">
            <strong>{msg.senderId}</strong>: {msg.message}
          </div>
        ))}
      </div>

      <div className="input-area">
        <input
          value={input}
          onChange={handleInputChange}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="Type a message..."
        />
        <button onClick={handleSendMessage}>Send</button>
      </div>
    </div>
  );
}
```

---

## REST API Usage Examples

### Get Notifications
```javascript
// frontend/src/api/notificationAPI.js
import axios from 'axios';

const API_URL = 'http://localhost:5000/api/notifications';

export const getNotifications = async (limit = 50, page = 1, filter = {}) => {
  const token = localStorage.getItem('token');
  const response = await axios.get(API_URL, {
    params: { limit, page, ...filter },
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

export const markAsRead = async (notificationId) => {
  const token = localStorage.getItem('token');
  const response = await axios.patch(
    `${API_URL}/${notificationId}/read`,
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data;
};

export const getUnreadCount = async () => {
  const token = localStorage.getItem('token');
  const response = await axios.get(`${API_URL}/unread/count`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};
```

### Submit Feedback Response
```javascript
// Combine REST API + WebSocket
const submitFeedbackResponse = async (feedbackId, message, isQuestion = false) => {
  const token = localStorage.getItem('token');
  
  // Issue: REST API call
  const response = await axios.post(
    `http://localhost:5000/api/feedback/${feedbackId}/response`,
    { message, isQuestion },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  
  // Real-time notification is sent automatically via WebSocket
  // (already implemented in addStudentResponse controller)
  
  return response.data;
};
```

---

## Architecture Flow

### Real-Time Feedback Review Flow
```
1. Professor reviews evaluation in UI
2. Clicks "Submit Feedback" button
3. Frontend sends REST API POST /api/feedback/evaluations/:id/feedback
4. Backend controller adds feedback to DB
5. Controller calls notifyFeedbackReviewed() utility
6. Utility:
   - Creates notification in DB
   - Emits WebSocket event to student
7. Student's browser receives WebSocket event
8. useFeedbackUpdates hook triggers callback
9. UI updates in real-time
10. Student can also REST API GET /api/notifications to see notification
```

### Architecture Diagram
```
Frontend (React)
    │
    ├─── REST API ────────────────────┐
    │   (When needed)                 │
    │                                 │
    └─── WebSocket (Socket.io)        │
        (Real-time events)            │
                                      │
                                      ▼
                            Backend (Express)
                                │
                                ├─── Controller Logic
                                │
                                ├─── DB Operation
                                │   (Create/Update)
                                │
                                └─── Notification Utility
                                    ├─ Save to DB
                                    └─ Emit WebSocket
                                        │
                                        └──→ Target User/Room
                                            │
                                            └──→ Frontend (WebSocket)
                                                │
                                                └──→ React Hook
                                                    │
                                                    └──→ Component Update
```

---

## Testing the Implementation

### 1. Test WebSocket Connection
```bash
# In browser console
const socket = io('http://localhost:5000', {
  auth: { token: localStorage.getItem('token') }
});

socket.on('connect', () => console.log('✅ Connected'));
socket.on('notification', (data) => console.log('📬 Notification:', data));
```

### 2. Test REST API
```bash
# Get notifications
curl -H "Authorization: Bearer <token>" http://localhost:5000/api/notifications

# Mark as read
curl -X PATCH -H "Authorization: Bearer <token>" http://localhost:5000/api/notifications/<id>/read
```

### 3. Trigger Real Events
- Professor reviews evaluation in UI → Student gets real-time notification
- Student responds to feedback → Professor gets real-time notification
- Professor uploads material → All students get real-time notification

---

## Performance Considerations

1. **WebSocket Memory**: Keep active connections minimal
2. **Notification DB**: Index on recipient+read for fast queries
3. **Message Broadcasting**: Use room filtering to avoid broadcast to all users
4. **Event Debouncing**: Debounce typing indicators (500ms-1s)
5. **Cleanup**: Automatically disconnect unused sockets

---

## Troubleshooting

### WebSocket not connecting?
```javascript
// Check auth token
const token = localStorage.getItem('token');
console.log('Token exists:', !!token);

// Check server logs for auth errors
// Backend should log: "User <userId> connected"
```

### Notifications not saving?
```javascript
// Check notification model is imported correctly
// Verify MongoDB connection
// Check user IDs are valid ObjectIds
```

### Real-time updates not showing?
```javascript
// Verify hook is called with correct feedbackId
// Check console for any errors
// Verify socket.io connection active
```

---

## Next Steps

1. **Add notification UI component** to StudentDashboard
2. **Add notification badge** to navbar with count
3. **Add toast notifications** for instant feedback
4. **Add notification settings** (per user preferences)
5. **Add email notifications** (optional, via Node mailer)


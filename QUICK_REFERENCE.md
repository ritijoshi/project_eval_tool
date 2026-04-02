# WebSocket & REST API Implementation - Quick Reference

## 🎯 What Was Implemented

### Architecture Upgrade
✅ **WebSocket Server** (Socket.io) added for real-time updates
✅ **REST APIs** for all modules with full CRUD operations
✅ **Notification System** with database persistence
✅ **Real-time Event Broadcasting** to targeted users/rooms
✅ **JWT Authentication** for WebSocket connections

---

## 📁 Files Created

### Backend

```
backend/
├── config/
│   └── socket.js                          # WebSocket server setup & event handlers
├── models/
│   └── Notification.js                    # Notification MongoDB schema
├── controllers/
│   └── notificationController.js          # REST API logic for notifications
├── routes/
│   └── notifications.js                   # Notification endpoints
└── utils/
    └── notificationUtils.js               # Helper functions for notifications
```

### Frontend

```
frontend/
└── src/
    └── hooks/
        └── useWebSocket.js                # React hooks for WebSocket
                                           # - useWebSocket (main)
                                           # - useFeedbackUpdates
                                           # - useNotifications
                                           # - useCourseChat
                                           # - usePresence
```

### Documentation

```
project_root/
├── API_ARCHITECTURE.md                    # Comprehensive API documentation
└── WEBSOCKET_IMPLEMENTATION_GUIDE.md      # Step-by-step implementation guide
```

---

## 🔌 WebSocket Events Reference

### Real-Time Chat
```javascript
// Send message
emit('chat-message', { courseKey, message, recipientId })

// Listen for messages
on('chat-message', (data) => { /* { senderId, message, timestamp } */ })

// Join/Leave course
emit('join-course', 'CS501')
emit('leave-course', 'CS501')
```

### Feedback Notifications
```javascript
// Real-time feedback review
on('feedback-reviewed', (data) => { /* { feedbackId, courseKey, professorName } */ })

// Real-time student response
on('student-responded', (data) => { /* { feedbackId, studentName, messageType } */ })
```

### Evaluations
```javascript
// Evaluation complete
on('evaluation-completed', (data) => { /* { evaluationId, courseKey, score } */ })
```

### Presence
```javascript
on('user-online', (data) => { /* { userId, timestamp } */ })
on('user-offline', (data) => { /* { userId, timestamp } */ })
on('active-users', (data) => { /* { users: [ids...], courseKey } */ })
```

---

## 🔗 REST API Endpoints Added

### Notifications (/api/notifications)
```
GET    /                           # Get all notifications (paginated)
GET    /unread/count              # Get unread count
GET    /:id                        # Get single notification
PATCH  /:id/read                  # Mark as read
PATCH  /read/all                  # Mark all as read
DELETE /:id                        # Delete notification
DELETE /clear/old                 # Clear read notifications >30 days
```

### Feedback (Enhanced)
```
POST   /evaluations/:id/feedback   # Professor adds feedback + WebSocket emit
POST   /:id/response              # Student responds + WebSocket emit
```

---

## 🎨 React Component Integration Examples

### Listen to Feedback Updates
```javascript
import { useFeedbackUpdates } from '../hooks/useWebSocket';

export function FeedbackViewer({ feedbackId }) {
  useFeedbackUpdates(
    feedbackId,
    (data) => { /* Handle feedback reviewed */ },
    (data) => { /* Handle student response */ }
  );
  // Component automatically updates when events received
}
```

### Listen to Notifications
```javascript
import { useNotifications } from '../hooks/useWebSocket';

export function NotificationCenter() {
  useNotifications((data) => {
    // Handle notification: feedback_reviewed, chat_message, etc.
  });
}
```

### Real-time Course Chat
```javascript
import { useCourseChat } from '../hooks/useWebSocket';

export function Chatbot() {
  const { messages, sendMessage } = useCourseChat('CS501');
  
  const handleSend = (msg) => sendMessage(msg);
  // Messages appear in real-time
}
```

---

## 📊 Database Schemas

### Notification Collection
```javascript
{
  _id: ObjectId,
  recipient: ObjectId (indexed),
  sender: ObjectId (optional),
  type: 'feedback_reviewed' | 'chat_message' | ...,
  title: String,
  message: String,
  read: Boolean (indexed),
  priority: 'low' | 'medium' | 'high',
  resourceType: 'feedback' | 'chat' | 'evaluation' | ...,
  resourceId: String,
  actionUrl: String (optional),
  createdAt: Date (indexed),
  updatedAt: Date
}

// Indexes:
// { recipient: 1, read: 1 }
// { recipient: 1, createdAt: -1 }
```

---

## 🚀 How to Use

### In Backend Controllers
```javascript
const { notifyFeedbackReviewed } = require('../utils/notificationUtils');

const addProfessorFeedback = async (req, res) => {
  const io = req.app.get('io');
  
  // ... your logic ...
  
  // Send real-time notification
  await notifyFeedbackReviewed(
    io,
    studentId,
    professorId,
    feedbackId,
    courseKey,
    professorName
  );
};
```

### In Frontend Hooks
```javascript
const { on, emit } = useWebSocket();

// Listen to events
on('feedback-reviewed', (data) => {
  console.log('Feedback reviewed:', data);
  // Update UI
});

// Emit events
emit('chat-message', { courseKey: 'CS501', message: 'Hello' });
```

---

## ⚙️ Configuration

### Backend .env
```
PORT=5000
MONGODB_URI=your_mongodb_uri
JWT_SECRET=your_secret_key
FRONTEND_URL=http://localhost:5173
```

### Frontend .env
```
REACT_APP_API_URL=http://localhost:5000
REACT_APP_SOCKET_URL=http://localhost:5000
```

---

## 📦 Dependencies Added

### Backend
```json
{
  "socket.io": "^4.7.2"
}
```

### Frontend
```json
{
  "socket.io-client": "^4.7.2"
}
```

---

## 🔐 Security

- ✅ JWT authentication on WebSocket connection
- ✅ Authorization checks on all REST endpoints
- ✅ User-scoped room membership
- ✅ No broadcast to all users (room-based only)
- ✅ Database indexes for performance
- ✅ CORS configured for frontend domain

---

## 📈 Scalability

- ✅ Room-based message delivery (O(n) of room members only)
- ✅ Indexed database queries (O(log n) lookups)
- ✅ Async notification creation (non-blocking)
- ✅ Ready for Redis adapter (multi-server)
- ✅ Connection pooling support

---

## ✅ Testing Checklist

- [ ] Install dependencies: `npm install` (both frontend and backend)
- [ ] Start backend: `npm run dev` in backend folder
- [ ] Start frontend: `npm run dev` in frontend folder
- [ ] Test WebSocket connection in browser DevTools
- [ ] Test REST APIs with Postman/curl
- [ ] Test real-time feedback notifications
- [ ] Test real-time chat messages
- [ ] Test notification persistence in DB

---

## 🎯 Next Steps

1. **Add Notification UI**
   - Notification bell icon with unread count
   - Notification dropdown/panel
   - Toast notifications for new events

2. **Add Typing Indicators**
   - Show "user is typing..."
   - Hide after 1 second of inactivity

3. **Add Presence Indicators**
   - Green dot for online users
   - Show active users in course

4. **Add Notification Preferences**
   - Per-user notification settings
   - Do Not Disturb mode
   - Channel preferences (push, email, web)

5. **Add Analytics**
   - Real-time dashboard updates
   - Live student activity
   - Performance metrics

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| WebSocket won't connect | Check JWT token in localStorage, verify backend running |
| Notifications not saving | Verify MongoDB connection, check User IDs valid |
| Events not received | Check socket.io connection in DevTools, verify EventName spelling |
| REST API 401 errors | Verify Authorization header has Bearer token |
| Port 5000 in use | Kill process: `npx kill-port 5000` |

---

## 📚 Documentation Files

1. **API_ARCHITECTURE.md** - Complete API reference with all endpoints, events, and examples
2. **WEBSOCKET_IMPLEMENTATION_GUIDE.md** - Step-by-step implementation guide with code examples
3. **This file** - Quick reference guide

---

## 🎓 Key Concepts

### REST APIs
- CRUD operations on resources
- Client initiates request
- Synchronous response
- Best for: Reading data, bulk operations, one-time actions

### WebSockets
- Real-time bidirectional communication
- Server can push updates
- Asynchronous, event-driven
- Best for: Live updates, notifications, collaborative features

### Rooms
- Virtual namespaces for targeted messaging
- `user:userId` - Direct user notifications
- `role:professor` - Role-based broadcasts
- `course:CS501` - Course room for chat/updates

---

## 💡 Usage Pattern

```
1. User performs action in frontend
2. Frontend sends REST API request (or WebSocket event)
3. Backend processes request in controller
4. Controller calls utility function (e.g., notifyFeedbackReviewed)
5. Utility:
   - Saves notification to MongoDB
   - Emits WebSocket event to target room
6. Target user's WebSocket receives event instantly
7. React hook callback fires, updates component
8. UI re-renders with new data
```

---

## 📞 Support

For implementation questions, refer to:
- **API Endpoints**: See API_ARCHITECTURE.md
- **WebSocket Events**: See WEBSOCKET_IMPLEMENTATION_GUIDE.md
- **Code Examples**: In hooks/useWebSocket.js and WEBSOCKET_IMPLEMENTATION_GUIDE.md

---

**Last Updated**: March 26, 2026
**Status**: ✅ Complete and Ready for Integration

# GenAI Agent - Architecture & API Documentation

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                      │
│  - StudentDashboard  - ProfessorDashboard  - Chat  - Feedback UI   │
│  - WebSocket Client  - Real-time Updates    - Notifications        │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP + WebSocket
┌────────────────────────────▼────────────────────────────────────────┐
│                 Backend API (Node.js + Express)                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ REST APIs                                                   │   │
│  │ • /api/auth (Login, Register, Verify)                       │   │
│  │ • /api/student (Evaluation, Learning Path, Leaderboard)     │   │
│  │ • /api/professor (Materials, Analytics, Rubrics)            │   │
│  │ • /api/chat (Course Chat, History)                          │   │
│  │ • /api/feedback (Feedback Management, Reviews, Responses)   │   │
│  │ • /api/notifications (Notifications, Real-time Events)      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ WebSocket (Socket.io)                                       │   │
│  │ • Real-time Chat Messages                                   │   │
│  │ • Feedback Reviews & Responses                              │   │
│  │ • Notifications & Status Updates                            │   │
│  │ • Presence Tracking                                         │   │
│  │ • Typing Indicators                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ MongoDB Driver
┌────────────────────────────▼────────────────────────────────────────┐
│                    MongoDB Atlas Database                            │
│  - Users (Students, Professors)                                     │
│  - Courses & Materials                                              │
│  - Feedback & Evaluations                                           │
│  - Chat Messages & Notifications                                    │
│  - Progress & Analytics                                             │
└────────────────────────────┬────────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
┌────────▼──────────┐ ┌──────▼─────────┐ ┌──────▼────────┐
│  Vector Database  │ │  LLM APIs      │ │  File Storage │
│  (Embeddings)     │ │  (Groq/OpenAI) │ │  (Optional)   │
└───────────────────┘ └────────────────┘ └───────────────┘
```

---

## REST API Endpoints

### Authentication
```
POST   /api/auth/register      - Register new user
POST   /api/auth/login         - Login and get JWT token
POST   /api/auth/logout        - Logout
GET    /api/auth/verify        - Verify token
```

### Student Module
```
GET    /api/student/learning-path           - Get personalized learning path
GET    /api/student/leaderboard             - Get student leaderboard
POST   /api/student/submit-proposal         - Submit project proposal
POST   /api/student/evaluate                - Evaluate text submission
POST   /api/student/evaluate-files          - Evaluate file-based submission
POST   /api/student/personalization-inputs  - Update learning preferences
GET    /api/student/courses                 - List student courses
POST   /api/student/course-chat             - Course-aware AI chat
GET    /api/student/chat-history            - Get saved chat history
DELETE /api/student/chat-history            - Clear chat history
```

### Professor Module
```
POST   /api/professor/materials             - Upload course materials
POST   /api/professor/rubrics               - Define rubric criteria
POST   /api/professor/weekly-updates        - Send weekly updates
GET    /api/professor/analytics             - Get class analytics
GET    /api/professor/courses               - List professor's courses
```

### Chat Module
```
POST   /api/chat/send-message    - Save chat message
GET    /api/chat/history         - Get chat history
DELETE /api/chat/message/:id     - Delete message
```

### Feedback Module
```
GET    /api/feedback                           - Get student's feedback (student only)
GET    /api/feedback/:id                       - Get feedback detail
POST   /api/feedback/:id/response              - Add student response/question
POST   /api/feedback                           - Create feedback from evaluation
GET    /api/feedback/evaluations               - Get evaluations (professor only)
GET    /api/feedback/evaluations/:id           - Get evaluation detail (professor only)
POST   /api/feedback/evaluations/:id/feedback  - Add professor feedback & score adjustment
PATCH  /api/feedback/:id/mark-read            - Mark feedback as read
DELETE /api/feedback/:id                       - Delete feedback
```

### Notifications Module
```
GET    /api/notifications                 - Get all notifications (paginated)
GET    /api/notifications/unread/count    - Get unread notification count
GET    /api/notifications/:id             - Get notification by ID
PATCH  /api/notifications/:id/read        - Mark notification as read
PATCH  /api/notifications/read/all        - Mark all as read
DELETE /api/notifications/:id             - Delete notification
DELETE /api/notifications/clear/old       - Clear old notifications (>30 days, read only)
```

---

## WebSocket Events

### Connection
```javascript
// Client connects with JWT token
io('http://localhost:5000', {
  auth: { token: 'jwt_token_here' }
})
```

### Real-Time Chat Messages
```javascript
// Emit message to course
emit('chat-message', {
  courseKey: 'CS501',
  message: 'Hello everyone',
  recipientId: 'optional_user_id'
})

// Listen for new messages
on('chat-message', (data) => {
  // { senderId, message, courseKey, timestamp }
})

// Typing indicators
emit('typing', { courseKey: 'CS501' })
emit('stop-typing', { courseKey: 'CS501' })

on('user-typing', (data) => {
  // { userId }
})

on('user-stop-typing', (data) => {
  // { userId }
})
```

### Course Rooms
```javascript
// Join course room
emit('join-course', 'CS501')

// Leave course room
emit('leave-course', 'CS501')

// Get active users in course
emit('request-active-users', 'CS501')

on('active-users', (data) => {
  // { users: [userId1, userId2, ...], courseKey }
})
```

### Feedback Events
```javascript
// Professor reviews evaluation and sends notification
emit('feedback-reviewed', {
  feedbackId: 'feedback_id_here',
  studentId: 'student_id',
  professorName: 'Prof. Smith'
  // Automatically creates notification for student
})

// Listen on student side
on('feedback-reviewed', (data) => {
  // { feedbackId, courseKey, professorName, message }
})

// Student responds to feedback
emit('student-responded', {
  feedbackId: 'feedback_id_here',
  professorId: 'professor_id',
  studentName: 'John Doe'
  // Automatically creates notification for professor
})

// Listen on professor side
on('student-responded', (data) => {
  // { feedbackId, courseKey, studentName, messageType, message }
})
```

### Evaluation Events
```javascript
// Evaluate completion triggers notification
emit('evaluation-completed', {
  evaluationId: 'eval_id',
  studentId: 'student_id',
  courseKey: 'CS501',
  score: 87.5
})

// Listen on student side
on('evaluation-completed', (data) => {
  // { evaluationId, courseKey, score, message }
})
```

### General Notifications
```javascript
// Send notification to specific user
emit('send-notification', {
  recipientId: 'user_id',
  type: 'chat_message|feedback_reviewed|evaluation_ready|course_update|other',
  title: 'Notification Title',
  message: 'Notification message',
  priority: 'low|medium|high'
})

// Listen for notifications
on('notification', (data) => {
  // { type, title, message, priority, resourceType, resourceId }
})
```

### Broadcast Events
```javascript
// Broadcast to all professors
emit('broadcast-to-professors', {
  title: 'Important Update',
  message: 'System maintenance scheduled',
  priority: 'high'
})

on('admin-announcement', (data) => {
  // { title, message, priority, timestamp }
})
```

### Presence Events
```javascript
// Listen for users coming online
on('user-online', (data) => {
  // { userId, timestamp }
})

// Listen for users going offline
on('user-offline', (data) => {
  // { userId, timestamp }
})
```

### User Events
```javascript
// Listen for user joining course
on('user-joined', (data) => {
  // { userId, courseKey }
})

// Listen for user leaving course
on('user-left', (data) => {
  // { userId, courseKey }
})
```

---

## Data Models

### User
```javascript
{
  _id: ObjectId,
  email: String (unique),
  name: String,
  avatar: String (optional),
  role: 'student' | 'professor' | 'admin',
  password: String (hashed),
  courses: [CourseRef],
  preferences: Object,
  createdAt: Date,
  updatedAt: Date
}
```

### Feedback
```javascript
{
  _id: ObjectId,
  evaluationId: String,
  student: UserRef,
  professor: UserRef,
  courseKey: String,
  status: 'pending' | 'reviewed' | 'awaiting_response' | 'resolved',
  aiEvaluation: {
    score: Number,
    feedback: String,
    details: Object,
    rubric: Object
  },
  professorReview: {
    reviewed: Boolean,
    manualFeedback: String,
    scoreAdjustment: Number (-50 to +50),
    timestamp: Date
  },
  studentResponses: [{
    message: String,
    isQuestion: Boolean,
    timestamp: Date
  }],
  submissionContent: {
    text: String,
    files: [FileRef]
  },
  createdAt: Date,
  updatedAt: Date
}
```

### Notification
```javascript
{
  _id: ObjectId,
  recipient: UserRef,
  sender: UserRef (optional),
  type: 'feedback_reviewed' | 'feedback_response' | 'chat_message' | 
         'evaluation_ready' | 'course_update' | 'material_uploaded' | 'general',
  title: String,
  message: String,
  resourceType: 'feedback' | 'chat' | 'evaluation' | 'course' | 'material',
  resourceId: String,
  read: Boolean,
  actionUrl: String (optional),
  priority: 'low' | 'medium' | 'high',
  createdAt: Date,
  updatedAt: Date
}
```

---

## Frontend Integration Examples

### Using WebSocket Hooks

#### Listen to Feedback Updates
```javascript
import { useFeedbackUpdates } from '../hooks/useWebSocket';

export function FeedbackViewer({ feedbackId }) {
  const [feedback, setFeedback] = useState(null);

  const handleFeedbackReviewed = (data) => {
    console.log('Feedback reviewed:', data);
    // Refresh feedback data
    fetchFeedback(feedbackId);
  };

  const handleStudentResponded = (data) => {
    console.log('Student responded:', data);
    // Refresh feedback data
    fetchFeedback(feedbackId);
  };

  useFeedbackUpdates(feedbackId, handleFeedbackReviewed, handleStudentResponded);

  return (
    // Feedback UI
  );
}
```

#### Listen to Notifications
```javascript
import { useNotifications } from '../hooks/useWebSocket';

export function NotificationCenter() {
  const [notifications, setNotifications] = useState([]);

  const handleNotification = (data) => {
    setNotifications(prev => [data, ...prev]);
    // Show toast or notification UI
  };

  useNotifications(handleNotification);

  return (
    // Notifications UI
  );
}
```

#### Real-time Course Chat
```javascript
import { useCourseChat } from '../hooks/useWebSocket';

export function Chatbot() {
  const { messages, sendMessage, sendTyping, sendStopTyping } = useCourseChat('CS501');

  const handleSendMessage = (message) => {
    sendMessage(message);
  };

  const handleInputChange = () => {
    sendTyping();
    // debounced sendStopTyping()
  };

  return (
    // Chat UI
  );
}
```

---

## API Response Format

### Success Response
```javascript
{
  message: "Operation successful",
  data: { /* response data */ },
  status: 200
}
```

### Error Response
```javascript
{
  error: "Error description",
  message: "User-friendly message",
  status: 400|401|403|404|500
}
```

---

## Authentication

All protected endpoints require JWT token in Authorization header:
```
Authorization: Bearer <jwt_token>
```

Token includes:
- `user_id` - User MongoDB ID
- `email` - User email
- `role` - User role (student/professor/admin)
- `iat` - Issued at
- `exp` - Expiration (24 hours)

---

## WebSocket Rooms

Automatic room membership:
- `user:<userId>` - User's personal room for direct notifications
- `role:<role>` - All users with this role
- `course:<courseKey>` - All users in this course

---

## Environment Setup

### Backend (.env)
```
PORT=5000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_jwt_secret
FRONTEND_URL=http://localhost:5173
GROQ_API_KEY=your_groq_key
OPENAI_API_KEY=your_openai_key
```

### Frontend (.env)
```
REACT_APP_API_URL=http://localhost:5000
REACT_APP_SOCKET_URL=http://localhost:5000
```

---

## Performance & Best Practices

1. **WebSocket Connection**: One per client, reused across app
2. **Authentication**: Token verified on each WebSocket connection
3. **Scalability**: Use Socket.io adapters for multi-server setup
4. **Notifications**: Async, non-blocking, stored in DB
5. **Chat**: In-memory or Redis for high-frequency messages
6. **Feedback**: Indexed queries for professor bulk operations

---

## Testing

### Test WebSocket Connection
```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Test with socket.io-client
node -e "
const { io } = require('socket.io-client');
const socket = io('http://localhost:5000', {
  auth: { token: 'test_token' }
});
socket.on('connect', () => console.log('Connected!'));
socket.emit('join-course', 'CS501');
"
```

### Test REST APIs
```bash
# Get learning path
curl -H "Authorization: Bearer <token>" http://localhost:5000/api/student/learning-path

# Get notifications
curl -H "Authorization: Bearer <token>" http://localhost:5000/api/notifications?limit=10

# Get evaluations
curl -H "Authorization: Bearer <token>" http://localhost:5000/api/feedback/evaluations
```

---

## Deployment

### Server
- Use `process.manager` (PM2) for production
- Enable CORS for frontend domain
- Use Redis adapter for Socket.io scaling
- Add rate limiting on REST endpoints

### Database
- MongoDB Atlas with connection pooling
- Enable encryption at rest
- Regular backups

### Frontend
- Build with `npm run build`
- Deploy to Vercel/Netlify
- Set REACT_APP_API_URL to production backend

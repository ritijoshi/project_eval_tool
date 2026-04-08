const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const { initializeSocket } = require('./config/socket');
const http = require('http');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { getAllowedOrigins } = require('./config/services');
const path = require('path');
const { startAnnouncementScheduler } = require('./jobs/announcementScheduler');

dotenv.config();

// Connect to database
connectDB();

const app = express();
const server = http.createServer(app);
const allowedOrigins = getAllowedOrigins();

// Initialize WebSocket
const io = initializeSocket(server);
app.set('io', io);

// Middleware
app.use(helmet());
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error('CORS origin not allowed'));
        },
        credentials: true,
    })
);
app.use(express.json({ limit: '2mb' }));
// Allow the frontend (different origin/port) to load uploaded attachments (audio/image/docs).
// Helmet sets Cross-Origin-Resource-Policy: same-origin by default, which will block these.
app.use('/uploads', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(requestLogger);

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX || 300),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' },
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many auth attempts. Please try again later.' },
});

app.use('/api', globalLimiter);
app.use('/api/auth', authLimiter);

// Basic route
app.get('/', (req, res) => {
    res.send('Virtual Classroom API is running...');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'backend',
        timestamp: new Date().toISOString(),
    });
});

app.get('/ready', async (req, res) => {
    const dbReady = connectDB.getDbHealth();
    const aiReady = await connectDB.checkAiHealth();

    const ready = dbReady.connected && aiReady.connected;
    return res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'degraded',
        dependencies: {
            database: dbReady,
            aiService: aiReady,
        },
        timestamp: new Date().toISOString(),
    });
});

// Use Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/professor', require('./routes/professor'));
app.use('/api/student', require('./routes/student'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/user', require('./routes/user'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api', require('./routes/tests'));
app.use('/api', require('./routes/progress'));

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

startAnnouncementScheduler(app, { intervalMs: process.env.ANNOUNCEMENT_SCHEDULER_MS });

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket ready for connections`);
});

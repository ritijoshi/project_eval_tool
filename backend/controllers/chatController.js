const axios = require('axios');
const ChatHistory = require('../models/ChatHistory');
const Notification = require('../models/Notification');
const { addInteraction } = require('../utils/studentProfileStore');
const { getAiServiceUrl } = require('../config/services');
const { resolveCourseCode } = require('../utils/courseContext');

const AI_BASE = getAiServiceUrl();

const handleChat = async (req, res) => {
    const { message, history, student_level, course_key, course_id } = req.body;
    const userId = req.user?._id || 'anonymous';
    let resolvedCourseKey = course_key;
    if (!resolvedCourseKey && course_id) {
        resolvedCourseKey = await resolveCourseCode(course_id);
    }
    const normalizedCourseKey = String(resolvedCourseKey || 'general').trim().toLowerCase() || 'general';
    const trimmedMessage = String(message || '').trim();

    if (!trimmedMessage) {
        return res.status(400).json({ message: 'message is required' });
    }

    let persistedHistory = [];
    try {
        const chatDoc = await ChatHistory.findOne({
            user: userId,
            courseKey: normalizedCourseKey,
        });
        if (chatDoc && Array.isArray(chatDoc.messages)) {
            persistedHistory = chatDoc.messages
                .filter((m) => m && m.text)
                .map((m) => ({ sender: m.sender, text: m.text }));
        }
    } catch (err) {
        console.warn('Failed to fetch chat history from MongoDB:', err.message);
    }

    const incomingHistory = Array.isArray(history)
        ? history
            .filter((m) => m && typeof m.text === 'string')
            .map((m) => ({ sender: m.sender === 'agent' ? 'agent' : 'user', text: String(m.text).trim() }))
            .filter((m) => m.text)
        : [];

    // Prefer persisted memory and append any newer in-memory client history, capped for prompt size.
    const mergedHistory = [...persistedHistory, ...incomingHistory].slice(-40);
    
    try {
        // Forward the chat query and memory context to the Python FastAPI Microservice
        const pythonServiceUrl = resolvedCourseKey
            ? `${AI_BASE}/course/chat`
            : `${AI_BASE}/chat`;

        const payload = resolvedCourseKey
            ? {
                course_key: resolvedCourseKey,
                message: trimmedMessage,
                history: mergedHistory,
                student_level: student_level || 'intermediate',
            }
            : {
                message: trimmedMessage,
                history: mergedHistory,
                student_level: student_level || 'intermediate',
                professor_style:
                    "Focus on practical examples, encourage students to read documentations, and explain concepts step-by-step.",
            };

        const response = await axios.post(pythonServiceUrl, payload);
        let reply = String(response?.data?.reply || '').trim();

        const pendingUpdate = await Notification.findOne({
            recipient: userId,
            type: 'course_update',
            resourceId: normalizedCourseKey,
            read: false,
        })
            .sort({ createdAt: -1 })
            .lean();

        if (pendingUpdate) {
            reply = `Course update: ${pendingUpdate.title}. ${pendingUpdate.message}\n\n${reply}`;
            await Notification.updateOne({ _id: pendingUpdate._id }, { $set: { read: true } });
        }

        try {
            await ChatHistory.updateOne(
                { user: userId, courseKey: normalizedCourseKey },
                {
                    $push: {
                        messages: {
                            $each: [
                                { sender: 'user', text: trimmedMessage, createdAt: new Date() },
                                { sender: 'agent', text: reply, createdAt: new Date() },
                            ],
                        },
                    },
                },
                { upsert: true }
            );
        } catch (err) {
            console.warn('Failed to save chat message to MongoDB:', err.message);
        }

        addInteraction(userId, `Chat (${normalizedCourseKey}): ${trimmedMessage.slice(0, 220)}`);
        
        res.status(200).json({ reply });
    } catch (error) {
        // Fallback if Python service isn't running or Python isn't installed locally
        let fallbackReply = "The AI Microservice (Python) is currently offline. Please ensure Python is installed and the FastAPI server is running.";
        try {
            await ChatHistory.updateOne(
                { user: userId, courseKey: normalizedCourseKey },
                {
                    $push: {
                        messages: {
                            $each: [
                                { sender: 'user', text: trimmedMessage, createdAt: new Date() },
                                { sender: 'agent', text: fallbackReply, createdAt: new Date() },
                            ],
                        },
                    },
                },
                { upsert: true }
            );
        } catch (err) {
            console.warn('Failed to save fallback message to MongoDB:', err.message);
        }

        res.status(200).json({ reply: fallbackReply });
    }
};

const getSavedChatHistory = async (req, res) => {
    try {
        const userId = req.user?._id || 'anonymous';
        const courseKey = String(req.query?.course_key || 'general').trim().toLowerCase() || 'general';
        const chatDoc = await ChatHistory.findOne({
            user: userId,
            courseKey,
        });
        res.status(200).json({ messages: chatDoc?.messages || [] });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const deleteSavedChatHistory = async (req, res) => {
    try {
        const userId = req.user?._id || 'anonymous';
        const courseKey = String(req.query?.course_key || 'general').trim().toLowerCase() || 'general';
        await ChatHistory.updateOne(
            { user: userId, courseKey },
            { $set: { messages: [] } },
            { upsert: true }
        );
        res.status(200).json({ message: 'Chat history cleared.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { handleChat, getSavedChatHistory, deleteSavedChatHistory };

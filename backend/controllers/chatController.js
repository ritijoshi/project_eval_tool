const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const ChatHistory = require('../models/ChatHistory');
const Notification = require('../models/Notification');
const { addInteraction } = require('../utils/studentProfileStore');
const { getAiServiceUrl } = require('../config/services');
const { resolveCourseCode } = require('../utils/courseContext');
const { getCourseByAnyIdentifier, recomputeStudentCourseProgress } = require('../services/progressService');

const AI_BASE = getAiServiceUrl();
const CHAT_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'chat');
const MAX_HISTORY_MESSAGES = 40;

const ensureUploadsDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

const normalizeCourseKey = (value) => String(value || 'general').trim().toLowerCase() || 'general';

const sanitizeFileName = (name) => {
    const safe = String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
    return safe.replace(/^-|-$/g, '') || 'file';
};

const getMessageText = (message) => String(message?.content || message?.text || '').trim();

const normalizeHistory = (messages = []) => messages
    .filter((message) => message && getMessageText(message))
    .map((message) => ({
        sender: message.sender === 'agent' ? 'agent' : 'user',
        text: getMessageText(message),
    }))
    .slice(-MAX_HISTORY_MESSAGES);

const getPendingCourseUpdateReply = async (userId, normalizedCourseKey, reply) => {
    const pendingUpdate = await Notification.findOne({
        recipient: userId,
        type: 'course_update',
        resourceId: normalizedCourseKey,
        read: false,
    })
        .sort({ createdAt: -1 })
        .lean();

    if (!pendingUpdate) {
        return reply;
    }

    await Notification.updateOne({ _id: pendingUpdate._id }, { $set: { read: true } });
    return `Course update: ${pendingUpdate.title}. ${pendingUpdate.message}\n\n${reply}`;
};

const storeConversation = async ({ userId, normalizedCourseKey, userRecord, agentRecord }) => {
    try {
        await ChatHistory.updateOne(
            { user: userId, courseKey: normalizedCourseKey },
            {
                $push: {
                    messages: {
                        $each: [userRecord, agentRecord],
                    },
                },
            },
            { upsert: true }
        );
    } catch (err) {
        console.warn('Failed to save chat message to MongoDB:', err.message);
    }
};

const loadConversationHistory = async ({ userId, normalizedCourseKey, incomingHistory }) => {
    let persistedHistory = [];
    try {
        const chatDoc = await ChatHistory.findOne({
            user: userId,
            courseKey: normalizedCourseKey,
        }).lean();
        persistedHistory = normalizeHistory(chatDoc?.messages || []);
    } catch (err) {
        console.warn('Failed to fetch chat history from MongoDB:', err.message);
    }

    let parsedHistory = incomingHistory;
    if (!Array.isArray(parsedHistory)) {
        try {
            parsedHistory = JSON.parse(String(incomingHistory || '[]'));
        } catch (err) {
            parsedHistory = [];
        }
    }

    const clientHistory = Array.isArray(parsedHistory)
        ? parsedHistory
            .filter((message) => message && typeof message.text === 'string')
            .map((message) => ({
                sender: message.sender === 'agent' ? 'agent' : 'user',
                text: String(message.text).trim(),
            }))
            .filter((message) => message.text)
        : [];

    return [...persistedHistory, ...clientHistory].slice(-MAX_HISTORY_MESSAGES);
};

const saveChatFiles = (files = []) => {
    ensureUploadsDir(CHAT_UPLOAD_DIR);
    return files.map((file) => {
        const safeName = `${Date.now()}-${sanitizeFileName(file.originalname)}`;
        const storedPath = path.join(CHAT_UPLOAD_DIR, safeName);
        fs.writeFileSync(storedPath, file.buffer);

        const kind = file.mimetype.startsWith('image/')
            ? 'image'
            : file.mimetype.startsWith('audio/')
                ? 'voice'
                : 'document';

        return {
            originalName: file.originalname,
            fileName: safeName,
            fileUrl: `/uploads/chat/${safeName}`,
            mimeType: file.mimetype,
            size: file.size,
            kind,
        };
    });
};

const detectMessageType = (mode, storedFiles = []) => {
    if (mode === 'voice') return 'voice';
    if (!storedFiles.length) return 'text';

    const kinds = storedFiles.map((file) => file.kind);
    if (kinds.length > 0 && kinds.every((kind) => kind === 'image')) return 'image';
    return kinds.includes('image') ? 'image' : 'document';
};

const appendAttachmentSummary = (prompt, attachments = []) => {
    if (!attachments.length) return prompt;
    const summary = attachments
        .map((attachment, index) => `${index + 1}. ${attachment.kind.toUpperCase()} - ${attachment.originalName}`)
        .join('\n');
    return `${prompt}\n\nUploaded attachments:\n${summary}`;
};

const callAiService = async ({ endpoint, courseKey, message, history, studentLevel, files = [] }) => {
    const form = new FormData();
    form.append('course_key', courseKey);
    form.append('message', message);
    form.append('student_level', studentLevel || 'intermediate');
    form.append('history', JSON.stringify(history || []));

    files.forEach((file) => {
        form.append('files', file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
        });
    });

    const response = await axios.post(`${AI_BASE}${endpoint}`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 300000,
    });

    return response.data || {};
};

const processMultimodalChat = async ({ req, res, mode, files = [] }) => {
    const userId = req.user?._id || 'anonymous';
    let resolvedCourseKey = req.body?.course_key || req.query?.course_key;
    if (!resolvedCourseKey && req.body?.course_id) {
        resolvedCourseKey = await resolveCourseCode(req.body.course_id);
    }

    const normalizedCourseKey = normalizeCourseKey(resolvedCourseKey || 'general');
    const incomingHistory = req.body?.history;
    const history = await loadConversationHistory({
        userId,
        normalizedCourseKey,
        incomingHistory,
    });

    const storedFiles = files.length > 0 ? saveChatFiles(files) : [];
    const messageText = String(req.body?.message || '').trim();
    const fallbackPrompt = mode === 'voice'
        ? 'Transcribe the attached voice note and answer in course context.'
        : 'Analyze the attached file(s) in course context.';
    const prompt = appendAttachmentSummary(messageText || fallbackPrompt, storedFiles);
    const userRecordText = messageText || prompt;
    const recordType = detectMessageType(mode, storedFiles);

    try {
        const endpoint = mode === 'voice'
            ? '/chat/voice'
            : storedFiles.length > 0
                ? '/chat/upload'
                : '/course/chat';

        const serviceData = storedFiles.length > 0 || mode === 'voice'
            ? await callAiService({
                endpoint,
                courseKey: normalizedCourseKey,
                message: prompt,
                history,
                studentLevel: req.body?.student_level || 'intermediate',
                files,
            })
            : await axios.post(`${AI_BASE}/course/chat`, {
                course_key: normalizedCourseKey,
                message: userRecordText,
                history,
                student_level: req.body?.student_level || 'intermediate',
            }).then((response) => response.data || {});

        let reply = String(serviceData?.reply || '').trim();
        reply = await getPendingCourseUpdateReply(userId, normalizedCourseKey, reply);

        const transcript = String(serviceData?.transcript || '').trim();
        const extractedText = String(serviceData?.extracted_text || '').trim();
        const now = new Date();
        const userRecord = {
            sender: 'user',
            type: recordType,
            text: userRecordText,
            content: transcript || extractedText || userRecordText,
            fileUrl: storedFiles[0]?.fileUrl || '',
            metadata: {
                source: mode,
                files: storedFiles,
                transcript,
                extractedText,
            },
            createdAt: now,
        };
        const agentRecord = {
            sender: 'agent',
            type: 'text',
            text: reply,
            content: reply,
            metadata: {
                courseKey: normalizedCourseKey,
            },
            createdAt: now,
        };

        await storeConversation({
            userId,
            normalizedCourseKey,
            userRecord,
            agentRecord,
        });

        addInteraction(
            userId,
            `${mode === 'voice' ? 'Voice' : storedFiles.length > 0 ? 'Upload' : 'Chat'} (${normalizedCourseKey}): ${userRecordText.slice(0, 220)}`
        );

        if (mongoose.Types.ObjectId.isValid(String(userId))) {
            try {
                const course = await getCourseByAnyIdentifier({ courseKey: normalizedCourseKey });
                if (course?._id) {
                    await recomputeStudentCourseProgress({
                        studentId: userId,
                        courseId: course._id,
                        includeAiInsights: false,
                    });
                }
            } catch (progressErr) {
                console.warn('Progress update failed after chat interaction:', progressErr.message);
            }
        }

        return res.status(200).json({
            reply,
            transcript,
            extracted_text: extractedText,
            attachments: storedFiles,
            message: userRecord,
            response: agentRecord,
        });
    } catch (error) {
        const fallbackReply = 'The AI Microservice (Python) is currently offline. Please ensure Python is installed and the FastAPI server is running.';
        const now = new Date();
        const userRecord = {
            sender: 'user',
            type: recordType,
            text: userRecordText,
            content: userRecordText,
            fileUrl: storedFiles[0]?.fileUrl || '',
            metadata: {
                source: mode,
                files: storedFiles,
            },
            createdAt: now,
        };
        const agentRecord = {
            sender: 'agent',
            type: 'text',
            text: fallbackReply,
            content: fallbackReply,
            metadata: {
                courseKey: normalizedCourseKey,
                fallback: true,
            },
            createdAt: now,
        };

        await storeConversation({
            userId,
            normalizedCourseKey,
            userRecord,
            agentRecord,
        });

        return res.status(200).json({
            reply: fallbackReply,
            transcript: '',
            extracted_text: '',
            attachments: storedFiles,
            message: userRecord,
            response: agentRecord,
        });
    }
};

const handleChat = async (req, res) => processMultimodalChat({
    req,
    res,
    mode: 'text',
});

const handleVoiceChat = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'audio file is required' });
    }

    return processMultimodalChat({
        req,
        res,
        mode: 'voice',
        files: [req.file],
    });
};

const handleUploadChat = async (req, res) => {
    const uploadFiles = Array.isArray(req.files) ? req.files : [];
    if (!uploadFiles.length) {
        return res.status(400).json({ message: 'At least one file is required' });
    }

    return processMultimodalChat({
        req,
        res,
        mode: 'upload',
        files: uploadFiles,
    });
};

const getSavedChatHistory = async (req, res) => {
    try {
        const userId = req.user?._id || 'anonymous';
        const courseKey = normalizeCourseKey(req.query?.course_key || 'general');
        const chatDoc = await ChatHistory.findOne({
            user: userId,
            courseKey,
        }).lean();
        return res.status(200).json({ messages: chatDoc?.messages || [] });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

const deleteSavedChatHistory = async (req, res) => {
    try {
        const userId = req.user?._id || 'anonymous';
        const courseKey = normalizeCourseKey(req.query?.course_key || 'general');
        await ChatHistory.updateOne(
            { user: userId, courseKey },
            { $set: { messages: [] } },
            { upsert: true }
        );
        return res.status(200).json({ message: 'Chat history cleared.' });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

module.exports = {
    handleChat,
    handleVoiceChat,
    handleUploadChat,
    getSavedChatHistory,
    deleteSavedChatHistory,
};

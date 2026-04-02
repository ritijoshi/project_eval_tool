const axios = require('axios');
const FormData = require('form-data');
const Rubric = require('../models/Rubric');
const WeeklyUpdate = require('../models/WeeklyUpdate');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { getAiServiceUrl } = require('../config/services');

const AI_BASE = getAiServiceUrl();

const normalizeCourseKey = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

const parseListInput = (value) => {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }
    return String(value || '')
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
};

const parseCriteria = (criteriaList) => {
    const raw = Array.isArray(criteriaList)
        ? criteriaList
        : String(criteriaList || '')
              .split(/\n+/)
              .map((line) => line.trim())
              .filter(Boolean);

    const criteria = raw
        .map((entry) => {
            if (typeof entry === 'object' && entry) {
                const title = String(entry.title || '').trim();
                const weight = Number(entry.weight || 0);
                const description = String(entry.description || '').trim();
                if (!title) return null;
                return {
                    title,
                    weight: Number.isFinite(weight) && weight > 0 ? weight : 20,
                    description,
                };
            }

            const line = String(entry || '').trim();
            if (!line) return null;
            const match = line.match(/^(.*?)(?:\(?\s*(\d{1,3})\s*%\s*\)?)?$/);
            const title = String(match?.[1] || line).replace(/[:\-\s]+$/, '').trim();
            const weight = Number(match?.[2] || 0);
            if (!title) return null;
            return {
                title,
                weight: Number.isFinite(weight) && weight > 0 ? weight : 20,
                description: '',
            };
        })
        .filter(Boolean);

    if (!criteria.length) {
        return [];
    }

    const total = criteria.reduce((sum, c) => sum + c.weight, 0);
    if (total <= 0) {
        const equal = Math.max(1, Math.floor(100 / criteria.length));
        return criteria.map((c, idx) => ({
            ...c,
            weight: idx === criteria.length - 1 ? Math.max(1, 100 - equal * (criteria.length - 1)) : equal,
        }));
    }

    let running = 0;
    return criteria.map((c, idx) => {
        if (idx === criteria.length - 1) {
            return { ...c, weight: Math.max(1, 100 - running) };
        }
        const normalized = Math.max(1, Math.round((c.weight / total) * 100));
        running += normalized;
        return { ...c, weight: normalized };
    });
};

const uploadMaterial = async (req, res) => {
    try {
        const files = req.files || [];
        const { course_key, teaching_style } = req.body;

        if (!course_key || String(course_key).trim().length < 2) {
            return res.status(400).json({ message: 'course_key is required' });
        }

        if (!files.length) {
            return res.status(400).json({ message: 'At least one file must be uploaded' });
        }

        const pythonServiceUrl = `${AI_BASE}/course/upload`;

        const form = new FormData();
        form.append('course_key', String(course_key));
        form.append('teaching_style', String(teaching_style || ''));

        files.forEach((file) => {
            form.append('files', file.buffer, {
                filename: file.originalname,
                contentType: file.mimetype,
            });
        });

        const response = await axios.post(pythonServiceUrl, form, {
            headers: form.getHeaders(),
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });

        return res.status(201).json(response.data);
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Upload failed' });
    }
};

const defineRubric = async (req, res) => {
    try {
        const professorId = req.user?._id;
        const { name, course_key, maxScore = 100, criteriaList } = req.body || {};

        if (!professorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const courseKey = normalizeCourseKey(course_key);
        if (!courseKey) {
            return res.status(400).json({ message: 'course_key is required' });
        }

        if (!String(name || '').trim()) {
            return res.status(400).json({ message: 'Rubric name is required' });
        }

        const criteria = parseCriteria(criteriaList);
        if (!criteria.length) {
            return res.status(400).json({ message: 'At least one valid criterion is required' });
        }

        const rubric = await Rubric.create({
            professor: professorId,
            courseKey,
            name: String(name).trim(),
            criteria,
            maxScore: Number(maxScore) || 100,
            isActive: true,
        });

        res.status(201).json({
            message: 'Rubric saved successfully.',
            rubric,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const sendWeeklyUpdate = async (req, res) => {
    try {
        const professorId = req.user?._id;
        const io = req.app.get('io');
        const {
            course_key,
            week_label,
            new_topics,
            announcements,
            revised_expectations,
            update_text,
        } = req.body || {};

        if (!professorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const courseKey = normalizeCourseKey(course_key);
        if (!courseKey) {
            return res.status(400).json({ message: 'course_key is required' });
        }

        const parsedTopics = parseListInput(new_topics);
        const parsedAnnouncements = parseListInput(announcements);
        const parsedExpectations = parseListInput(revised_expectations);
        const freeText = String(update_text || '').trim();

        if (!parsedTopics.length && !parsedAnnouncements.length && !parsedExpectations.length && !freeText) {
            return res.status(400).json({ message: 'Provide at least one weekly update item' });
        }

        let aiIngestion = { chunks_added: 0, faiss_enabled: false };
        let embedded = false;
        try {
            const response = await axios.post(`${AI_BASE}/course/weekly-update`, {
                course_key: courseKey,
                week_label: String(week_label || 'Weekly Update').trim(),
                new_topics: parsedTopics,
                announcements: parsedAnnouncements,
                revised_expectations: parsedExpectations,
                update_text: freeText,
            });
            aiIngestion = response.data || aiIngestion;
            embedded = true;
        } catch (err) {
            embedded = false;
        }

        const weeklyUpdate = await WeeklyUpdate.create({
            professor: professorId,
            courseKey,
            weekLabel: String(week_label || 'Weekly Update').trim(),
            newTopics: parsedTopics,
            announcements: parsedAnnouncements,
            revisedExpectations: parsedExpectations,
            updateText: freeText,
            embedded,
            chunksAdded: Number(aiIngestion?.chunks_added || 0),
        });

        const students = await User.find({ role: 'student' }).select('_id name').lean();
        if (students.length) {
            const title = `${courseKey.toUpperCase()} weekly update published`;
            const message = parsedAnnouncements[0]
                ? parsedAnnouncements[0]
                : parsedTopics[0]
                ? `New topic this week: ${parsedTopics[0]}`
                : 'Your course has new weekly updates from faculty.';

            await Notification.insertMany(
                students.map((student) => ({
                    recipient: student._id,
                    sender: professorId,
                    type: 'course_update',
                    title,
                    message,
                    resourceType: 'course',
                    resourceId: courseKey,
                    priority: 'medium',
                }))
            );

            if (io) {
                students.forEach((student) => {
                    io.to(`user:${student._id}`).emit('course-update', {
                        courseKey,
                        title,
                        message,
                        weekLabel: weeklyUpdate.weekLabel,
                        updateId: weeklyUpdate._id,
                    });
                });
            }
        }

        res.status(201).json({
            message: embedded
                ? 'Weekly update ingested and published to students.'
                : 'Weekly update saved and published. AI ingestion is currently offline.',
            weeklyUpdate,
            ingestion: {
                embedded,
                chunksAdded: Number(aiIngestion?.chunks_added || 0),
                faissEnabled: Boolean(aiIngestion?.faiss_enabled),
            },
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getRubrics = async (req, res) => {
    try {
        const professorId = req.user?._id;
        const { course_key = 'all' } = req.query || {};
        if (!professorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const query = { professor: professorId };
        const courseKey = normalizeCourseKey(course_key);
        if (course_key !== 'all' && courseKey) {
            query.courseKey = courseKey;
        }

        const rubrics = await Rubric.find(query).sort({ createdAt: -1 });
        res.status(200).json({ total: rubrics.length, rubrics });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getWeeklyUpdates = async (req, res) => {
    try {
        const professorId = req.user?._id;
        const { course_key = 'all', limit = 20 } = req.query || {};
        if (!professorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const query = { professor: professorId };
        const courseKey = normalizeCourseKey(course_key);
        if (course_key !== 'all' && courseKey) {
            query.courseKey = courseKey;
        }

        const updates = await WeeklyUpdate.find(query)
            .sort({ createdAt: -1 })
            .limit(Math.max(1, Math.min(100, Number(limit) || 20)));

        res.status(200).json({ total: updates.length, updates });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getAnalytics = async (req, res) => {
    try {
        const { studentProfileStore } = require('../utils/studentProfileStore');
        const { getProfile } = require('../utils/studentProfileStore');
        
        // In a real app, this would query the database
        // For now, we'll create mock data based on the studentProfileStore pattern
        const allStudents = [];
        const topicScoreMap = {};
        const topicWeakCountMap = {};
        let totalScore = 0;
        let scoredCount = 0;
        
        // Simulate aggregate student data from profiles
        // In production, query actual student collection from DB
        const mockStudents = [
            { id: 'S001', name: 'Alice Johnson' },
            { id: 'S002', name: 'Bob Smith' },
            { id: 'S003', name: 'Carol White' },
            { id: 'S004', name: 'David Lee' },
            { id: 'S005', name: 'Emma Davis' },
        ];
        
        mockStudents.forEach((student) => {
            try {
                const profile = getProfile(student.id);
                const scores = Object.values(profile.quiz_scores || {});
                const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 55;
                const weakAreas = profile.weak_topics || [];
                const interactions = profile.recent_interactions || [];
                
                allStudents.push({
                    id: student.id,
                    name: student.name,
                    score: avgScore,
                    progress: Math.min(100, Math.max(20, avgScore + Math.random() * 15)),
                    weak: weakAreas.length > 0 ? weakAreas[0] : 'None identified',
                    weakAreas: weakAreas,
                    interactionCount: interactions.length,
                    topicScores: profile.quiz_scores || {},
                });
                
                totalScore += avgScore;
                scoredCount++;
                
                // Aggregate topic performance
                Object.entries(profile.quiz_scores || {}).forEach(([topic, score]) => {
                    if (!topicScoreMap[topic]) {
                        topicScoreMap[topic] = { total: 0, count: 0 };
                    }
                    topicScoreMap[topic].total += score;
                    topicScoreMap[topic].count++;
                });
                
                // Count weak topics
                weakAreas.forEach((area) => {
                    topicWeakCountMap[area] = (topicWeakCountMap[area] || 0) + 1;
                });
            } catch (e) {
                // Skip on error
            }
        });
        
        const avgScore = scoredCount > 0 ? Math.round(totalScore / scoredCount) : 0;
        
        // Build progress trend (simulated weekly data)
        const progressTrend = [
            { week: 'Week 1', progress: 45 },
            { week: 'Week 2', progress: 52 },
            { week: 'Week 3', progress: 58 },
            { week: 'Week 4', progress: 63 },
            { week: 'Week 5', progress: 68 },
            { week: 'Week 6', progress: avgScore },
        ];
        
        // Build weak areas breakdown
        const weakAreas = Object.entries(topicWeakCountMap)
            .map(([topic, count]) => ({
                topic: topic.charAt(0).toUpperCase() + topic.slice(1),
                count,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
        
        // Add generics if few weak areas
        if (weakAreas.length < 3) {
            weakAreas.push(
                { topic: 'Advanced Topics', count: Math.ceil(allStudents.length / 3) },
                { topic: 'Debugging', count: Math.ceil(allStudents.length / 4) }
            );
        }
        
        const analyticsData = {
            overview: {
                totalStudents: allStudents.length,
                avgScore: avgScore,
                activeProjects: Math.ceil(allStudents.length * 0.7),
            },
            students: allStudents,
            progressTrend: progressTrend,
            weakAreas: weakAreas,
            topicPerformance: Object.entries(topicScoreMap).map(([topic, data]) => ({
                topic: topic.charAt(0).toUpperCase() + topic.slice(1),
                avgScore: Math.round(data.total / data.count),
                studentCount: data.count,
            })),
        };
        res.status(200).json(analyticsData);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    uploadMaterial,
    defineRubric,
    sendWeeklyUpdate,
    getAnalytics,
    getRubrics,
    getWeeklyUpdates,
};

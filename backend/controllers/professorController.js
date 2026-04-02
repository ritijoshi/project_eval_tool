const axios = require('axios');
const FormData = require('form-data');
const Rubric = require('../models/Rubric');
const WeeklyUpdate = require('../models/WeeklyUpdate');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Course = require('../models/Course');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
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
        return value.map((item) => String(item || '').trim()).filter(Boolean);
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

        return res.status(201).json({
            message: 'Weekly update published.',
            update: weeklyUpdate,
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to publish weekly update' });
    }
};

const getAnalytics = async (req, res) => {
    try {
        const professorId = req.user?._id;
        const { courseId } = req.query || {};

        if (!professorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        let courses = [];
        if (courseId) {
            const course = await Course.findOne({ _id: courseId, professor: professorId }).lean();
            courses = course ? [course] : [];
        } else {
            courses = await Course.find({ professor: professorId }).lean();
        }

        const courseIds = courses.map((course) => course._id);
        if (!courseIds.length) {
            return res.status(200).json({
                overview: { totalStudents: 0, avgScore: 0, activeProjects: 0 },
                students: [],
                progressTrend: [],
                topicPerformance: [],
                weakAreas: [],
            });
        }

        const assignments = await Assignment.find({ course: { $in: courseIds } })
            .select('_id deadline')
            .lean();
        const assignmentIds = assignments.map((assignment) => assignment._id);

        const studentIds = new Set();
        courses.forEach((course) => {
            (course.students || []).forEach((id) => studentIds.add(String(id)));
        });

        const students = await User.find({ _id: { $in: Array.from(studentIds) } })
            .select('_id name')
            .lean();

        const submissions = await Submission.find({
            assignment: { $in: assignmentIds },
            isLatest: true,
        })
            .populate('student', 'name')
            .lean();

        const submissionsByStudent = new Map();
        submissions.forEach((submission) => {
            const studentId = String(submission.student?._id || submission.student);
            if (!submissionsByStudent.has(studentId)) {
                submissionsByStudent.set(studentId, []);
            }
            submissionsByStudent.get(studentId).push(submission);
        });

        const totalAssignments = assignments.length || 0;
        let totalScore = 0;
        let scoredCount = 0;

        const studentRows = students.map((student) => {
            const studentId = String(student._id);
            const studentSubs = submissionsByStudent.get(studentId) || [];
            const completed = studentSubs.length;
            const scoredSubs = studentSubs.filter((sub) => Number.isFinite(sub.score));
            const avgScore = scoredSubs.length
                ? Math.round(scoredSubs.reduce((sum, sub) => sum + Number(sub.score || 0), 0) / scoredSubs.length)
                : 0;

            if (scoredSubs.length) {
                totalScore += avgScore;
                scoredCount += 1;
            }

            const progress = totalAssignments ? Math.round((completed / totalAssignments) * 100) : 0;

            return {
                id: studentId,
                name: student.name,
                score: avgScore,
                progress,
                weak: '',
                weakAreas: [],
                interactionCount: completed,
                topicScores: {},
            };
        });

        const avgScore = scoredCount ? Math.round(totalScore / scoredCount) : 0;

        const now = new Date();
        const weeks = Array.from({ length: 6 }).map((_, idx) => {
            const start = new Date(now);
            start.setDate(now.getDate() - (5 - idx) * 7);
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(start.getDate() + 7);
            const label = `Week ${idx + 1}`;

            const weekCount = submissions.filter((sub) => {
                const date = new Date(sub.submittedAt || sub.createdAt);
                return date >= start && date < end;
            }).length;

            const denom = totalAssignments * (students.length || 1);
            const progress = denom ? Math.round((weekCount / denom) * 100) : 0;

            return { week: label, progress };
        });

        const analyticsData = {
            overview: {
                totalStudents: students.length,
                avgScore,
                activeProjects: totalAssignments,
            },
            students: studentRows,
            progressTrend: weeks,
            topicPerformance: [],
            weakAreas: [],
        };

        return res.status(200).json(analyticsData);
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load analytics' });
    }
};

const getRubrics = async (req, res) => {
    try {
        const professorId = req.user?._id;
        const { course_key } = req.query || {};
        if (!professorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const query = { professor: professorId };
        const normalized = normalizeCourseKey(course_key);
        if (normalized) {
            query.courseKey = normalized;
        }

        const rubrics = await Rubric.find(query).sort({ createdAt: -1 }).lean();
        return res.status(200).json({ rubrics });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load rubrics' });
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

module.exports = {
    uploadMaterial,
    defineRubric,
    sendWeeklyUpdate,
    getAnalytics,
    getRubrics,
    getWeeklyUpdates,
};

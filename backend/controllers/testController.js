const mongoose = require('mongoose');
const axios = require('axios');
const Test = require('../models/Test');
const Attempt = require('../models/Attempt');
const Course = require('../models/Course');
const User = require('../models/User');
const { getAiServiceUrl } = require('../config/services');
const { recomputeStudentCourseProgress } = require('../services/progressService');

const AI_BASE = getAiServiceUrl();

const ensureDbConnected = () => mongoose.connection.readyState === 1;

const normalizeTopicList = (topics) => {
    if (!topics) return [];
    if (Array.isArray(topics)) {
        return topics.map((t) => String(t).trim()).filter(Boolean);
    }
    return String(topics)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
};

const sanitizeQuestions = (questions) => {
    if (!Array.isArray(questions)) return [];

    return questions
        .map((q) => ({
            questionText: String(q.questionText || '').trim(),
            options: Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [],
            correctAnswer: Number(q.correctAnswer),
            explanation: String(q.explanation || '').trim(),
            topic: String(q.topic || '').trim(),
        }))
        .filter((q) => {
            if (!q.questionText) return false;
            if (!Array.isArray(q.options) || q.options.length < 2) return false;
            if (!Number.isInteger(q.correctAnswer)) return false;
            if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) return false;
            return true;
        });
};

const generateTestQuestions = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const role = req.user?.role;
        const { courseId, count = 10, difficulty = 'medium', topics = [], instructions = '' } = req.body || {};

        if (!professorId) return res.status(401).json({ message: 'Unauthorized' });
        if (role !== 'professor') return res.status(403).json({ message: 'Not authorized' });
        if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Valid courseId is required' });
        }

        const course = await Course.findById(courseId).select('professor courseCode title');
        if (!course) return res.status(404).json({ message: 'Course not found' });
        if (String(course.professor) !== String(professorId)) {
            return res.status(403).json({ message: 'Not authorized for this course' });
        }

        const normalizedTopics = normalizeTopicList(topics);
        const safeCount = Math.max(1, Math.min(25, Number(count) || 10));
        const safeDifficulty = ['easy', 'medium', 'hard'].includes(String(difficulty).toLowerCase())
            ? String(difficulty).toLowerCase()
            : 'medium';

        const courseKey = String(course.courseCode || course._id);

        const response = await axios.post(
            `${AI_BASE}/course/generate-quiz`,
            {
                course_key: courseKey,
                count: safeCount,
                difficulty: safeDifficulty,
                topics: normalizedTopics,
                instructions: String(instructions || ''),
            },
            { timeout: 45000 }
        );

        const rawQuestions = response?.data?.questions;
        const questions = sanitizeQuestions(rawQuestions);
        if (!questions.length) {
            return res.status(502).json({ message: 'AI did not return any valid questions. Try editing instructions or upload more materials.' });
        }

        return res.status(200).json({
            courseId: String(courseId),
            courseKey,
            questions: questions.slice(0, safeCount),
        });
    } catch (error) {
        const message = error?.response?.data?.detail || error?.response?.data?.message || error.message;
        return res.status(502).json({ message: message || 'Failed to generate quiz questions' });
    }
};

const pickUnseenQuestions = async ({ studentId, test, count }) => {
    const all = Array.isArray(test.questions) ? test.questions : [];
    if (!studentId) return all;

    const attempts = await Attempt.find({ studentId, testId: test._id })
        .select('answers.questionId')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

    const seen = new Set();
    attempts.forEach((a) => {
        (a.answers || []).forEach((ans) => {
            if (ans?.questionId) seen.add(String(ans.questionId));
        });
    });

    const unseen = all.filter((q) => !seen.has(String(q._id)));
    const pool = unseen.length > 0 ? unseen : all;

    // Shuffle
    const shuffled = [...pool].sort(() => Math.random() - 0.5);

    if (count && Number.isFinite(Number(count)) && Number(count) > 0) {
        return shuffled.slice(0, Number(count));
    }
    return shuffled;
};

const toPublicTestListItem = (test) => ({
    _id: String(test._id),
    courseId: String(test.courseId),
    isActive: test.isActive !== false,
    title: test.title,
    topics: Array.isArray(test.topics) ? test.topics : [],
    difficulty: test.difficulty,
    createdBy: test.createdBy,
    questionCount: Array.isArray(test.questions) ? test.questions.length : 0,
    createdAt: test.createdAt,
});

const setTestActive = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const role = req.user?.role;
        const { testId } = req.params;
        const { isActive } = req.body || {};

        if (!professorId) return res.status(401).json({ message: 'Unauthorized' });
        if (role !== 'professor') return res.status(403).json({ message: 'Not authorized' });
        if (!testId || !mongoose.Types.ObjectId.isValid(testId)) {
            return res.status(400).json({ message: 'Valid testId is required' });
        }
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ message: 'isActive must be a boolean' });
        }

        const test = await Test.findById(testId).select('_id courseId isActive');
        if (!test) return res.status(404).json({ message: 'Test not found' });

        const course = await Course.findById(test.courseId).select('professor students');
        if (!course) return res.status(404).json({ message: 'Course not found' });
        if (String(course.professor) !== String(professorId)) {
            return res.status(403).json({ message: 'Not authorized for this course' });
        }

        const next = isActive;
        test.isActive = next;
        await test.save();

        const io = req.app?.get('io');
        if (io) {
            const payload = {
                kind: 'test-updated',
                courseId: String(test.courseId),
                testId: String(test._id),
                isActive: next,
                timestamp: new Date().toISOString(),
            };
            io.to(`user:${course.professor}`).emit('practice-updated', payload);
            (course.students || []).forEach((studentId) => {
                io.to(`user:${studentId}`).emit('practice-updated', payload);
            });
        }

        return res.status(200).json({ message: 'Test updated.', test: toPublicTestListItem(test.toObject ? test.toObject() : test) });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to update test' });
    }
};

const createTest = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const { courseId, title, topics, difficulty, createdBy = 'professor', questions } = req.body || {};

        if (!professorId) return res.status(401).json({ message: 'Unauthorized' });
        if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Valid courseId is required' });
        }
        if (!title || !String(title).trim()) {
            return res.status(400).json({ message: 'title is required' });
        }

        const course = await Course.findById(courseId).select('professor students');
        if (!course) return res.status(404).json({ message: 'Course not found' });
        if (String(course.professor) !== String(professorId)) {
            return res.status(403).json({ message: 'Not authorized to create tests for this course' });
        }

        const topicList = normalizeTopicList(topics);
        const qList = sanitizeQuestions(questions);
        if (qList.length === 0) {
            return res.status(400).json({ message: 'At least one valid question is required' });
        }

        const test = await Test.create({
            courseId,
            title: String(title).trim(),
            topics: topicList,
            difficulty: ['easy', 'medium', 'hard'].includes(String(difficulty)) ? String(difficulty) : 'medium',
            createdBy: String(createdBy) === 'ai' ? 'ai' : 'professor',
            createdByUser: professorId,
            questions: qList,
        });

        const io = req.app?.get('io');
        if (io) {
            const payload = {
                kind: 'test-created',
                courseId: String(courseId),
                testId: String(test._id),
                timestamp: new Date().toISOString(),
            };

            io.to(`user:${course.professor}`).emit('practice-updated', payload);
            (course.students || []).forEach((studentId) => {
                io.to(`user:${studentId}`).emit('practice-updated', payload);
            });
        }

        return res.status(201).json({ message: 'Test created.', test: toPublicTestListItem(test) });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to create test' });
    }
};

const listTests = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const { courseId } = req.query || {};
        if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Valid courseId is required' });
        }

        const role = req.user?.role;
        const userId = req.user?._id;

        const course = await Course.findById(courseId).select('professor students');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        if (role === 'professor') {
            if (String(course.professor) !== String(userId)) {
                return res.status(403).json({ message: 'Not authorized for this course' });
            }
        } else if (role === 'student') {
            const enrolled = Array.isArray(course.students) && course.students.some((id) => String(id) === String(userId));
            if (!enrolled) return res.status(403).json({ message: 'Not enrolled in this course' });
        } else {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const query = { courseId };
        if (role === 'student') {
            // Students should not be offered inactive tests.
            query.isActive = { $ne: false };
        }

        const tests = await Test.find(query)
            .sort({ isActive: -1, createdAt: -1 })
            .lean();

        return res.status(200).json({ tests: tests.map(toPublicTestListItem) });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to list tests' });
    }
};

const getTestForStudent = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const studentId = req.user?._id;
        const { testId } = req.params;
        const { count } = req.query || {};

        if (!testId || !mongoose.Types.ObjectId.isValid(testId)) {
            return res.status(400).json({ message: 'Valid testId is required' });
        }

        const test = await Test.findById(testId).lean();
        if (!test) return res.status(404).json({ message: 'Test not found' });

        if (test.isActive === false) {
            return res.status(403).json({ message: 'This practice test is inactive' });
        }

        const course = await Course.findById(test.courseId).select('students');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const enrolled = Array.isArray(course.students) && course.students.some((id) => String(id) === String(studentId));
        if (!enrolled) return res.status(403).json({ message: 'Not enrolled in this course' });

        const picked = await pickUnseenQuestions({ studentId, test, count });

        const safeQuestions = picked.map((q) => ({
            _id: String(q._id),
            questionText: q.questionText,
            options: q.options,
            topic: q.topic || '',
        }));

        return res.status(200).json({
            test: {
                _id: String(test._id),
                courseId: String(test.courseId),
                title: test.title,
                topics: Array.isArray(test.topics) ? test.topics : [],
                difficulty: test.difficulty,
                createdBy: test.createdBy,
                questionCount: Array.isArray(test.questions) ? test.questions.length : 0,
            },
            questions: safeQuestions,
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load test' });
    }
};

const checkAnswer = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const studentId = req.user?._id;
        const { testId, questionId, selectedIndex } = req.body || {};

        if (!testId || !mongoose.Types.ObjectId.isValid(testId)) {
            return res.status(400).json({ message: 'Valid testId is required' });
        }
        if (!questionId || !mongoose.Types.ObjectId.isValid(questionId)) {
            return res.status(400).json({ message: 'Valid questionId is required' });
        }
        if (!Number.isInteger(Number(selectedIndex))) {
            return res.status(400).json({ message: 'selectedIndex must be an integer' });
        }

        const test = await Test.findById(testId);
        if (!test) return res.status(404).json({ message: 'Test not found' });

        if (test.isActive === false) {
            return res.status(403).json({ message: 'This practice test is inactive' });
        }

        const course = await Course.findById(test.courseId).select('students');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const enrolled = Array.isArray(course.students) && course.students.some((id) => String(id) === String(studentId));
        if (!enrolled) return res.status(403).json({ message: 'Not enrolled in this course' });

        const q = (test.questions || []).find((qq) => String(qq._id) === String(questionId));
        if (!q) return res.status(404).json({ message: 'Question not found' });

        const selected = Number(selectedIndex);
        const correctIndex = Number(q.correctAnswer);
        const correct = selected === correctIndex;

        return res.status(200).json({
            correct,
            correctAnswer: correctIndex,
            explanation: q.explanation || '',
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to check answer' });
    }
};

const submitAttempt = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const studentId = req.user?._id;
        const { testId, answers, timeTakenSeconds = 0, feedbackMode = 'delayed' } = req.body || {};

        if (!testId || !mongoose.Types.ObjectId.isValid(testId)) {
            return res.status(400).json({ message: 'Valid testId is required' });
        }
        if (!Array.isArray(answers) || answers.length === 0) {
            return res.status(400).json({ message: 'answers array is required' });
        }

        const test = await Test.findById(testId).lean();
        if (!test) return res.status(404).json({ message: 'Test not found' });

        if (test.isActive === false) {
            return res.status(403).json({ message: 'This practice test is inactive' });
        }

        const course = await Course.findById(test.courseId).select('students professor courseCode');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        const enrolled = Array.isArray(course.students) && course.students.some((id) => String(id) === String(studentId));
        if (!enrolled) return res.status(403).json({ message: 'Not enrolled in this course' });

        const qById = new Map((test.questions || []).map((q) => [String(q._id), q]));

        const scoredAnswers = [];
        let correctCount = 0;
        const wrongTopics = [];

        for (const a of answers) {
            const qid = a?.questionId ? String(a.questionId) : '';
            const selectedIndex = Number(a?.selectedIndex);
            if (!qid || !qById.has(qid) || !Number.isInteger(selectedIndex)) {
                continue;
            }

            const q = qById.get(qid);
            const isCorrect = Number(q.correctAnswer) === selectedIndex;
            if (isCorrect) correctCount += 1;

            if (!isCorrect) {
                if (q.topic && String(q.topic).trim()) wrongTopics.push(String(q.topic).trim());
                else if (Array.isArray(test.topics) && test.topics.length) wrongTopics.push(...test.topics);
            }

            scoredAnswers.push({
                questionId: q._id,
                selectedIndex,
                isCorrect,
            });
        }

        if (scoredAnswers.length === 0) {
            return res.status(400).json({ message: 'No valid answers submitted' });
        }

        const score = Math.round((correctCount / scoredAnswers.length) * 100);

        const weakAreas = Array.from(
            wrongTopics
                .map((t) => String(t).trim())
                .filter(Boolean)
                .reduce((acc, t) => acc.set(t, (acc.get(t) || 0) + 1), new Map())
                .entries()
        )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([t]) => t);

        const attempt = await Attempt.create({
            studentId,
            courseId: test.courseId,
            testId: test._id,
            answers: scoredAnswers,
            score,
            timeTakenSeconds: Number.isFinite(Number(timeTakenSeconds)) ? Number(timeTakenSeconds) : 0,
            weakAreas,
            feedbackMode: feedbackMode === 'immediate' ? 'immediate' : 'delayed',
        });

        const breakdown = scoredAnswers.map((ans) => {
            const q = qById.get(String(ans.questionId));
            return {
                questionId: String(ans.questionId),
                questionText: q?.questionText || '',
                options: q?.options || [],
                selectedIndex: ans.selectedIndex,
                correctAnswer: q?.correctAnswer,
                correct: ans.isCorrect,
                explanation: q?.explanation || '',
                topic: q?.topic || '',
            };
        });

        const recommendedDifficulty = score >= 80 ? 'hard' : score <= 50 ? 'easy' : 'medium';
        const recommendations = await Test.find({
            courseId: test.courseId,
            difficulty: recommendedDifficulty,
            isActive: { $ne: false },
        })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        try {
            await recomputeStudentCourseProgress({
                studentId,
                courseId: test.courseId,
                includeAiInsights: false,
            });
        } catch (progressErr) {
            console.warn('Progress update failed after attempt submission:', progressErr.message);
        }

        const io = req.app?.get('io');
        if (io) {
            io.to(`user:${studentId}`).emit('practice-updated', {
                kind: 'attempt-submitted',
                courseId: String(test.courseId),
                testId: String(test._id),
                attemptId: String(attempt._id),
                timestamp: new Date().toISOString(),
            });
            io.to(`user:${course.professor}`).emit('practice-updated', {
                kind: 'attempt-submitted',
                courseId: String(test.courseId),
                testId: String(test._id),
                attemptId: String(attempt._id),
                studentId: String(studentId),
                timestamp: new Date().toISOString(),
            });
        }

        return res.status(201).json({
            message: 'Attempt submitted.',
            result: {
                attemptId: String(attempt._id),
                testId: String(test._id),
                courseId: String(test.courseId),
                score,
                correctCount,
                total: scoredAnswers.length,
                timeTakenSeconds: attempt.timeTakenSeconds,
                weakAreas,
                breakdown,
                recommendedDifficulty,
                recommendedTests: recommendations.map(toPublicTestListItem),
            },
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to submit attempt' });
    }
};

const getResults = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const role = req.user?.role;
        const requesterId = req.user?._id;
        const { studentId: queryStudentId, courseId } = req.query || {};

        if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Valid courseId is required' });
        }

        const course = await Course.findById(courseId).select('professor students');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        let filterStudentId = null;
        if (role === 'professor') {
            if (String(course.professor) !== String(requesterId)) {
                return res.status(403).json({ message: 'Not authorized for this course' });
            }
            if (queryStudentId) {
                if (!mongoose.Types.ObjectId.isValid(queryStudentId)) {
                    return res.status(400).json({ message: 'studentId must be a valid id' });
                }
                filterStudentId = queryStudentId;
            }
        } else if (role === 'student') {
            const enrolled = Array.isArray(course.students) && course.students.some((id) => String(id) === String(requesterId));
            if (!enrolled) return res.status(403).json({ message: 'Not enrolled in this course' });
            filterStudentId = requesterId;
        } else {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const attemptQuery = { courseId };
        if (filterStudentId) attemptQuery.studentId = filterStudentId;

        let attemptsQuery = Attempt.find(attemptQuery)
            .sort({ createdAt: -1 })
            .limit(role === 'professor' && !filterStudentId ? 200 : 50);

        if (role === 'professor' && !filterStudentId) {
            attemptsQuery = attemptsQuery.populate('studentId', 'name email');
        }

        const attempts = await attemptsQuery.lean();

        // Ensure student identity is present for professor views (populate may return ObjectId only).
        let studentById = new Map();
        if (role === 'professor' && !filterStudentId) {
            const ids = attempts
                .map((a) => {
                    const sid = a?.studentId;
                    if (!sid) return null;
                    if (typeof sid === 'object' && sid._id) return String(sid._id);
                    return String(sid);
                })
                .filter(Boolean);

            const uniqueIds = Array.from(new Set(ids));
            if (uniqueIds.length > 0) {
                const users = await User.find({ _id: { $in: uniqueIds } }).select('name email').lean();
                studentById = new Map(
                    users.map((u) => [String(u._id), { _id: String(u._id), name: u.name, email: u.email }])
                );
            }
        }

        const testIds = Array.from(new Set(attempts.map((a) => String(a.testId))));
        const tests = await Test.find({ _id: { $in: testIds } }).lean();
        const testById = new Map(tests.map((t) => [String(t._id), t]));

        const results = attempts.map((a) => {
            const t = testById.get(String(a.testId));
            const qById = new Map((t?.questions || []).map((q) => [String(q._id), q]));

            const breakdown = (a.answers || []).map((ans) => {
                const q = qById.get(String(ans.questionId));
                return {
                    questionId: String(ans.questionId),
                    questionText: q?.questionText || '',
                    options: q?.options || [],
                    selectedIndex: ans.selectedIndex,
                    correctAnswer: q?.correctAnswer,
                    correct: Boolean(ans.isCorrect),
                    explanation: q?.explanation || '',
                    topic: q?.topic || '',
                };
            });

            const rawStudentId = a?.studentId;
            const studentId = rawStudentId && typeof rawStudentId === 'object' && rawStudentId._id
                ? String(rawStudentId._id)
                : String(rawStudentId);

            const populatedStudent = rawStudentId && typeof rawStudentId === 'object' && (rawStudentId.name || rawStudentId.email)
                ? { _id: String(rawStudentId._id), name: rawStudentId.name, email: rawStudentId.email }
                : undefined;

            const student = populatedStudent || studentById.get(studentId);

            return {
                attemptId: String(a._id),
                studentId,
                student,
                test: t ? toPublicTestListItem(t) : { _id: String(a.testId), courseId: String(courseId), title: 'Unknown Test' },
                score: a.score,
                timeTakenSeconds: a.timeTakenSeconds,
                weakAreas: a.weakAreas || [],
                createdAt: a.createdAt,
                breakdown,
            };
        });

        return res.status(200).json({ results });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load results' });
    }
};

const getLeaderboard = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const { courseId: rawCourseId, testId, limit = 10 } = req.query || {};

        let effectiveCourseId = rawCourseId;
        let testObjectId = null;

        // If a testId is provided, use it to resolve the courseId (source of truth).
        if (testId != null && String(testId).trim() !== '') {
            if (!mongoose.Types.ObjectId.isValid(testId)) {
                return res.status(400).json({ message: 'Valid testId is required' });
            }
            testObjectId = new mongoose.Types.ObjectId(testId);
            const test = await Test.findById(testObjectId).select('courseId').lean();
            if (!test) return res.status(404).json({ message: 'Test not found' });
            effectiveCourseId = String(test.courseId);
        }

        if (!effectiveCourseId || !mongoose.Types.ObjectId.isValid(effectiveCourseId)) {
            return res.status(400).json({ message: 'Valid courseId is required' });
        }

        // Any enrolled student or the course professor can view.
        const requesterId = req.user?._id;
        const course = await Course.findById(effectiveCourseId).select('professor students');
        if (!course) return res.status(404).json({ message: 'Course not found' });

        if (!requesterId) return res.status(401).json({ message: 'Unauthorized' });

        const isCourseProfessor = String(course.professor) === String(requesterId);
        const isEnrolledStudent = Array.isArray(course.students) && course.students.some((id) => String(id) === String(requesterId));

        if (!isCourseProfessor && !isEnrolledStudent) {
            return res.status(403).json({ message: 'Not authorized for this course' });
        }

        const match = { courseId: new mongoose.Types.ObjectId(effectiveCourseId) };
        if (testObjectId) match.testId = testObjectId;

        const rows = await Attempt.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$studentId',
                    attempts: { $sum: 1 },
                    avgScore: { $avg: '$score' },
                    bestScore: { $max: '$score' },
                },
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'student',
                },
            },
            { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
            { $sort: { avgScore: -1, bestScore: -1, attempts: -1 } },
            { $limit: Math.max(1, Math.min(Number(limit) || 10, 50)) },
            {
                $project: {
                    _id: 0,
                    studentId: '$_id',
                    attempts: 1,
                    avgScore: { $round: ['$avgScore', 1] },
                    bestScore: 1,
                    student: {
                        _id: '$student._id',
                        name: '$student.name',
                        email: '$student.email',
                    },
                },
            },
        ]);

        return res.status(200).json({ leaderboard: rows });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load leaderboard' });
    }
};

module.exports = {
    createTest,
    listTests,
    getTestForStudent,
    checkAnswer,
    submitAttempt,
    getResults,
    getLeaderboard,
    generateTestQuestions,
    setTestActive,
};

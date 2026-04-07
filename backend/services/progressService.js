const axios = require('axios');
const mongoose = require('mongoose');
const Assignment = require('../models/Assignment');
const Attempt = require('../models/Attempt');
const ChatHistory = require('../models/ChatHistory');
const Course = require('../models/Course');
const CourseEngagement = require('../models/CourseEngagement');
const Progress = require('../models/Progress');
const Submission = require('../models/Submission');
const Test = require('../models/Test');
const { getAiServiceUrl } = require('../config/services');

const AI_BASE = getAiServiceUrl();
const CACHE_TTL_MS = 60 * 1000;
const progressCache = new Map();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round1 = (value) => Math.round((Number(value) || 0) * 10) / 10;

const normalizeTopic = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .slice(0, 80);

const toLabel = (value) => {
    const normalized = normalizeTopic(value);
    if (!normalized) return '';
    return normalized
        .split(' ')
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
};

const cacheKey = (studentId, courseId) => `${String(studentId)}:${String(courseId)}`;

const invalidateProgressCache = (studentId, courseId) => {
    if (studentId && courseId) {
        progressCache.delete(cacheKey(studentId, courseId));
        return;
    }

    if (studentId && !courseId) {
        const prefix = `${String(studentId)}:`;
        Array.from(progressCache.keys()).forEach((key) => {
            if (key.startsWith(prefix)) progressCache.delete(key);
        });
        return;
    }

    progressCache.clear();
};

const getActivityLevel = (activityScore) => {
    if (activityScore >= 70) return 'high';
    if (activityScore >= 40) return 'medium';
    return 'low';
};

const inferDifficultyLevelFromText = (text) => {
    const lower = String(text || '').toLowerCase();
    if (!lower) return 'medium';

    const hardSignals = ['optimize', 'dynamic programming', 'complexity', 'proof', 'advanced', 'hard'];
    const easySignals = ['basic', 'beginner', 'intro', 'simple', 'easy'];

    if (hardSignals.some((signal) => lower.includes(signal))) return 'hard';
    if (easySignals.some((signal) => lower.includes(signal))) return 'easy';
    return 'medium';
};

const inferMessageTopics = (message, candidateTopics) => {
    const normalizedMessage = normalizeTopic(message);
    if (!normalizedMessage) return [];

    const directMatches = candidateTopics.filter((topic) => normalizedMessage.includes(topic));
    if (directMatches.length > 0) return directMatches;

    const tokens = new Set(normalizedMessage.split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
    return candidateTopics.filter((topic) => {
        const topicTokens = topic.split(' ').filter((token) => token.length >= 4);
        if (!topicTokens.length) return false;
        const overlap = topicTokens.filter((token) => tokens.has(token)).length;
        return overlap > 0;
    });
};

const getCourseByAnyIdentifier = async ({ courseId, courseKey }) => {
    if (courseId && mongoose.Types.ObjectId.isValid(String(courseId))) {
        const byId = await Course.findById(courseId).select('_id courseCode title students professor').lean();
        if (byId) return byId;
    }

    const normalizedCourseKey = String(courseKey || '').trim().toUpperCase();
    if (!normalizedCourseKey) return null;

    return Course.findOne({ courseCode: normalizedCourseKey })
        .select('_id courseCode title students professor')
        .lean();
};

const generateFallbackInsights = ({ weakTopics, strongTopics, pendingAssignments, testAvg, activityLevel }) => {
    const recommendations = [];
    if (weakTopics.length > 0) recommendations.push(`Revise ${weakTopics.slice(0, 2).join(' and ')} this week.`);
    if (pendingAssignments > 0) recommendations.push(`Complete ${pendingAssignments} pending assignment(s) to improve progress.`);
    if (testAvg < 60) recommendations.push('Retry an easier practice test and review incorrect answers.');
    if (activityLevel === 'low') recommendations.push('Increase daily study activity and chatbot practice sessions.');
    if (recommendations.length === 0) recommendations.push('Maintain your momentum with one practice test and one revision session this week.');

    const summary = weakTopics.length > 0
        ? `You are currently struggling in ${weakTopics.slice(0, 2).join(', ')}.`
        : strongTopics.length > 0
            ? `You are performing strongly in ${strongTopics.slice(0, 2).join(', ')}.`
            : 'Your progress baseline is available. Start with assignments and a short practice test.';

    return { summary, recommendations };
};

const generateAiInsights = async ({ courseCode, weakTopics, strongTopics, pendingAssignments, testAvg, activityLevel }) => {
    const fallback = generateFallbackInsights({ weakTopics, strongTopics, pendingAssignments, testAvg, activityLevel });

    try {
        const prompt = [
            'Generate concise student guidance.',
            `Weak topics: ${weakTopics.join(', ') || 'none'}`,
            `Strong topics: ${strongTopics.join(', ') || 'none'}`,
            `Pending assignments: ${pendingAssignments}`,
            `Practice test average: ${Math.round(testAvg)}%`,
            `Engagement level: ${activityLevel}`,
            'Respond with:',
            '1) One sentence summary.',
            '2) 3 short action recommendations.',
        ].join('\n');

        const response = await axios.post(
            `${AI_BASE}/course/chat`,
            {
                course_key: String(courseCode || 'general').toLowerCase(),
                message: prompt,
                history: [],
                student_level: 'intermediate',
            },
            { timeout: 12000 }
        );

        const reply = String(response?.data?.reply || '').trim();
        if (!reply) return fallback;

        const lines = reply
            .split('\n')
            .map((line) => line.replace(/^[-*\d).\s]+/, '').trim())
            .filter(Boolean);

        const summary = lines[0] || fallback.summary;
        const recommendations = lines.slice(1, 4);

        return {
            summary,
            recommendations: recommendations.length > 0 ? recommendations : fallback.recommendations,
        };
    } catch (error) {
        return fallback;
    }
};

const computeProgressFromSources = async ({ studentId, course }) => {
    const courseId = String(course._id);

    const [
        assignments,
        attempts,
        tests,
        engagementRows,
        chatDoc,
        existingProgress,
    ] = await Promise.all([
        Assignment.find({ course: courseId }).select('_id title description deadline maxPoints').lean(),
        Attempt.find({ studentId, courseId }).sort({ createdAt: 1 }).lean(),
        Test.find({ courseId }).select('_id topics questions').lean(),
        CourseEngagement.find({ studentId, courseId }).lean(),
        ChatHistory.findOne({
            user: studentId,
            courseKey: String(course.courseCode || '').trim().toLowerCase(),
        })
            .select('messages')
            .lean(),
        Progress.findOne({ studentId, courseId }).lean(),
    ]);

    const assignmentIds = assignments.map((row) => row._id);
    const latestSubmissions = assignmentIds.length
        ? await Submission.find({ student: studentId, assignment: { $in: assignmentIds }, isLatest: true })
            .select('assignment score isLate submittedAt')
            .lean()
        : [];
    const submissionByAssignment = new Map(latestSubmissions.map((row) => [String(row.assignment), row]));

    const totalAssignmentWeight = assignments.reduce((sum, row) => sum + Math.max(1, Number(row.maxPoints) || 100), 0);
    let assignmentWeightedScore = 0;
    let assignmentCompleted = 0;
    let assignmentLateCount = 0;
    let assignmentScoreSum = 0;
    let assignmentScoreCount = 0;

    assignments.forEach((assignment) => {
        const maxPoints = Math.max(1, Number(assignment.maxPoints) || 100);
        const latest = submissionByAssignment.get(String(assignment._id));
        if (!latest) return;

        assignmentCompleted += 1;
        if (latest.isLate) assignmentLateCount += 1;

        const rawScore = Number.isFinite(Number(latest.score)) ? Number(latest.score) : 0;
        const percent = clamp((rawScore / maxPoints) * 100, 0, 100);
        const adjusted = clamp(percent - (latest.isLate ? 5 : 0), 0, 100);

        assignmentWeightedScore += adjusted * maxPoints;
        assignmentScoreSum += adjusted;
        assignmentScoreCount += 1;
    });

    const assignmentComponent = totalAssignmentWeight > 0 ? assignmentWeightedScore / totalAssignmentWeight : 0;
    const assignmentAvg = assignmentScoreCount > 0 ? assignmentScoreSum / assignmentScoreCount : 0;
    const assignmentPending = Math.max(0, assignments.length - assignmentCompleted);
    const onTimeRate = assignmentCompleted > 0
        ? ((assignmentCompleted - assignmentLateCount) / assignmentCompleted) * 100
        : 0;

    const testAvg = attempts.length > 0
        ? attempts.reduce((sum, row) => sum + clamp(Number(row.score) || 0, 0, 100), 0) / attempts.length
        : 0;

    const attemptsByTest = attempts.reduce((acc, row) => {
        const key = String(row.testId);
        if (!acc.has(key)) acc.set(key, []);
        acc.get(key).push(row);
        return acc;
    }, new Map());

    let improvementBonusTotal = 0;
    let improvementSamples = 0;
    attemptsByTest.forEach((rows) => {
        if (!rows.length) return;
        const first = clamp(Number(rows[0].score) || 0, 0, 100);
        const best = rows.reduce((max, row) => Math.max(max, clamp(Number(row.score) || 0, 0, 100)), 0);
        if (best > first) {
            improvementBonusTotal += best - first;
            improvementSamples += 1;
        }
    });

    const improvementBonus = improvementSamples > 0 ? (improvementBonusTotal / improvementSamples) * 0.2 : 0;
    const testComponent = clamp(testAvg + improvementBonus, 0, 100);

    const modulesCompleted = engagementRows.filter((row) => row.completionStatus === 'completed').length;
    const totalModules = engagementRows.length;
    const contentCompletionScore = totalModules > 0 ? (modulesCompleted / totalModules) * 100 : 0;

    const timeSpentMinutes = engagementRows.reduce((sum, row) => sum + (Number(row.totalTimeSpentSeconds) || 0) / 60, 0);
    const materialsViewed = engagementRows.reduce((sum, row) => sum + (Number(row.viewCount) || 0), 0);

    const userMessages = Array.isArray(chatDoc?.messages)
        ? chatDoc.messages.filter((msg) => msg?.sender === 'user')
        : [];
    const chatInteractions = userMessages.length;

    const loginCount = Number(existingProgress?.engagement?.loginCount || 0);
    const lastLoginAt = existingProgress?.engagement?.lastLoginAt || null;

    const loginScore = clamp(loginCount * 8, 0, 100);
    const timeScore = clamp(timeSpentMinutes * 1.5, 0, 100);
    const chatScore = clamp(chatInteractions * 6, 0, 100);
    const contentScore = clamp(materialsViewed * 8, 0, 100);
    const activityScore = round1((loginScore * 0.25) + (timeScore * 0.25) + (chatScore * 0.25) + (contentScore * 0.25));
    const activityLevel = getActivityLevel(activityScore);

    const candidateTopics = new Set();

    tests.forEach((test) => {
        (test.topics || []).forEach((topic) => {
            const normalized = normalizeTopic(topic);
            if (normalized) candidateTopics.add(normalized);
        });
        (test.questions || []).forEach((question) => {
            const normalized = normalizeTopic(question.topic);
            if (normalized) candidateTopics.add(normalized);
        });
    });

    attempts.forEach((attempt) => {
        (attempt.weakAreas || []).forEach((topic) => {
            const normalized = normalizeTopic(topic);
            if (normalized) candidateTopics.add(normalized);
        });
    });

    assignments.forEach((assignment) => {
        const raw = `${String(assignment.title || '')} ${String(assignment.description || '')}`.toLowerCase();
        raw
            .split(/[^a-z0-9]+/)
            .filter((token) => token.length >= 5)
            .slice(0, 8)
            .forEach((token) => candidateTopics.add(normalizeTopic(token)));
    });

    const topicStats = new Map();
    const ensureTopic = (topicName) => {
        const topic = normalizeTopic(topicName);
        if (!topic) return null;
        if (!topicStats.has(topic)) {
            topicStats.set(topic, {
                testAttempts: 0,
                testCorrect: 0,
                assignmentScores: [],
                chatMentions: 0,
                lastPracticed: null,
            });
        }
        return topicStats.get(topic);
    };

    const testById = new Map(tests.map((row) => [String(row._id), row]));
    attempts.forEach((attempt) => {
        const test = testById.get(String(attempt.testId));
        if (!test) return;

        const questionById = new Map((test.questions || []).map((question) => [String(question._id), question]));

        (attempt.answers || []).forEach((answer) => {
            const question = questionById.get(String(answer.questionId));
            const topicName = normalizeTopic(question?.topic || 'general');
            const bucket = ensureTopic(topicName);
            if (!bucket) return;

            bucket.testAttempts += 1;
            if (Boolean(answer.isCorrect)) bucket.testCorrect += 1;
            const attemptDate = attempt.createdAt ? new Date(attempt.createdAt) : null;
            if (attemptDate && (!bucket.lastPracticed || attemptDate > bucket.lastPracticed)) {
                bucket.lastPracticed = attemptDate;
            }
        });

        (attempt.weakAreas || []).forEach((topic) => {
            const bucket = ensureTopic(topic);
            if (bucket) bucket.chatMentions += 1;
        });
    });

    assignments.forEach((assignment) => {
        const latest = submissionByAssignment.get(String(assignment._id));
        if (!latest || !Number.isFinite(Number(latest.score))) return;

        const maxPoints = Math.max(1, Number(assignment.maxPoints) || 100);
        const adjusted = clamp(((Number(latest.score) || 0) / maxPoints) * 100 - (latest.isLate ? 5 : 0), 0, 100);
        const text = `${assignment.title || ''} ${assignment.description || ''}`;

        let matched = false;
        Array.from(candidateTopics).forEach((topic) => {
            if (!topic || topic.length < 4) return;
            if (normalizeTopic(text).includes(topic)) {
                const bucket = ensureTopic(topic);
                if (bucket) {
                    bucket.assignmentScores.push(adjusted);
                    matched = true;
                }
            }
        });

        if (!matched) {
            const general = ensureTopic('general');
            if (general) general.assignmentScores.push(adjusted);
        }
    });

    let hardestSeenDifficulty = 'easy';
    userMessages.forEach((message) => {
        const text = String(message?.text || message?.content || '');
        const inferred = inferDifficultyLevelFromText(text);
        if (inferred === 'hard') hardestSeenDifficulty = 'hard';
        else if (inferred === 'medium' && hardestSeenDifficulty === 'easy') hardestSeenDifficulty = 'medium';

        const matchedTopics = inferMessageTopics(text, Array.from(candidateTopics));
        matchedTopics.forEach((topic) => {
            const bucket = ensureTopic(topic);
            if (bucket) bucket.chatMentions += 1;
        });
    });

    const topicProgress = Array.from(topicStats.entries())
        .map(([topicName, stats]) => {
            const testAccuracy = stats.testAttempts > 0 ? (stats.testCorrect / stats.testAttempts) * 100 : null;
            const assignmentPerf = stats.assignmentScores.length > 0
                ? stats.assignmentScores.reduce((sum, value) => sum + value, 0) / stats.assignmentScores.length
                : null;
            const chatSignal = stats.chatMentions > 0 ? clamp(100 - (stats.chatMentions * 12), 0, 100) : null;

            let numerator = 0;
            let denominator = 0;
            if (testAccuracy !== null) {
                numerator += testAccuracy * 0.55;
                denominator += 0.55;
            }
            if (assignmentPerf !== null) {
                numerator += assignmentPerf * 0.35;
                denominator += 0.35;
            }
            if (chatSignal !== null) {
                numerator += chatSignal * 0.1;
                denominator += 0.1;
            }

            const masteryLevel = denominator > 0 ? clamp(numerator / denominator, 0, 100) : 0;

            return {
                topicName: toLabel(topicName),
                masteryLevel: round1(masteryLevel),
                attempts: stats.testAttempts,
                accuracy: round1(testAccuracy || 0),
                lastPracticed: stats.lastPracticed || null,
            };
        })
        .sort((a, b) => b.masteryLevel - a.masteryLevel)
        .slice(0, 40);

    const weakTopics = topicProgress
        .filter((topic) => topic.masteryLevel < 50)
        .sort((a, b) => a.masteryLevel - b.masteryLevel)
        .map((topic) => topic.topicName)
        .slice(0, 8);

    const strongTopics = topicProgress
        .filter((topic) => topic.masteryLevel > 80)
        .sort((a, b) => b.masteryLevel - a.masteryLevel)
        .map((topic) => topic.topicName)
        .slice(0, 8);

    const overallProgress = round1(
        (assignmentComponent * 0.4) +
            (testComponent * 0.3) +
            (contentCompletionScore * 0.2) +
            (activityScore * 0.1)
    );

    return {
        overallProgress: clamp(overallProgress, 0, 100),
        modulesCompleted,
        totalModules,
        assignmentStats: {
            avgScore: round1(assignmentAvg),
            completed: assignmentCompleted,
            pending: assignmentPending,
            onTimeRate: round1(onTimeRate),
            lateCount: assignmentLateCount,
        },
        testStats: {
            avgScore: round1(testAvg),
            attempts: attempts.length,
            latestScore: attempts.length ? round1(clamp(Number(attempts[attempts.length - 1].score) || 0, 0, 100)) : 0,
        },
        weakTopics,
        strongTopics,
        topicProgress,
        activityScore: round1(activityScore),
        activityLevel,
        engagement: {
            loginCount,
            timeSpentMinutes: round1(timeSpentMinutes),
            chatInteractions,
            materialsViewed,
            lastLoginAt,
            inferredDifficulty: hardestSeenDifficulty,
        },
        lastUpdated: new Date(),
    };
};

const recomputeStudentCourseProgress = async ({ studentId, courseId, includeAiInsights = false }) => {
    if (!studentId || !courseId) throw new Error('studentId and courseId are required');

    const course = await getCourseByAnyIdentifier({ courseId });
    if (!course) throw new Error('Course not found');

    const enrolled = Array.isArray(course.students) && course.students.some((id) => String(id) === String(studentId));
    if (!enrolled) throw new Error('Student is not enrolled in this course');

    const computed = await computeProgressFromSources({ studentId, course });

    let aiInsights = null;
    const shouldGenerateInsights = includeAiInsights;
    if (shouldGenerateInsights) {
        aiInsights = await generateAiInsights({
            courseCode: course.courseCode,
            weakTopics: computed.weakTopics,
            strongTopics: computed.strongTopics,
            pendingAssignments: computed.assignmentStats.pending,
            testAvg: computed.testStats.avgScore,
            activityLevel: computed.activityLevel,
        });
    }

    const update = {
        studentId,
        courseId,
        overallProgress: computed.overallProgress,
        modulesCompleted: computed.modulesCompleted,
        totalModules: computed.totalModules,
        assignmentStats: computed.assignmentStats,
        testStats: computed.testStats,
        weakTopics: computed.weakTopics,
        strongTopics: computed.strongTopics,
        topicProgress: computed.topicProgress,
        activityScore: computed.activityScore,
        activityLevel: computed.activityLevel,
        engagement: {
            loginCount: computed.engagement.loginCount,
            timeSpentMinutes: computed.engagement.timeSpentMinutes,
            chatInteractions: computed.engagement.chatInteractions,
            materialsViewed: computed.engagement.materialsViewed,
            lastLoginAt: computed.engagement.lastLoginAt,
        },
        lastUpdated: computed.lastUpdated,
    };

    if (aiInsights) {
        update.aiInsights = {
            summary: aiInsights.summary,
            recommendations: aiInsights.recommendations,
            generatedAt: new Date(),
        };
    }

    const progress = await Progress.findOneAndUpdate(
        { studentId, courseId },
        { $set: update, $setOnInsert: { studentId, courseId } },
        { upsert: true, new: true }
    )
        .populate('courseId', 'title courseCode')
        .lean();

    const key = cacheKey(studentId, courseId);
    progressCache.set(key, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        data: progress,
    });

    return progress;
};

const getProgressSnapshot = async ({ studentId, courseId, includeAiInsights = false, forceRecompute = false }) => {
    const key = cacheKey(studentId, courseId);

    if (!forceRecompute) {
        const cached = progressCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }

        const existing = await Progress.findOne({ studentId, courseId }).populate('courseId', 'title courseCode').lean();
        if (existing && existing.lastUpdated) {
            const ageMs = Date.now() - new Date(existing.lastUpdated).getTime();
            if (ageMs < CACHE_TTL_MS) {
                progressCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data: existing });
                return existing;
            }
        }
    }

    return recomputeStudentCourseProgress({ studentId, courseId, includeAiInsights });
};

const getAllCoursesProgressForStudent = async (studentId) => {
    const courses = await Course.find({ students: studentId }).select('_id title courseCode').lean();
    if (!courses.length) return [];

    const rows = await Promise.all(
        courses.map((course) =>
            getProgressSnapshot({ studentId, courseId: course._id, includeAiInsights: false, forceRecompute: false })
                .catch(() => null)
        )
    );

    return rows.filter(Boolean);
};

const registerMaterialViewEvent = async ({ studentId, courseId, courseKey, moduleKey, materialTitle, timeSpentSeconds, completed }) => {
    const course = await getCourseByAnyIdentifier({ courseId, courseKey });
    if (!course) throw new Error('Course not found for engagement event');

    const normalizedModuleKey = String(moduleKey || materialTitle || 'module').trim().toLowerCase().slice(0, 120);
    if (!normalizedModuleKey) throw new Error('moduleKey or materialTitle is required');

    const isCompleted = Boolean(completed);
    const safeTime = Math.max(0, Number(timeSpentSeconds) || 0);

    await CourseEngagement.findOneAndUpdate(
        { studentId, courseId: course._id, moduleKey: normalizedModuleKey },
        {
            $setOnInsert: {
                studentId,
                courseId: course._id,
                moduleKey: normalizedModuleKey,
                materialTitle: String(materialTitle || normalizedModuleKey),
            },
            $set: {
                lastViewedAt: new Date(),
                completionStatus: isCompleted ? 'completed' : 'in_progress',
            },
            $inc: {
                viewCount: 1,
                totalTimeSpentSeconds: safeTime,
            },
        },
        { upsert: true, new: true }
    );

    invalidateProgressCache(studentId, course._id);
    return recomputeStudentCourseProgress({ studentId, courseId: course._id, includeAiInsights: false });
};

const registerLoginEvent = async (studentId) => {
    const enrolledCourses = await Course.find({ students: studentId }).select('_id').lean();
    if (!enrolledCourses.length) return;

    await Promise.all(
        enrolledCourses.map((course) =>
            Progress.updateOne(
                { studentId, courseId: course._id },
                {
                    $setOnInsert: { studentId, courseId: course._id },
                    $inc: { 'engagement.loginCount': 1 },
                    $set: { 'engagement.lastLoginAt': new Date(), lastUpdated: new Date() },
                },
                { upsert: true }
            )
        )
    );

    invalidateProgressCache(studentId);

    await Promise.allSettled(
        enrolledCourses.map((course) =>
            recomputeStudentCourseProgress({ studentId, courseId: course._id, includeAiInsights: false })
        )
    );
};

module.exports = {
    getCourseByAnyIdentifier,
    getProgressSnapshot,
    getAllCoursesProgressForStudent,
    recomputeStudentCourseProgress,
    registerMaterialViewEvent,
    registerLoginEvent,
    invalidateProgressCache,
};

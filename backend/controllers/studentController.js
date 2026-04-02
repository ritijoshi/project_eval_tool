// Student Controller mimicking real DB / AI behavior

const axios = require('axios');
const FormData = require('form-data');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const { getProfile, updateQuizScore, addInteraction, addWeakTopics } = require('../utils/studentProfileStore');
const { getAiServiceUrl } = require('../config/services');

const AI_BASE = getAiServiceUrl();

const parseScoreFromLabel = (scoreLabel) => {
    const value = String(scoreLabel || '').trim();
    const match = value.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (match) {
        const numerator = Number(match[1]);
        const denominator = Number(match[2]);
        if (denominator > 0) {
            return Math.round((numerator / denominator) * 100);
        }
    }

    const percentMatch = value.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
        return Math.round(Number(percentMatch[1]));
    }

    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
        return Math.max(0, Math.min(100, Math.round(numeric)));
    }
    return null;
};

const normalizeCourseKey = (value) =>
    String(value || 'general')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'general';

const parseBaseScore = (evaluationData) => {
    const label = evaluationData?.score;
    const numeric = parseScoreFromLabel(label);
    return numeric === null ? 0 : numeric;
};

const createFeedbackRecord = async ({ studentId, courseKey, evaluationData, submissionText, rubric }) => {
    try {
        const professor = await User.findOne({ role: 'professor' }).select('_id');
        if (!professor) return null;

        const feedback = await Feedback.create({
            evaluationId: `${Date.now()}-${studentId}`,
            student: studentId,
            professor: professor._id,
            courseKey: normalizeCourseKey(courseKey),
            aiEvaluation: {
                score: String(evaluationData?.score || '0/100'),
                feedback: String(evaluationData?.explanation || evaluationData?.feedback || '').trim(),
                details: {
                    strengths: evaluationData?.strengths || [],
                    weaknesses: evaluationData?.weaknesses || [],
                    suggestions: evaluationData?.suggestions || [],
                    criterion_breakdown: evaluationData?.criterion_breakdown || [],
                },
                rubric: String(rubric || ''),
            },
            submissionContent: {
                text: String(submissionText || ''),
                files: [],
            },
            status: 'pending',
        });

        return feedback;
    } catch (err) {
        return null;
    }
};

const getLearningPath = async (req, res) => {
    try {
        const userId = req.user?._id || 'anonymous';
        const profile = getProfile(userId);
        const studentStats = {
            student_id: userId,
            quiz_scores: profile.quiz_scores || {},
            weak_topics: profile.weak_topics || [],
            recent_interactions: profile.recent_interactions || []
        };

        if ((studentStats.recent_interactions || []).length === 0) {
            studentStats.recent_interactions = [
                'Need help understanding core concepts and implementation steps.',
                'I need more practice-oriented questions to prepare for assessments.'
            ];
        }

        try {
            const pythonServiceUrl = `${AI_BASE}/personalize`;
            const response = await axios.post(pythonServiceUrl, studentStats);
            res.status(200).json(response.data);
        } catch (error) {
            res.status(503).json({ message: "AI personalization engine offline. Please start local AI microservice." });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getLeaderboard = async (req, res) => {
    try {
        const students = await User.find({ role: 'student' }).select('_id name').lean();
        const feedbackDocs = await Feedback.find({ status: { $in: ['pending', 'reviewed', 'awaiting_response', 'resolved'] } })
            .select('student courseKey aiEvaluation professorReview createdAt')
            .lean();

        const scoreByStudent = new Map();

        feedbackDocs.forEach((doc) => {
            const studentId = String(doc.student);
            const base = parseScoreFromLabel(doc?.aiEvaluation?.score) || 0;
            const adjustment = Number(doc?.professorReview?.scoreAdjustment || 0);
            const final = Math.max(0, Math.min(100, base + adjustment));

            if (!scoreByStudent.has(studentId)) {
                scoreByStudent.set(studentId, {
                    scores: [],
                    latest: doc.createdAt,
                    courses: new Set(),
                });
            }

            const bucket = scoreByStudent.get(studentId);
            bucket.scores.push(final);
            if (!bucket.latest || new Date(doc.createdAt) > new Date(bucket.latest)) {
                bucket.latest = doc.createdAt;
            }
            bucket.courses.add(String(doc.courseKey || 'general'));
        });

        const leaderboard = students
            .map((student) => {
                const profile = getProfile(student._id);
                const scored = scoreByStudent.get(String(student._id));
                const quizScores = Object.values(profile.quiz_scores || {});

                const feedbackAverage = scored?.scores?.length
                    ? scored.scores.reduce((a, b) => a + b, 0) / scored.scores.length
                    : null;
                const quizAverage = quizScores.length
                    ? quizScores.reduce((a, b) => a + b, 0) / quizScores.length
                    : null;

                let finalScore = 0;
                if (feedbackAverage !== null && quizAverage !== null) {
                    finalScore = Math.round(feedbackAverage * 0.7 + quizAverage * 0.3);
                } else if (feedbackAverage !== null) {
                    finalScore = Math.round(feedbackAverage);
                } else if (quizAverage !== null) {
                    finalScore = Math.round(quizAverage);
                }

                return {
                    studentId: student._id,
                    name: student.name,
                    score: finalScore,
                    submissions: scored?.scores?.length || 0,
                    coursesCovered: scored?.courses ? scored.courses.size : 0,
                    weakTopics: (profile.weak_topics || []).length,
                    lastUpdated: scored?.latest || null,
                };
            })
            .sort((a, b) => b.score - a.score)
            .map((entry, idx) => ({
                rank: idx + 1,
                ...entry,
            }));

        res.status(200).json({
            total: leaderboard.length,
            leaderboard,
            refreshedAt: new Date().toISOString(),
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const submitProposal = async (req, res) => {
    try {
        console.log('Project proposal submitted:', req.body);
        // Simulate Agent evaluation
        const evaluation = {
            status: "Evaluated",
            score: "85/100",
            feedback: "Great proposal. Strong architecture, but the UI/UX criteria could be defined more clearly based on the rubric."
        };
        res.status(201).json({ message: 'Proposal submitted and evaluated by AI Agent successfully.', evaluation });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const evaluateProject = async (req, res) => {
    try {
        const { submission_text, rubric, course_key } = req.body;
        const userId = req.user?._id || 'anonymous';
        addInteraction(userId, `Project evaluation submitted: ${String(submission_text || '').slice(0, 220)}`);
        
        try {
            const pythonServiceUrl = `${AI_BASE}/evaluate`;
            const response = await axios.post(pythonServiceUrl, {
                submission_text: submission_text,
                rubric: rubric
            });

            const scorePercent = parseScoreFromLabel(response?.data?.score);
            if (scorePercent !== null) {
                updateQuizScore(userId, 'project evaluation', scorePercent);
            }

            const feedbackDoc = await createFeedbackRecord({
                studentId: userId,
                courseKey: course_key,
                evaluationData: response.data,
                submissionText: submission_text,
                rubric,
            });

            res.status(200).json({
                ...response.data,
                feedbackId: feedbackDoc?._id || null,
            });
        } catch (error) {
            res.status(503).json({ message: "AI evaluation engine disconnected. Python microservice offline." });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const evaluateProjectFiles = async (req, res) => {
    try {
        const { rubric, course_key } = req.body || {};
        const files = req.files || [];

        if (!rubric || !String(rubric).trim()) {
            return res.status(400).json({ message: 'rubric is required' });
        }
        if (!files.length) {
            return res.status(400).json({ message: 'At least one submission file is required' });
        }

        const userId = req.user?._id || 'anonymous';
        addInteraction(userId, `Project evaluation submitted with ${files.length} file(s).`);

        const pythonServiceUrl = `${AI_BASE}/evaluate/files`;
        const form = new FormData();
        form.append('rubric', String(rubric));

        files.forEach((file) => {
            form.append('files', file.buffer, {
                filename: file.originalname,
                contentType: file.mimetype,
            });
        });

        try {
            const response = await axios.post(pythonServiceUrl, form, {
                headers: form.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });

            const scorePercent = parseScoreFromLabel(response?.data?.score);
            if (scorePercent !== null) {
                updateQuizScore(userId, 'project evaluation', scorePercent);
            }

            const feedbackDoc = await createFeedbackRecord({
                studentId: userId,
                courseKey: course_key,
                evaluationData: response.data,
                submissionText: files.map((f) => f.originalname).join(', '),
                rubric,
            });

            res.status(200).json({
                ...response.data,
                feedbackId: feedbackDoc?._id || null,
            });
        } catch (error) {
            res.status(503).json({ message: "AI evaluation engine disconnected. Python microservice offline." });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updatePersonalizationInputs = async (req, res) => {
    try {
        const userId = req.user?._id || 'anonymous';
        const { quiz_scores, weak_topics, interaction } = req.body || {};

        if (quiz_scores && typeof quiz_scores === 'object') {
            for (const [topic, score] of Object.entries(quiz_scores)) {
                updateQuizScore(userId, topic, score);
            }
        }

        if (Array.isArray(weak_topics)) {
            const cleanedTopics = weak_topics.map((t) => String(t || '').trim()).filter(Boolean);
            addWeakTopics(userId, cleanedTopics);
        }

        if (interaction) {
            addInteraction(userId, interaction);
        }

        const profile = getProfile(userId);
        res.status(200).json({
            message: 'Personalization inputs updated.',
            profile,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getLearningPath,
    getLeaderboard,
    submitProposal,
    evaluateProject,
    evaluateProjectFiles,
    updatePersonalizationInputs,
};

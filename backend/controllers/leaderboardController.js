const StudentEvaluation = require('../models/StudentEvaluation');
const EvaluationSession = require('../models/EvaluationSession');

/**
 * Core ranking helper — shared by controller endpoints and the webhook emitter.
 * Filters out invalid/fallback evaluations, applies dense ranking, and adds badges + percentile.
 */
const normalizeBreakdown = (raw) => {
    if (Array.isArray(raw)) {
        return raw.map((entry, index) => {
            const item = entry && typeof entry === 'object' ? entry : {};
            return {
                name: String(item.name || item.title || item.criterion || `Criterion ${index + 1}`),
                score: Number(item.score ?? item.value ?? 0),
                maxScore: Number(item.maxScore ?? item.max_score ?? item.max ?? 0),
                feedback: item.feedback || item.reason || item.comment || '',
            };
        });
    }

    if (raw && typeof raw === 'object') {
        return Object.entries(raw).map(([name, value]) => {
            if (value && typeof value === 'object') {
                return {
                    name: String(name),
                    score: Number(value.score ?? value.value ?? 0),
                    maxScore: Number(value.maxScore ?? value.max_score ?? value.max ?? 0),
                    feedback: value.feedback || value.reason || value.comment || '',
                };
            }

            return {
                name: String(name),
                score: Number(value ?? 0),
                maxScore: 0,
                feedback: '',
            };
        });
    }

    return [];
};

const getOverallScore = (ev) => {
    const aiOverall = ev?.aiEvaluation?.overallScore;
    if (typeof aiOverall === 'number' && Number.isFinite(aiOverall)) {
        return Number(aiOverall);
    }

    const directOverall = ev?.overallScore;
    if (typeof directOverall === 'number' && Number.isFinite(directOverall)) {
        return Number(directOverall);
    }

    const dbScore = ev?.score;
    if (typeof dbScore === 'number' && Number.isFinite(dbScore)) {
        return Number((dbScore * 10).toFixed(1));
    }

    return null;
};

const buildRankedLeaderboard = (evaluations) => {
    const valid = evaluations.filter((ev) => {
        const overallScore = getOverallScore(ev);
        const status = String(ev?.evaluationStatus || 'COMPLETED').toUpperCase();

        const hasValidScore = typeof overallScore === 'number' && Number.isFinite(overallScore) && overallScore >= 0 && overallScore <= 100;
        const isValidStatus = !['FAILED', 'ERROR', 'PENDING', 'IN_PROGRESS', 'PROCESSING', 'QUEUED'].includes(status);
        return hasValidScore && isValidStatus;
    });

    valid.sort((a, b) => getOverallScore(b) - getOverallScore(a));

    const total = valid.length;
    let currentRank = 1;

    const ranked = valid.map((ev, idx) => {
        if (idx > 0 && getOverallScore(ev) < getOverallScore(valid[idx - 1])) {
            currentRank = idx + 1;
        }

        const overallScore = getOverallScore(ev);
        const percentile = total > 1 ? Math.round(((total - currentRank) / (total - 1)) * 100) : 100;
        const aiEvaluation = ev.aiEvaluation || {};
        const breakdown = normalizeBreakdown(aiEvaluation.scoreBreakdown || ev.scoreBreakdown || []);

        const badges = [];
        if (currentRank === 1) badges.push({ label: 'Top Performer', icon: '🏆', color: 'badge-gold' });
        if ((aiEvaluation.confidence ?? ev.confidence ?? 0) >= 0.85) badges.push({ label: 'High Confidence', icon: '🎯', color: 'badge-blue' });

        return {
            rank: currentRank,
            evaluationId: ev._id,
            studentName: ev.studentName,
            rollNumber: ev.rollNumber || ev.rollNo || 'N/A',
            overallScore,
            percentile,
            confidence: aiEvaluation.confidence ?? ev.confidence ?? null,
            scoreBreakdown: breakdown,
            strengths: aiEvaluation.strengths || ev.strengths || [],
            weakAreas: aiEvaluation.weakAreas || ev.weakAreas || [],
            mistakes: aiEvaluation.mistakes || ev.mistakes || [],
            improvements: aiEvaluation.improvements || ev.improvements || [],
            missingKeyPoints: aiEvaluation.missingKeyPoints || ev.missingKeyPoints || [],
            missingConcepts: aiEvaluation.missingConcepts || ev.missingConcepts || [],
            conceptsCovered: aiEvaluation.conceptsCovered || ev.conceptsCovered || [],
            summaryInsights: aiEvaluation.summaryInsights || ev.summaryInsights || '',
            scoreExplanation: aiEvaluation.scoreExplanation || ev.scoreExplanation || '',
            feedback: ev.feedback || aiEvaluation.feedback || aiEvaluation.overallFeedback || '',
            evaluationStatus: ev.evaluationStatus || 'COMPLETED',
            badges,
            fileName: ev.fileName || ev.file_name || '',
        };
    });

    return { ranked, total };
};

/**
 * GET /api/leaderboard/:sessionId
 * Returns the ranked leaderboard for a given evaluation session.
 */
exports.getLeaderboard = async (req, res, next) => {
    try {
        const { sessionId } = req.params;

        const session = await EvaluationSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Evaluation session not found' });
        }

        const evaluations = await StudentEvaluation.find({ sessionId }).lean();
        const { ranked, total } = buildRankedLeaderboard(evaluations);

        return res.status(200).json({
            success: true,
            sessionId,
            courseId: session.courseId,
            lectureTopic: session.transcriptMetadata?.lectureTopic || 'Lecture',
            sessionStatus: session.status,
            totalEvaluated: total,
            totalStudents: session.totalStudents,
            leaderboard: ranked,
            generatedAt: new Date().toISOString(),
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/leaderboard/:sessionId/refresh
 * Recomputes the leaderboard and emits a live update via Socket.io.
 * Professor-only.
 */
exports.refreshLeaderboard = async (req, res, next) => {
    try {
        const { sessionId } = req.params;

        const session = await EvaluationSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Evaluation session not found' });
        }

        const evaluations = await StudentEvaluation.find({ sessionId }).lean();
        const { ranked, total } = buildRankedLeaderboard(evaluations);

        // Emit live update
        const io = req.app.get('io');
        if (io) {
            io.to(`leaderboard_session_${sessionId}`).emit('leaderboard_update', {
                sessionId,
                leaderboard: ranked,
                totalEvaluated: total,
                triggeredBy: 'manual_refresh',
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Leaderboard refreshed and broadcast',
            totalEvaluated: total,
            leaderboard: ranked,
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/leaderboard/:sessionId/student/:evaluationId
 * Returns the full metric breakdown + AI insights for a single student.
 */
exports.getStudentDetail = async (req, res, next) => {
    try {
        const { sessionId, evaluationId } = req.params;

        const ev = await StudentEvaluation.findOne({ _id: evaluationId, sessionId }).lean();
        if (!ev) {
            return res.status(404).json({ success: false, message: 'Student evaluation not found' });
        }

        return res.status(200).json({
            success: true,
            detail: {
                studentName: ev.studentName,
                rollNumber: ev.rollNumber || ev.rollNo || 'N/A',
                evaluationStatus: ev.evaluationStatus || 'COMPLETED',
                overallScore: getOverallScore(ev),
                scoreExplanation: ev.aiEvaluation?.scoreExplanation || ev.scoreExplanation || '',
                scoreBreakdown: normalizeBreakdown(ev.aiEvaluation?.scoreBreakdown || ev.scoreBreakdown || []),
                metrics: ev.aiEvaluation?.metrics || {},
                strengths: ev.aiEvaluation?.strengths || ev.strengths || [],
                weakAreas: ev.aiEvaluation?.weakAreas || ev.weakAreas || [],
                mistakes: ev.aiEvaluation?.mistakes || ev.mistakes || [],
                improvements: ev.aiEvaluation?.improvements || ev.improvements || [],
                missingKeyPoints: ev.aiEvaluation?.missingKeyPoints || ev.missingKeyPoints || [],
                missingConcepts: ev.aiEvaluation?.missingConcepts || ev.missingConcepts || [],
                conceptsCovered: ev.aiEvaluation?.conceptsCovered || ev.conceptsCovered || [],
                summaryInsights: ev.aiEvaluation?.summaryInsights || ev.summaryInsights || '',
                confidence: ev.aiEvaluation?.confidence ?? ev.confidence ?? null,
                fallback: ev.aiEvaluation?.fallback || false,
                feedback: ev.feedback || ev.aiEvaluation?.feedback || ev.aiEvaluation?.overallFeedback || '',
            },
        });
    } catch (err) {
        next(err);
    }
};

// Export the helper so evaluationController can reuse it
exports.buildRankedLeaderboard = buildRankedLeaderboard;

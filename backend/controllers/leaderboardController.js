const StudentEvaluation = require('../models/StudentEvaluation');
const EvaluationSession = require('../models/EvaluationSession');

/**
 * Core ranking helper — shared by controller endpoints and the webhook emitter.
 * Filters out invalid/fallback evaluations, applies dense ranking, and adds badges + percentile.
 */
const buildRankedLeaderboard = (evaluations) => {
    // Fairness: only rank COMPLETED, non-fallback evaluations with a real overallScore
    const valid = evaluations.filter((ev) => {
        const hasScore = typeof ev.aiEvaluation?.overallScore === 'number' && ev.aiEvaluation.overallScore !== null;
        const notFallback = ev.aiEvaluation?.fallback !== true;
        const isCompleted = ev.evaluationStatus === 'COMPLETED';
        const notDefault = ev.aiEvaluation?.overallScore !== 0.0; // guard against silent 0.0 placeholders
        return hasScore && notFallback && isCompleted && notDefault;
    });

    // Sort descending by overallScore
    valid.sort((a, b) => b.aiEvaluation.overallScore - a.aiEvaluation.overallScore);

    const total = valid.length;
    let currentRank = 1;

    const ranked = valid.map((ev, idx) => {
        // Dense ranking: previous score differs → increment rank
        if (idx > 0 && ev.aiEvaluation.overallScore < valid[idx - 1].aiEvaluation.overallScore) {
            currentRank = idx + 1;
        }

        const overallScore = ev.aiEvaluation.overallScore;
        const percentile = total > 1 ? Math.round(((total - currentRank) / (total - 1)) * 100) : 100;
        const metrics = ev.aiEvaluation?.metrics || {};

        // Badge assignment
        const badges = [];
        if (currentRank === 1) badges.push({ label: 'Top Performer', icon: '🏆', color: 'badge-gold' });
        if ((metrics.conceptUnderstanding?.score ?? 0) >= 8.5) badges.push({ label: 'Excellent Understanding', icon: '💡', color: 'badge-blue' });
        if ((metrics.technicalAccuracy?.score ?? 0) >= 8.5) badges.push({ label: 'Strong Technical Accuracy', icon: '🎯', color: 'badge-purple' });
        if ((metrics.clarityReadability?.score ?? 0) >= 8.5) badges.push({ label: 'High Clarity', icon: '✨', color: 'badge-teal' });

        return {
            rank: currentRank,
            evaluationId: ev._id,
            studentName: ev.studentName,
            rollNumber: ev.rollNumber || ev.rollNo,
            overallScore,
            percentile,
            badges,
            // Lightweight metric snapshot for table display
            metrics: {
                topicCoverage: metrics.topicCoverage?.score ?? null,
                conceptUnderstanding: metrics.conceptUnderstanding?.score ?? null,
                technicalAccuracy: metrics.technicalAccuracy?.score ?? null,
                clarityReadability: metrics.clarityReadability?.score ?? null,
                completeness: metrics.completeness?.score ?? null,
                logicalFlow: metrics.logicalFlow?.score ?? null,
                criticalThinkingDepth: metrics.criticalThinkingDepth?.score ?? null,
            },
            scoreBreakdown: ev.aiEvaluation?.scoreBreakdown || [],
            evaluationStatus: ev.evaluationStatus,
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
                rollNumber: ev.rollNumber || ev.rollNo,
                evaluationStatus: ev.evaluationStatus,
                overallScore: ev.aiEvaluation?.overallScore ?? null,
                scoreExplanation: ev.aiEvaluation?.scoreExplanation || '',
                scoreBreakdown: ev.aiEvaluation?.scoreBreakdown || [],
                metrics: ev.aiEvaluation?.metrics || {},
                strengths: ev.aiEvaluation?.strengths || [],
                weakAreas: ev.aiEvaluation?.weakAreas || [],
                improvements: ev.aiEvaluation?.improvements || [],
                summaryInsights: ev.aiEvaluation?.summaryInsights || '',
                missingKeyPoints: ev.aiEvaluation?.missingKeyPoints || [],
                conceptsCovered: ev.aiEvaluation?.conceptsCovered || [],
                fallback: ev.aiEvaluation?.fallback || false,
                feedback: ev.feedback || '',
            },
        });
    } catch (err) {
        next(err);
    }
};

// Export the helper so evaluationController can reuse it
exports.buildRankedLeaderboard = buildRankedLeaderboard;

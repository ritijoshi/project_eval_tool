const AssignmentStudentResult = require('../models/AssignmentStudentResult');
const AssignmentEvalSession = require('../models/AssignmentEvalSession');

/**
 * Core ranking helper for assignment evaluations.
 * Adapts the existing buildRankedLeaderboard pattern to AssignmentStudentResult schema.
 *
 * @param {Array} results  - AssignmentStudentResult documents (plain objects or Mongoose docs)
 * @param {Array} rubricCriteria - [{ title, maxScore }] from the session
 * @returns {{ ranked: Array, total: number }}
 */
const buildAssignmentLeaderboard = (results, rubricCriteria = []) => {
  // Only rank COMPLETED results with a real numeric score
  const valid = results.filter(
    (r) =>
      r.evaluationStatus === 'COMPLETED' &&
      typeof r.score === 'number' &&
      r.score !== null
  );

  valid.sort((a, b) => b.score - a.score);

  const total = valid.length;
  let currentRank = 1;

  const ranked = valid.map((r, idx) => {
    if (idx > 0 && r.score < valid[idx - 1].score) currentRank = idx + 1;

    const percentile =
      total > 1
        ? Math.round(((total - currentRank) / (total - 1)) * 100)
        : 100;

    const pct = r.maxScore > 0 ? (r.score / r.maxScore) * 100 : 0;

    // Badges
    const badges = [];
    if (currentRank === 1) badges.push({ label: 'Top Performer', icon: '🏆', color: 'badge-gold' });
    if (pct >= 90) badges.push({ label: 'Distinction', icon: '⭐', color: 'badge-purple' });
    if ((r.missingConcepts?.length ?? 1) === 0)
      badges.push({ label: 'Complete Submission', icon: '✅', color: 'badge-teal' });
    const correctnessEntry = r.scoreBreakdown?.correctness;
    if (
      typeof correctnessEntry?.score === 'number' &&
      r.maxScore > 0 &&
      correctnessEntry.score >= r.maxScore * 0.9
    ) {
      badges.push({ label: 'High Correctness', icon: '🎯', color: 'badge-blue' });
    }

    // Per-criterion scores map
    const rubricScores = {};
    rubricCriteria.forEach((c) => {
      rubricScores[c.title] = r.scoreBreakdown?.[c.title]?.score ?? null;
    });

    return {
      rank: currentRank,
      resultId: r._id,
      studentName: r.studentName,
      rollNumber: r.rollNumber,
      overallScore: r.score,
      maxScore: r.maxScore,
      gradeLabel: r.gradeLabel,
      percentile,
      badges,
      rubricScores,
      submissionType: r.submissionType,
      evaluationStatus: r.evaluationStatus,
      // Collapsed student analysis snippets (full detail is lazy-loaded per row)
      strengthsSummary: (r.strengths || []).slice(0, 2),
      mistakesSummary: (r.mistakes || []).slice(0, 2),
    };
  });

  return { ranked, total };
};

// GET /api/assignment-leaderboard/:sessionId
exports.getAssignmentLeaderboard = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await AssignmentEvalSession.findById(sessionId).lean();
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const results = await AssignmentStudentResult.find({ sessionId }).lean();
    const { ranked, total } = buildAssignmentLeaderboard(results, session.rubricCriteria || []);

    return res.status(200).json({
      success: true,
      sessionId,
      assignmentTitle: session.assignmentTitle || session.sessionLabel || 'Assignment Evaluation',
      courseId: session.courseId,
      rubricCriteria: session.rubricCriteria || [],
      totalEvaluated: total,
      totalStudents: session.totalStudents,
      leaderboard: ranked,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/assignment-leaderboard/:sessionId/student/:resultId
exports.getStudentDetail = async (req, res, next) => {
  try {
    const { sessionId, resultId } = req.params;
    const result = await AssignmentStudentResult.findOne({ _id: resultId, sessionId }).lean();
    if (!result) {
      return res.status(404).json({ success: false, message: 'Student result not found' });
    }

    return res.status(200).json({
      success: true,
      detail: {
        studentName: result.studentName,
        rollNumber: result.rollNumber,
        score: result.score,
        maxScore: result.maxScore,
        gradeLabel: result.gradeLabel,
        scoreBreakdown: result.scoreBreakdown,
        strengths: result.strengths,
        mistakes: result.mistakes,
        weakAreas: result.weakAreas,
        missingConcepts: result.missingConcepts,
        expectedConcepts: result.expectedConcepts,
        improvementSuggestions: result.improvementSuggestions,
        overallFeedback: result.overallFeedback,
        summaryInsights: result.summaryInsights,
        submissionType: result.submissionType,
        confidence: result.confidence,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.buildAssignmentLeaderboard = buildAssignmentLeaderboard;

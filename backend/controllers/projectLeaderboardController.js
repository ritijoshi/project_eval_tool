const ProjectEvalResult = require('../models/ProjectEvalResult');
const ProjectEvalSession = require('../models/ProjectEvalSession');
const ProjectWeeklyProgress = require('../models/ProjectWeeklyProgress');

/**
 * Core ranking helper for Project Evaluations.
 * Adapts the project evaluation schema to produce a ranked leaderboard with
 * percentiles, badges, health indicators, and criteria breakdowns.
 *
 * @param {Array} results - ProjectEvalResult documents (plain objects or Mongoose docs)
 * @param {Array} rubricCriteria - [{ name, title, maxScore }] from the session
 * @returns {{ ranked: Array, total: number }}
 */
const buildProjectLeaderboard = (results = [], rubricCriteria = []) => {
  // Only rank COMPLETED results with a valid numeric overallScore
  const valid = results.filter(
    (r) =>
      r.evaluationStatus === 'COMPLETED' &&
      typeof r.overallScore === 'number' &&
      r.overallScore !== null &&
      Number.isFinite(r.overallScore)
  );

  valid.sort((a, b) => b.overallScore - a.overallScore);

  const total = valid.length;
  let currentRank = 1;

  const ranked = valid.map((r, idx) => {
    if (idx > 0 && r.overallScore < valid[idx - 1].overallScore) {
      currentRank = idx + 1;
    }

    const percentile =
      total > 1
        ? Math.round(((total - currentRank) / (total - 1)) * 100)
        : 100;

    const maxScore = r.maxScore > 0 ? r.maxScore : 100;
    const pct = (r.overallScore / maxScore) * 100;

    // Badges calculation
    const badges = [];
    if (currentRank === 1) {
      badges.push({ label: 'Top Performer', icon: '🏆', color: 'badge-gold' });
    }
    if (pct >= 90) {
      badges.push({ label: 'Distinction', icon: '⭐', color: 'badge-purple' });
    }
    if (r.healthStatus === 'ON_TRACK') {
      badges.push({ label: 'On Track', icon: '🚀', color: 'badge-teal' });
    }
    if (r.requirementCoverage >= 80) {
      badges.push({ label: 'High Coverage', icon: '🎯', color: 'badge-blue' });
    }
    if ((r.missingRequirements?.length ?? 0) === 0 && (r.missingConcepts?.length ?? 0) === 0) {
      badges.push({ label: 'Zero Gaps', icon: '✅', color: 'badge-teal' });
    }

    // Include any AI-generated badges if present
    if (Array.isArray(r.badges)) {
      r.badges.forEach((b) => {
        if (typeof b === 'string' && b.trim()) {
          badges.push({ label: b.trim(), icon: '🎖️', color: 'badge-blue' });
        } else if (b && typeof b === 'object' && b.label) {
          badges.push(b);
        }
      });
    }

    // Map per-criterion scores
    const criterionScores = {};
    if (Array.isArray(r.criterionScores)) {
      r.criterionScores.forEach((c) => {
        if (c && c.name) {
          criterionScores[c.name] = {
            score: c.score ?? 0,
            feedback: c.feedback || '',
          };
        }
      });
    } else if (r.criterionScores && typeof r.criterionScores === 'object') {
      Object.entries(r.criterionScores).forEach(([k, v]) => {
        criterionScores[k] = {
          score: typeof v === 'number' ? v : v?.score ?? 0,
          feedback: v?.feedback || v?.reason || '',
        };
      });
    }

    // Extract team contribution summary if available
    const contributors = r.githubEvidence?.contributors || r.githubEvidence?.contributorStats || [];
    const teamContributionSummary = Array.isArray(contributors)
      ? contributors.slice(0, 5).map((c) => ({
          login: c.login || c.name || 'Contributor',
          contributions: c.contributions || c.commits || 0,
        }))
      : [];

    return {
      rank: currentRank,
      resultId: r._id,
      identifier: r.identifier || '',
      teamName: r.teamName || '',
      repoUrl: r.repoUrl || '',
      repoOwner: r.repoOwner || '',
      repoName: r.repoName || '',
      overallScore: r.overallScore,
      maxScore,
      gradeLabel: r.gradeLabel || '',
      percentile,
      healthStatus: r.healthStatus || 'UNKNOWN',
      requirementCoverage: r.requirementCoverage || 0,
      badges,
      criterionScores,
      teamContributionSummary,
      evaluationStatus: r.evaluationStatus,
      strengthsSummary: (r.strengths || []).slice(0, 2),
      nextWeekTasksSummary: (r.nextWeekTasks || []).slice(0, 2),
      evaluatedAt: r.evaluatedAt,
    };
  });

  return { ranked, total };
};

// GET /api/project-leaderboard/:sessionId
exports.getProjectLeaderboard = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await ProjectEvalSession.findById(sessionId).lean();
    if (!session) {
      return res.status(404).json({ success: false, message: 'Project evaluation session not found' });
    }

    const results = await ProjectEvalResult.find({ sessionId }).lean();
    const { ranked, total } = buildProjectLeaderboard(results, session.rubricCriteria || []);

    const healthBreakdown = {
      onTrack: results.filter((r) => r.healthStatus === 'ON_TRACK').length,
      atRisk: results.filter((r) => r.healthStatus === 'AT_RISK').length,
      behind: results.filter((r) => r.healthStatus === 'BEHIND').length,
      unknown: results.filter((r) => !r.healthStatus || r.healthStatus === 'UNKNOWN').length,
    };

    return res.status(200).json({
      success: true,
      sessionId,
      sessionLabel: session.sessionLabel || 'Project Evaluation',
      projectGoal: session.projectGoal || '',
      courseId: session.courseId,
      rubricCriteria: session.rubricCriteria || [],
      totalEvaluated: total,
      totalRepos: session.totalRepos || results.length,
      leaderboard: ranked,
      healthBreakdown,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/project-leaderboard/:sessionId/project/:resultId
exports.getProjectDetail = async (req, res, next) => {
  try {
    const { sessionId, resultId } = req.params;

    const result = await ProjectEvalResult.findOne({ _id: resultId, sessionId }).lean();
    if (!result) {
      return res.status(404).json({ success: false, message: 'Project result not found' });
    }

    const weeklyRecords = await ProjectWeeklyProgress.find({
      sessionId,
      identifier: result.identifier,
    })
      .sort({ submittedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      detail: {
        _id: result._id,
        sessionId: result.sessionId,
        identifier: result.identifier,
        teamName: result.teamName,
        studentIds: result.studentIds || [],
        repoUrl: result.repoUrl,
        repoOwner: result.repoOwner,
        repoName: result.repoName,
        overallScore: result.overallScore,
        maxScore: result.maxScore,
        gradeLabel: result.gradeLabel,
        healthStatus: result.healthStatus,
        requirementCoverage: result.requirementCoverage,
        criterionScores: result.criterionScores,
        codeQuality: result.codeQuality,
        architecture: result.architecture,
        testing: result.testing,
        documentation: result.documentation,
        projectProgress: result.projectProgress,
        techCompliance: result.techCompliance,
        missingRequirements: result.missingRequirements,
        missingConcepts: result.missingConcepts,
        strengths: result.strengths,
        feedback: result.feedback,
        nextWeekTasks: result.nextWeekTasks,
        githubEvidence: result.githubEvidence,
        weeklyClaims: result.weeklyClaims,
        weeklyProgress: weeklyRecords,
        scoreHistory: result.scoreHistory,
        badges: result.badges,
        evaluationStatus: result.evaluationStatus,
        errorMessage: result.errorMessage,
        evaluatedAt: result.evaluatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.buildProjectLeaderboard = buildProjectLeaderboard;

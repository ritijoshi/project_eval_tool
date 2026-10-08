const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const ExcelJS = require('exceljs');

const ProjectEvalSession = require('../models/ProjectEvalSession');
const ProjectEvalResult = require('../models/ProjectEvalResult');
const ProjectWeeklyProgress = require('../models/ProjectWeeklyProgress');
const ProjectEvalReport = require('../models/ProjectEvalReport');
const Course = require('../models/Course');
const { getAiServiceUrl } = require('../config/services');
const { buildProjectLeaderboard } = require('./projectLeaderboardController');

const AI_BASE = getAiServiceUrl();

// ─── Helpers ────────────────────────────────────────────────────────────────
const sanitizeFilename = (str) =>
  String(str || 'eval').replace(/[^a-z0-9_\-]/gi, '_').replace(/__+/g, '_').slice(0, 80);

const avg = (arr) => {
  const nums = arr.filter((n) => typeof n === 'number' && Number.isFinite(n));
  return nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100 : null;
};

const normalizeList = (value) => (Array.isArray(value) ? value : []);

const safeNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const calculateGrade = (score, max = 100) => {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '';
  const pct = max > 0 ? (score / max) * 100 : score;
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 50) return 'D';
  return 'F';
};

const parseRepoUrl = (url) => {
  try {
    const clean = String(url || '').trim().replace(/\.git$/, '');
    const match = clean.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
    if (match) {
      return { owner: match[1], name: match[2] };
    }
  } catch {}
  return { owner: '', name: '' };
};

const resolveCourseId = async (courseInput) => {
  const raw = String(courseInput ?? '').trim();
  if (!raw || raw === 'null' || raw === 'undefined' || raw === 'all') return null;

  if (mongoose.Types.ObjectId.isValid(raw)) {
    return new mongoose.Types.ObjectId(raw);
  }

  const course = await Course.findOne({
    $or: [
      { courseCode: raw.toUpperCase() },
      { courseCode: { $regex: `^${raw}$`, $options: 'i' } },
      { title: { $regex: `^${raw}$`, $options: 'i' } },
    ],
  }).lean();

  return course ? course._id : null;
};

// ─── 5-Sheet Excel Generator ────────────────────────────────────────────────
/**
 * Generates a comprehensive 5-sheet Project Evaluation report workbook.
 * 1. Summary Leaderboard
 * 2. Criterion-wise Scores
 * 3. Gap Analysis
 * 4. Team Contribution
 * 5. Statistics
 *
 * @param {Object} session
 * @param {Array} results
 * @returns {Promise<Buffer>}
 */
async function generateProjectExcelReport(session, results = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI Project Evaluation System';
  workbook.created = new Date();

  const applyHeaderStyle = (sheet, columns) => {
    sheet.columns = columns;
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FF1F2937' }, size: 11 };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    headerRow.height = 32;
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF9CA3AF' } },
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    });
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, activeCell: 'B2' }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  };

  // Sort results by score descending for leaderboard
  const sorted = [...results].sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));

  // ── Sheet 1: Summary Leaderboard ───────────────────────────────────────────
  const sheet1 = workbook.addWorksheet('Summary Leaderboard');
  const cols1 = [
    { header: 'Rank',                     key: 'rank',                width: 10 },
    { header: 'Identifier',               key: 'identifier',          width: 20 },
    { header: 'Team / Project',           key: 'teamName',            width: 24 },
    { header: 'GitHub Repository',        key: 'repoUrl',             width: 38 },
    { header: 'Overall Score',            key: 'scoreDisplay',        width: 16 },
    { header: 'Max Score',                key: 'maxScore',            width: 12 },
    { header: 'Grade',                    key: 'gradeLabel',          width: 10 },
    { header: 'Health Status',            key: 'healthStatus',        width: 16 },
    { header: 'Coverage (%)',             key: 'coverage',            width: 14 },
    { header: 'Badges',                   key: 'badges',              width: 30 },
    { header: 'Status',                   key: 'status',              width: 14 },
  ];
  applyHeaderStyle(sheet1, cols1);

  sorted.forEach((r, idx) => {
    const isFailed = r.evaluationStatus === 'FAILED';
    const badgeText = Array.isArray(r.badges)
      ? r.badges.map((b) => (typeof b === 'string' ? b : b?.label || '')).filter(Boolean).join(', ')
      : '';
    sheet1.addRow({
      rank: isFailed ? '—' : idx + 1,
      identifier: r.identifier || '—',
      teamName: r.teamName || r.repoName || '—',
      repoUrl: r.repoUrl || '—',
      scoreDisplay: isFailed ? 'FAILED' : (r.overallScore ?? 0),
      maxScore: r.maxScore ?? 100,
      gradeLabel: r.gradeLabel || '—',
      healthStatus: r.healthStatus || 'UNKNOWN',
      coverage: typeof r.requirementCoverage === 'number' ? `${r.requirementCoverage}%` : '0%',
      badges: badgeText || '—',
      status: r.evaluationStatus || 'COMPLETED',
    });
  });

  // ── Sheet 2: Criterion-wise Scores ─────────────────────────────────────────
  const sheet2 = workbook.addWorksheet('Criterion-wise Scores');
  const criteria = (session.rubricCriteria && session.rubricCriteria.length > 0)
    ? session.rubricCriteria
    : Array.from(new Set(results.flatMap((r) => {
        if (Array.isArray(r.criterionScores)) return r.criterionScores.map((c) => c?.name).filter(Boolean);
        if (r.criterionScores && typeof r.criterionScores === 'object') return Object.keys(r.criterionScores);
        return [];
      }))).map((name) => ({ name, title: name, maxScore: 10 }));

  const fixedCols2 = [
    { header: 'Identifier',        key: 'identifier',   width: 20 },
    { header: 'Team / Project',    key: 'teamName',     width: 24 },
    { header: 'Overall Score',     key: 'overallScore', width: 16 },
  ];
  const dynamicCritCols = criteria.map((c) => ({
    header: `${c.name || c.title}${c.maxScore ? ` (/${c.maxScore})` : ''}`,
    key: `crit_${c.name || c.title}`,
    width: 20,
  }));
  const feedbackCols2 = [
    { header: 'Overall Feedback',  key: 'feedback',     width: 50 },
  ];
  applyHeaderStyle(sheet2, [...fixedCols2, ...dynamicCritCols, ...feedbackCols2]);

  sorted.forEach((r) => {
    const row = {
      identifier: r.identifier || '—',
      teamName: r.teamName || r.repoName || '—',
      overallScore: r.overallScore ?? 0,
      feedback: r.feedback || '',
    };
    criteria.forEach((c) => {
      const critKey = `crit_${c.name || c.title}`;
      let scoreVal = '—';
      if (Array.isArray(r.criterionScores)) {
        const found = r.criterionScores.find((entry) => entry?.name === (c.name || c.title));
        if (found && typeof found.score === 'number') scoreVal = found.score;
      } else if (r.criterionScores && typeof r.criterionScores === 'object') {
        const entry = r.criterionScores[c.name || c.title];
        if (typeof entry === 'number') scoreVal = entry;
        else if (entry && typeof entry.score === 'number') scoreVal = entry.score;
      }
      row[critKey] = scoreVal;
    });
    sheet2.addRow(row);
  });

  // ── Sheet 3: Gap Analysis ──────────────────────────────────────────────────
  const sheet3 = workbook.addWorksheet('Gap Analysis');
  const cols3 = [
    { header: 'Identifier',            key: 'identifier',          width: 20 },
    { header: 'Team / Project',        key: 'teamName',            width: 24 },
    { header: 'Health Status',         key: 'healthStatus',        width: 16 },
    { header: 'Coverage (%)',          key: 'coverage',            width: 14 },
    { header: 'Missing Requirements',  key: 'missingRequirements', width: 40 },
    { header: 'Missing Concepts',      key: 'missingConcepts',     width: 36 },
    { header: 'Next Week Tasks',       key: 'nextWeekTasks',       width: 44 },
    { header: 'Strengths',             key: 'strengths',           width: 38 },
  ];
  applyHeaderStyle(sheet3, cols3);

  sorted.forEach((r) => {
    sheet3.addRow({
      identifier: r.identifier || '—',
      teamName: r.teamName || r.repoName || '—',
      healthStatus: r.healthStatus || 'UNKNOWN',
      coverage: typeof r.requirementCoverage === 'number' ? `${r.requirementCoverage}%` : '0%',
      missingRequirements: normalizeList(r.missingRequirements).join('; ') || 'None',
      missingConcepts: normalizeList(r.missingConcepts).join('; ') || 'None',
      nextWeekTasks: normalizeList(r.nextWeekTasks).join('; ') || 'None',
      strengths: normalizeList(r.strengths).join('; ') || 'None',
    });
  });

  // ── Sheet 4: Team Contribution ─────────────────────────────────────────────
  const sheet4 = workbook.addWorksheet('Team Contribution');
  const cols4 = [
    { header: 'Identifier',            key: 'identifier',       width: 20 },
    { header: 'Team / Project',        key: 'teamName',         width: 24 },
    { header: 'GitHub Repo',           key: 'repoUrl',          width: 36 },
    { header: 'Contributors & Commits',key: 'contributors',     width: 45 },
    { header: 'Stated Work Completed', key: 'workCompleted',    width: 45 },
    { header: 'Problems Faced',        key: 'problemsFaced',    width: 38 },
    { header: 'Planned Work',          key: 'plannedWork',      width: 38 },
    { header: 'Health Status',         key: 'healthStatus',     width: 16 },
  ];
  applyHeaderStyle(sheet4, cols4);

  sorted.forEach((r) => {
    const contributors = r.githubEvidence?.contributors || r.githubEvidence?.contributorStats || [];
    const contribStr = Array.isArray(contributors) && contributors.length > 0
      ? contributors.map((c) => `${c.login || c.name || 'User'} (${c.contributions || c.commits || 0})`).join(', ')
      : 'Repository analytics data attached';

    const weeklyClaims = r.weeklyClaims || {};
    const workCompleted = Array.isArray(weeklyClaims.workCompleted)
      ? weeklyClaims.workCompleted.join('; ')
      : (weeklyClaims.workCompleted || '—');
    const problemsFaced = Array.isArray(weeklyClaims.problemsFaced)
      ? weeklyClaims.problemsFaced.join('; ')
      : (weeklyClaims.problemsFaced || '—');
    const plannedWork = Array.isArray(weeklyClaims.plannedWork)
      ? weeklyClaims.plannedWork.join('; ')
      : (weeklyClaims.plannedWork || '—');

    sheet4.addRow({
      identifier: r.identifier || '—',
      teamName: r.teamName || r.repoName || '—',
      repoUrl: r.repoUrl || '—',
      contributors: contribStr,
      workCompleted,
      problemsFaced,
      plannedWork,
      healthStatus: r.healthStatus || 'UNKNOWN',
    });
  });

  // ── Sheet 5: Statistics ────────────────────────────────────────────────────
  const sheet5 = workbook.addWorksheet('Statistics');
  const cols5 = [
    { header: 'Metric / Indicator',    key: 'metric', width: 36 },
    { header: 'Value',                 key: 'value',  width: 24 },
    { header: 'Notes',                 key: 'notes',  width: 40 },
  ];
  applyHeaderStyle(sheet5, cols5);

  const completedResults = sorted.filter((r) => r.evaluationStatus === 'COMPLETED');
  const scores = completedResults.map((r) => r.overallScore).filter((s) => typeof s === 'number');
  const coverages = completedResults.map((r) => r.requirementCoverage).filter((c) => typeof c === 'number');

  const onTrackCount = completedResults.filter((r) => r.healthStatus === 'ON_TRACK').length;
  const atRiskCount = completedResults.filter((r) => r.healthStatus === 'AT_RISK').length;
  const behindCount = completedResults.filter((r) => r.healthStatus === 'BEHIND').length;

  const statsRows = [
    { metric: 'Total Projects in Session', value: results.length, notes: 'Total submitted or evaluated' },
    { metric: 'Successfully Evaluated',    value: completedResults.length, notes: 'Evaluations completed with score' },
    { metric: 'Failed Evaluations',        value: results.length - completedResults.length, notes: 'Encountered evaluation errors' },
    { metric: 'Average Overall Score',     value: scores.length ? avg(scores) : '—', notes: 'Out of total max score' },
    { metric: 'Highest Score',             value: scores.length ? Math.max(...scores) : '—', notes: 'Top scoring project' },
    { metric: 'Lowest Score',              value: scores.length ? Math.min(...scores) : '—', notes: 'Lowest scoring project' },
    { metric: 'Projects On Track',         value: onTrackCount, notes: 'High requirement coverage, no critical blockers' },
    { metric: 'Projects At Risk',          value: atRiskCount, notes: 'Moderate gaps identified in evidence' },
    { metric: 'Projects Behind',           value: behindCount, notes: 'Significant gaps or lack of repository evidence' },
    { metric: 'Average Requirement Coverage', value: coverages.length ? `${avg(coverages)}%` : '—', notes: 'Mean verified requirement coverage' },
    { metric: 'Generated At',              value: new Date().toLocaleString(), notes: 'Timestamp of report creation' },
  ];

  statsRows.forEach((row) => sheet5.addRow(row));

  return workbook.xlsx.writeBuffer();
}

// ─── Background Evaluation Worker ───────────────────────────────────────────
/**
 * Asynchronously processes each repository in the session by calling
 * the Python AI Microservice at POST /project-eval/single.
 * Updates MongoDB and broadcasts Socket.io events.
 */
async function runProjectEvaluationBackground(sessionId, io) {
  const room = `project_eval_session_${sessionId}`;

  try {
    const session = await ProjectEvalSession.findById(sessionId);
    if (!session) return;

    session.status = 'PARSING_RUBRIC';
    session.progressPercent = 10;
    await session.save();

    if (io) {
      io.to(room).emit('project_eval_progress', {
        sessionId,
        status: session.status,
        progressPercent: session.progressPercent,
        processedRepos: session.processedRepos,
        totalRepos: session.totalRepos,
      });
    }

    const repos = session.repoLinks || [];
    if (repos.length === 0) {
      session.status = 'COMPLETED';
      session.progressPercent = 100;
      await session.save();
      if (io) {
        io.to(room).emit('project_eval_completed', {
          sessionId,
          status: 'COMPLETED',
          results: [],
          processedRepos: 0,
          totalRepos: 0,
        });
      }
      return;
    }

    session.status = 'ANALYZING_REPOS';
    await session.save();

    const rubricInput = (session.rubricCriteria && session.rubricCriteria.length > 0)
      ? { criteria: session.rubricCriteria, totalMaxScore: session.totalMaxScore || 100 }
      : (session.projectGoal || 'Comprehensive project rubric');

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      const parsedRepo = parseRepoUrl(repo.url);
      const identifier = repo.identifier || parsedRepo.name || `project-${i + 1}`;
      const teamName = repo.teamName || parsedRepo.name || identifier;

      // Extract and validate studentIds if supplied
      const rawStudentIds = Array.isArray(repo.studentIds)
        ? repo.studentIds
        : repo.studentId
        ? [repo.studentId]
        : [];
      const validStudentIds = rawStudentIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      // Look up any submitted weekly progress report for this project/identifier
      let weeklyDoc = await ProjectWeeklyProgress.findOne({
        sessionId: session._id,
        identifier,
      }).sort({ createdAt: -1 });

      const weeklyReportText = weeklyDoc?.fileText || repo.weeklyReportText || null;
      const weeklyReportPath = weeklyDoc?.filePath || repo.weeklyReportPath || null;

      try {
        // Call Python AI Service single evaluation endpoint
        const aiResponse = await axios.post(
          `${AI_BASE}/project-eval/single`,
          {
            projectGoal: session.projectGoal || '',
            rubric: rubricInput,
            githubUrl: repo.url,
            weeklyReport: weeklyReportText || null,
            weeklyReportPath: weeklyReportPath || null,
            projectId: identifier,
          },
          { timeout: 180000 }
        );

        const aiData = aiResponse.data || {};
        const success = aiData.success !== false;

        // Backward-compatible criterionScores resolution
        const criterionScores =
          aiData.criterionScores ||
          aiData.criteria ||
          [];

        // Calculate overall score from criteria if not explicit
        let calculatedScore = 0;
        if (Array.isArray(criterionScores)) {
          calculatedScore = criterionScores.reduce((sum, c) => sum + (Number(c.score) || 0), 0);
        }
        const overallScore = success
          ? (typeof aiData.overallScore === 'number' ? aiData.overallScore : calculatedScore)
          : null;

        const maxScore = session.totalMaxScore || 100;
        const gradeLabel = success ? calculateGrade(overallScore, maxScore) : '';
        const healthStatus =
          aiData.evidence?.healthStatus ||
          aiData.evidence?.health_status ||
          (success ? 'ON_TRACK' : 'BEHIND');
        const requirementCoverage = safeNumberOrNull(aiData.evidence?.coverage) ?? 0;

        const savedResult = await ProjectEvalResult.create({
          sessionId: session._id,
          identifier,
          teamName,
          studentIds: validStudentIds,
          repoUrl: repo.url,
          repoOwner: parsedRepo.owner,
          repoName: parsedRepo.name,
          overallScore: overallScore ?? 0,
          maxScore,
          gradeLabel,
          healthStatus,
          criterionScores,
          requirementCoverage,
          codeQuality: aiData.githubAnalysis?.codeMetrics || {},
          architecture: aiData.githubAnalysis?.architecture || {},
          testing: aiData.githubAnalysis?.testing || {},
          documentation: aiData.githubAnalysis?.documentation || {},
          projectProgress: aiData.weeklyReport || {},
          techCompliance: aiData.githubAnalysis?.techCompliance || {},
          missingRequirements: normalizeList(
            aiData.missingRequirements ||
            (Array.isArray(aiData.evidence?.missingRequirements) ? aiData.evidence.missingRequirements : [])
          ),
          missingConcepts: normalizeList(aiData.missingConcepts),
          strengths: normalizeList(aiData.strengths),
          feedback: aiData.feedback || '',
          nextWeekTasks: normalizeList(aiData.nextWeekTasks),
          githubEvidence: {
            analysis: aiData.githubAnalysis || {},
            evidence: aiData.evidence || {},
          },
          weeklyClaims: aiData.weeklyReport || {},
          scoreHistory: [
            {
              weekLabel: 'Initial Evaluation',
              score: overallScore ?? 0,
              evaluatedAt: new Date(),
            },
          ],
          badges: aiData.badges || [],
          evaluationStatus: success ? 'COMPLETED' : 'FAILED',
          errorMessage: aiData.error || '',
          evaluatedAt: new Date(),
        });

        // Mark weekly progress doc as processed if one was matched
        if (weeklyDoc) {
          weeklyDoc.resultId = savedResult._id;
          weeklyDoc.processed = true;
          weeklyDoc.parsedReport = aiData.weeklyReport || {};
          await weeklyDoc.save();
        }

        session.processedRepos += 1;
        session.progressPercent = Math.min(
          95,
          Math.round((session.processedRepos / session.totalRepos) * 90) + 5
        );
        await session.save();

        if (io) {
          io.to(room).emit('project_eval_progress', {
            sessionId,
            status: session.status,
            progressPercent: session.progressPercent,
            processedRepos: session.processedRepos,
            totalRepos: session.totalRepos,
            latestResult: {
              _id: savedResult._id,
              identifier: savedResult.identifier,
              teamName: savedResult.teamName,
              repoUrl: savedResult.repoUrl,
              overallScore: savedResult.overallScore,
              maxScore: savedResult.maxScore,
              gradeLabel: savedResult.gradeLabel,
              healthStatus: savedResult.healthStatus,
              requirementCoverage: savedResult.requirementCoverage,
              evaluationStatus: savedResult.evaluationStatus,
              criterionScores: savedResult.criterionScores,
              feedback: savedResult.feedback,
            },
          });
        }
      } catch (repoErr) {
        console.error(`[ProjectEval] Error evaluating ${repo.url}:`, repoErr.response?.data || repoErr.message);

        const failedResult = await ProjectEvalResult.create({
          sessionId: session._id,
          identifier,
          teamName,
          repoUrl: repo.url,
          repoOwner: parsedRepo.owner,
          repoName: parsedRepo.name,
          overallScore: 0,
          maxScore: session.totalMaxScore || 100,
          gradeLabel: 'F',
          healthStatus: 'BEHIND',
          evaluationStatus: 'FAILED',
          errorMessage: repoErr.response?.data?.detail || repoErr.message,
          evaluatedAt: new Date(),
        });

        session.processedRepos += 1;
        session.progressPercent = Math.min(
          95,
          Math.round((session.processedRepos / session.totalRepos) * 90) + 5
        );
        await session.save();

        if (io) {
          io.to(room).emit('project_eval_progress', {
            sessionId,
            status: session.status,
            progressPercent: session.progressPercent,
            processedRepos: session.processedRepos,
            totalRepos: session.totalRepos,
            latestResult: {
              _id: failedResult._id,
              identifier: failedResult.identifier,
              teamName: failedResult.teamName,
              repoUrl: failedResult.repoUrl,
              overallScore: 0,
              healthStatus: 'BEHIND',
              evaluationStatus: 'FAILED',
              errorMessage: failedResult.errorMessage,
            },
          });
        }
      }
    }

    // Complete session
    const finalResults = await ProjectEvalResult.find({ sessionId }).sort({ overallScore: -1 });
    session.status = 'COMPLETED';
    session.progressPercent = 100;
    await session.save();

    if (io) {
      io.to(room).emit('project_eval_completed', {
        sessionId,
        status: 'COMPLETED',
        results: finalResults,
        processedRepos: session.processedRepos,
        totalRepos: session.totalRepos,
      });

      // Emit project leaderboard ready
      try {
        const { ranked, total } = buildProjectLeaderboard(finalResults, session.rubricCriteria || []);
        io.to(room).emit('project_leaderboard_ready', {
          sessionId,
          leaderboard: ranked,
          totalEvaluated: total,
        });
      } catch (lbErr) {
        console.error('[ProjectEval] Leaderboard emission failed:', lbErr.message);
      }
    }

    // Auto-generate and archive 5-sheet Excel report
    try {
      const reportBuffer = await generateProjectExcelReport(session, finalResults);
      const courseFolder = session.courseId ? session.courseId.toString() : 'general';
      const reportDir = path.join(__dirname, '..', 'reports', 'projects', courseFolder);
      fs.mkdirSync(reportDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `ProjectEval_${sanitizeFilename(session.sessionLabel || 'session')}_${timestamp}.xlsx`;
      const filePath = path.join(reportDir, fileName);
      fs.writeFileSync(filePath, reportBuffer);

      await ProjectEvalReport.create({
        sessionId: session._id,
        courseId: session.courseId,
        professorId: session.professorId,
        sessionLabel: session.sessionLabel || 'Project Evaluation',
        courseCode: '',
        filePath,
        fileName,
        repoCount: finalResults.length,
        averageScore: avg(finalResults.map((r) => r.overallScore)),
      });
      console.log('[ProjectEval] Auto-report saved successfully:', fileName);
    } catch (reportErr) {
      console.error('[ProjectEval] Auto-report generation failed (non-blocking):', reportErr.message);
    }
  } catch (err) {
    console.error('[ProjectEval] Fatal error in background runner:', err);
    await ProjectEvalSession.findByIdAndUpdate(sessionId, {
      status: 'FAILED',
      'failureMetadata.errorMessage': err.message,
      'failureMetadata.failedStage': 'EXECUTION',
    });

    if (io) {
      io.to(room).emit('project_eval_failed', {
        sessionId,
        status: 'FAILED',
        error: err.message,
      });
    }
  }
}

// ─── Controller Endpoints ───────────────────────────────────────────────────

// POST /api/project-eval/start
exports.startProjectEvalSession = async (req, res, next) => {
  try {
    const professorId = req.user._id || req.user.id;
    const {
      courseId,
      sessionLabel,
      projectGoal,
      projectType,
      mode,
      rubricCriteria,
      totalMaxScore,
      techRequirements,
      milestones,
      repoLinks,
    } = req.body;

    // Parse repository links
    let parsedRepos = [];
    if (Array.isArray(repoLinks)) {
      parsedRepos = repoLinks;
    } else if (typeof repoLinks === 'string') {
      try {
        parsedRepos = JSON.parse(repoLinks);
      } catch {
        // Fallback: parse newline or comma separated URLs
        parsedRepos = repoLinks
          .split(/[\n,]/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((url) => ({ url, identifier: '', teamName: '' }));
      }
    }

    if (!Array.isArray(parsedRepos) || parsedRepos.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one repository link is required to start evaluation.',
      });
    }

    // Parse rubric criteria
    let parsedCriteria = [];
    if (Array.isArray(rubricCriteria)) {
      parsedCriteria = rubricCriteria;
    } else if (typeof rubricCriteria === 'string' && rubricCriteria.trim()) {
      try {
        parsedCriteria = JSON.parse(rubricCriteria);
      } catch {
        parsedCriteria = [{ name: 'Overall Project', title: 'Overall Project', maxScore: 100, description: rubricCriteria }];
      }
    }

    // Parse tech requirements
    let parsedTech = [];
    if (Array.isArray(techRequirements)) {
      parsedTech = techRequirements;
    } else if (typeof techRequirements === 'string' && techRequirements.trim()) {
      try {
        parsedTech = JSON.parse(techRequirements);
      } catch {
        parsedTech = techRequirements.split(',').map((t) => t.trim()).filter(Boolean);
      }
    }

    // Parse milestones
    let parsedMilestones = [];
    if (Array.isArray(milestones)) {
      parsedMilestones = milestones;
    } else if (typeof milestones === 'string' && milestones.trim()) {
      try {
        parsedMilestones = JSON.parse(milestones);
      } catch {}
    }

    const normalizedCourseId = await resolveCourseId(courseId);

    // Rubric file path if uploaded
    let rubricPath = '';
    if (req.files && req.files.rubric && req.files.rubric[0]) {
      rubricPath = req.files.rubric[0].path;
    }

    const session = await ProjectEvalSession.create({
      professorId,
      courseId: normalizedCourseId,
      sessionLabel: sessionLabel || 'Project Evaluation',
      projectGoal: projectGoal || '',
      projectType: ['individual', 'team'].includes(projectType) ? projectType : 'individual',
      mode: ['batch', 'individual'].includes(mode) ? mode : 'batch',
      rubricPath,
      rubricCriteria: parsedCriteria,
      totalMaxScore: Number(totalMaxScore) || 100,
      techRequirements: parsedTech,
      milestones: parsedMilestones,
      repoLinks: parsedRepos,
      totalRepos: parsedRepos.length,
      processedRepos: 0,
      progressPercent: 0,
      status: 'UPLOADED',
    });

    const io = req.app.get('io');

    // Run evaluation in background asynchronously
    setImmediate(() => {
      runProjectEvaluationBackground(session._id, io);
    });

    return res.status(202).json({
      success: true,
      sessionId: session._id,
      message: 'Project evaluation session started successfully.',
      totalRepos: parsedRepos.length,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/project-eval/:sessionId/results
exports.getSessionResults = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await ProjectEvalSession.findById(sessionId).lean();
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const results = await ProjectEvalResult.find({ sessionId }).sort({ overallScore: -1 }).lean();

    return res.status(200).json({
      success: true,
      session,
      results,
      totalRepos: session.totalRepos,
      processedRepos: session.processedRepos,
      progressPercent: session.progressPercent,
      status: session.status,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/project-eval/:sessionId/result/:resultId
exports.getSingleProjectResult = async (req, res, next) => {
  try {
    const { sessionId, resultId } = req.params;

    const result = await ProjectEvalResult.findOne({ _id: resultId, sessionId }).lean();
    if (!result) {
      return res.status(404).json({ success: false, message: 'Project result not found' });
    }

    return res.status(200).json({ success: true, result });
  } catch (error) {
    next(error);
  }
};

// POST /api/project-eval/:sessionId/result/:resultId/re-eval
exports.triggerSingleProjectEval = async (req, res, next) => {
  try {
    const { sessionId, resultId } = req.params;

    const session = await ProjectEvalSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const result = await ProjectEvalResult.findOne({ _id: resultId, sessionId });
    if (!result) {
      return res.status(404).json({ success: false, message: 'Project result not found' });
    }

    // Look up weekly progress report if available
    const weeklyDoc = await ProjectWeeklyProgress.findOne({
      sessionId: session._id,
      identifier: result.identifier,
    }).sort({ createdAt: -1 });

    const rubricInput = (session.rubricCriteria && session.rubricCriteria.length > 0)
      ? { criteria: session.rubricCriteria, totalMaxScore: session.totalMaxScore || 100 }
      : (session.projectGoal || 'Comprehensive project rubric');

    const aiResponse = await axios.post(
      `${AI_BASE}/project-eval/single`,
      {
        projectGoal: session.projectGoal || '',
        rubric: rubricInput,
        githubUrl: result.repoUrl,
        weeklyReport: weeklyDoc?.fileText || null,
        weeklyReportPath: weeklyDoc?.filePath || null,
        projectId: result.identifier,
      },
      { timeout: 180000 }
    );

    const aiData = aiResponse.data || {};
    const success = aiData.success !== false;

    const criterionScores =
      aiData.criterionScores ||
      aiData.criteria ||
      [];

    let calculatedScore = 0;
    if (Array.isArray(criterionScores)) {
      calculatedScore = criterionScores.reduce((sum, c) => sum + (Number(c.score) || 0), 0);
    }
    const overallScore = success
      ? (typeof aiData.overallScore === 'number' ? aiData.overallScore : calculatedScore)
      : 0;

    const maxScore = session.totalMaxScore || 100;

    result.overallScore = overallScore;
    result.gradeLabel = success ? calculateGrade(overallScore, maxScore) : 'F';
    result.healthStatus =
      aiData.evidence?.healthStatus ||
      aiData.evidence?.health_status ||
      (success ? 'ON_TRACK' : 'BEHIND');
    result.requirementCoverage = safeNumberOrNull(aiData.evidence?.coverage) ?? 0;
    result.criterionScores = criterionScores;
    result.missingRequirements = normalizeList(
      aiData.missingRequirements ||
      (Array.isArray(aiData.evidence?.missingRequirements) ? aiData.evidence.missingRequirements : [])
    );
    result.missingConcepts = normalizeList(aiData.missingConcepts);
    result.strengths = normalizeList(aiData.strengths);
    result.feedback = aiData.feedback || '';
    result.nextWeekTasks = normalizeList(aiData.nextWeekTasks);
    result.githubEvidence = {
      analysis: aiData.githubAnalysis || {},
      evidence: aiData.evidence || {},
    };
    result.weeklyClaims = aiData.weeklyReport || {};
    result.evaluationStatus = success ? 'COMPLETED' : 'FAILED';
    result.errorMessage = aiData.error || '';
    result.evaluatedAt = new Date();
    result.scoreHistory.push({
      weekLabel: 'Re-evaluation',
      score: overallScore,
      evaluatedAt: new Date(),
    });

    await result.save();

    // Broadcast update via socket
    const io = req.app.get('io');
    if (io) {
      const room = `project_eval_session_${sessionId}`;
      io.to(room).emit('project_eval_progress', {
        sessionId,
        status: session.status,
        latestResult: result,
      });
    }

    return res.status(200).json({ success: true, result });
  } catch (error) {
    next(error);
  }
};

// POST /api/project-eval/weekly-progress
exports.submitWeeklyProgress = async (req, res, next) => {
  try {
    const { sessionId, identifier, weekLabel, fileText, studentId } = req.body;

    if (!sessionId || !identifier) {
      return res.status(400).json({
        success: false,
        message: 'sessionId and identifier are required to record weekly progress.',
      });
    }

    let filePath = '';
    if (req.files && req.files.weeklyDoc && req.files.weeklyDoc[0]) {
      filePath = req.files.weeklyDoc[0].path;
    }

    let resultId = null;
    try {
      const matchedResult = await ProjectEvalResult.findOne({ sessionId, identifier }).select('_id').lean();
      if (matchedResult?._id) {
        resultId = matchedResult._id;
      }
    } catch {
      // Do not fail submission if lookup fails
    }

    const weeklyProgress = await ProjectWeeklyProgress.create({
      sessionId,
      resultId,
      identifier,
      studentId: studentId && mongoose.Types.ObjectId.isValid(studentId) ? new mongoose.Types.ObjectId(studentId) : null,
      weekLabel: weekLabel || 'Week 1',
      filePath,
      fileText: fileText || '',
      submittedAt: new Date(),
      processed: false,
    });

    return res.status(201).json({
      success: true,
      message: 'Weekly progress recorded successfully.',
      weeklyProgress,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/project-eval/course/:courseId/sessions
exports.listSessionsForCourse = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const userRole = req.user?.role || 'student';
    const isProfessor = userRole === 'professor';

    const query = {};

    if (isProfessor) {
      query.professorId = req.user._id || req.user.id;
    }

    if (courseId && courseId !== 'all') {
      const resolved = await resolveCourseId(courseId);
      if (resolved) query.courseId = resolved;
    } else if (!isProfessor) {
      return res.status(400).json({
        success: false,
        message: 'A valid courseId is required to list evaluation sessions for students.',
      });
    }

    const sessions = await ProjectEvalSession.find(query).sort({ createdAt: -1 }).lean();

    return res.status(200).json({ success: true, sessions });
  } catch (error) {
    next(error);
  }
};

// GET /api/project-eval/:sessionId/export
exports.exportSessionReport = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    const session = await ProjectEvalSession.findById(sessionId).lean();
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const results = await ProjectEvalResult.find({ sessionId }).sort({ overallScore: -1 }).lean();
    const buffer = await generateProjectExcelReport(session, results);

    const safeLabel = sanitizeFilename(session.sessionLabel || 'ProjectEval');
    const filename = `${safeLabel}_Report_${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
};

// GET /api/project-eval/course/:courseId/reports
exports.listCourseReports = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const professorId = req.user._id || req.user.id;

    const query = { professorId };
    if (courseId && courseId !== 'all') {
      const resolved = await resolveCourseId(courseId);
      if (resolved) query.courseId = resolved;
    }

    const reports = await ProjectEvalReport.find(query).sort({ generatedAt: -1 }).lean();

    return res.status(200).json({ success: true, reports });
  } catch (error) {
    next(error);
  }
};

// GET /api/project-eval/reports/:reportId/download
exports.downloadReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;

    const report = await ProjectEvalReport.findById(reportId).lean();
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    if (!fs.existsSync(report.filePath)) {
      return res.status(404).json({ success: false, message: 'Report file no longer exists on disk' });
    }

    return res.download(report.filePath, report.fileName);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/project-eval/:sessionId
exports.deleteSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const professorId = req.user._id || req.user.id;

    const session = await ProjectEvalSession.findOne({ _id: sessionId, professorId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found or not authorized' });
    }

    // Delete associated results and weekly progress
    await ProjectEvalResult.deleteMany({ sessionId: session._id });
    await ProjectWeeklyProgress.deleteMany({ sessionId: session._id });

    // Delete linked report records and files
    const linkedReports = await ProjectEvalReport.find({ sessionId: session._id });
    for (const report of linkedReports) {
      if (fs.existsSync(report.filePath)) {
        try { fs.unlinkSync(report.filePath); } catch {}
      }
      await report.deleteOne();
    }

    if (session.rubricPath && fs.existsSync(session.rubricPath)) {
      try { fs.unlinkSync(session.rubricPath); } catch {}
    }

    await session.deleteOne();

    return res.status(200).json({
      success: true,
      message: 'Project evaluation session and associated data deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/project-eval/reports/:reportId
exports.deleteReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const professorId = req.user._id || req.user.id;

    const report = await ProjectEvalReport.findOne({ _id: reportId, professorId });
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found or not authorized' });
    }

    if (fs.existsSync(report.filePath)) {
      try { fs.unlinkSync(report.filePath); } catch {}
    }

    await report.deleteOne();

    return res.status(200).json({ success: true, message: 'Report deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

exports.generateProjectExcelReport = generateProjectExcelReport;
exports.runProjectEvaluationBackground = runProjectEvaluationBackground;

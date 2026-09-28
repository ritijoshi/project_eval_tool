const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const ExcelJS = require('exceljs');

const Assignment = require('../models/Assignment');
const AssignmentSubmission = require('../models/AssignmentSubmission');
const AssignmentEvalSession = require('../models/AssignmentEvalSession');
const AssignmentStudentResult = require('../models/AssignmentStudentResult');
const AssignmentEvalReport = require('../models/AssignmentEvalReport');
const Course = require('../models/Course');
const { getAiServiceUrl } = require('../config/services');

const AI_BASE = getAiServiceUrl();

// Sanitise a string for safe use in a filesystem filename
const sanitizeFilename = (str) =>
  String(str || 'eval').replace(/[^a-z0-9_\-]/gi, '_').replace(/__+/g, '_').slice(0, 80);

const avg = (arr) => {
  const nums = arr.filter((n) => typeof n === 'number' && Number.isFinite(n));
  return nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 100) / 100 : null;
};

const normalizeList = (value) => Array.isArray(value) ? value : [];

const safeNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const safeSubmissionType = (value, fallback = 'text') => (
  ['text', 'code', 'mixed'].includes(value) ? value : fallback
);

const normalizeCriterionScore = (score, maxScore) => {
  const numericScore = Number(score ?? 0);
  const numericMax = Number(maxScore ?? 0);

  if (!Number.isFinite(numericScore)) return 0;
  if (numericMax > 0) return Number(((numericScore / numericMax) * 10).toFixed(1));
  if (numericScore <= 10) return Number(numericScore.toFixed(1));
  return Number(numericScore.toFixed(1));
};

const normalizeScoreBreakdown = (input) => {
  if (!input || typeof input !== 'object') return {};

  if (Array.isArray(input)) {
    return input.reduce((acc, entry) => {
      if (!entry || typeof entry !== 'object') return acc;
      const key = String(entry.name || entry.title || 'Criterion');
      acc[key] = {
        score: Number(entry.score ?? 0),
        maxScore: Number(entry.maxScore ?? entry.max_score ?? 0),
        reason: entry.reason || entry.feedback || '',
      };
      return acc;
    }, {});
  }

  return Object.entries(input).reduce((acc, [key, value]) => {
    if (!value || typeof value !== 'object') {
      acc[String(key)] = { score: Number(value ?? 0), maxScore: 0, reason: '' };
      return acc;
    }

    acc[String(key)] = {
      score: Number(value.score ?? 0),
      maxScore: Number(value.maxScore ?? value.max_score ?? 0),
      reason: value.reason || value.feedback || '',
    };
    return acc;
  }, {});
};

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toObjectIdOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized || normalized === 'null' || normalized === 'undefined') return null;
  return mongoose.Types.ObjectId.isValid(normalized) ? new mongoose.Types.ObjectId(normalized) : null;
};

const resolveCourseId = async (courseInput) => {
  const raw = String(courseInput ?? '').trim();
  if (!raw) return null;

  const objectId = toObjectIdOrNull(raw);
  if (objectId) return objectId;

  const Course = require('../models/Course');
  const course = await Course.findOne({
    $or: [
      { courseCode: raw.toUpperCase() },
      { courseCode: { $regex: `^${escapeRegExp(raw)}$`, $options: 'i' } },
      { title: { $regex: `^${escapeRegExp(raw)}$`, $options: 'i' } },
    ],
  }).select('_id').lean();

  return course?._id || null;
};

const resolveAssignmentId = async (assignmentInput) => {
  const raw = String(assignmentInput ?? '').trim();
  if (!raw) return null;

  const objectId = toObjectIdOrNull(raw);
  if (objectId) return objectId;

  const Assignment = require('../models/Assignment');
  const assignment = await Assignment.findOne({
    $or: [
      { title: { $regex: `^${escapeRegExp(raw)}$`, $options: 'i' } },
      { courseKey: { $regex: `^${escapeRegExp(raw)}$`, $options: 'i' } },
    ],
  }).select('_id').lean();

  return assignment?._id || null;
};

exports.startBatchEvalSession = async (req, res, next) => {
  try {
    const { courseId, assignmentId, sessionLabel, assignmentType } = req.body;
    const professorId = req.user?._id || req.user?.id;

    if (!professorId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!req.files || !req.files.rubric || !req.files.submissions) {
      return res.status(400).json({ success: false, message: 'Please upload a rubric file and a submissions ZIP.' });
    }

    // courseId is required; verify ownership
    if (!courseId) {
      return res.status(400).json({ success: false, message: 'courseId is required.' });
    }
    const normalizedCourseId = await resolveCourseId(courseId);
    if (!normalizedCourseId) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }
    const course = await Course.findOne({ _id: normalizedCourseId, professor: professorId }).lean();
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found or not owned by you.' });
    }

    const rubricFile = req.files.rubric[0];
    const submissionsZip = req.files.submissions[0];
    const normalizedAssignmentId = await resolveAssignmentId(assignmentId);
    const assignment = normalizedAssignmentId
      ? await Assignment.findById(normalizedAssignmentId).select('title description rubric extractedAssignmentText').lean()
      : null;

    const session = await AssignmentEvalSession.create({
      professorId,
      assignmentId: normalizedAssignmentId,
      courseId: normalizedCourseId,
      rubricPath: rubricFile.path,
      submissionsZipPath: submissionsZip.path,
      assignmentType: ['text', 'code', 'mixed'].includes((assignmentType || '').toLowerCase())
        ? assignmentType.toLowerCase()
        : 'text',
      sessionLabel: sessionLabel || 'Assignment Evaluation',
      assignmentTitle: assignment?.title || sessionLabel || 'Assignment Evaluation',
      courseCode: course.courseCode || '',
      status: 'UPLOADED',
    });

    const backendBase = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

    axios.post(`${AI_BASE}/eval/batch-assignment`, {
      sessionId: String(session._id),
      rubricPath: rubricFile.path,
      submissionsZipPath: submissionsZip.path,
      assignmentType: session.assignmentType,
      assignmentQuestion: assignment
        ? [assignment.title, assignment.description].filter(Boolean).join('\n\n')
        : '',
      modelAnswer: assignment?.extractedAssignmentText || '',
      webhookUrl: `${backendBase}/api/assignment-eval/webhook`,
    }).catch((err) => {
      console.error('Failed to trigger assignment AI batch eval:', err.response?.data || err.message);
      AssignmentEvalSession.findByIdAndUpdate(session._id, {
        status: 'FAILED',
        'failureMetadata.errorMessage': 'Could not reach AI service',
        'failureMetadata.failedStage': 'QUEUE',
      }).exec();
    });

    return res.status(202).json({
      success: true,
      sessionId: session._id,
      message: 'Assignment evaluation job queued successfully',
    });
  } catch (error) {
    next(error);
  }
};

exports.handleAssignmentWebhook = async (req, res, next) => {
  try {
    const { sessionId, status, processedStudents, totalStudents, progressPercent, latestResult, errorInfo, results } = req.body;

    const session = await AssignmentEvalSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Assignment evaluation session not found' });
    }

    const incomingStatus = status || session.status;
    if (!['COMPLETED', 'FAILED'].includes(incomingStatus)) {
      session.status = incomingStatus;
    }
    if (typeof totalStudents === 'number') session.totalStudents = totalStudents;
    if (typeof processedStudents === 'number') session.processedStudents = processedStudents;
    if (typeof progressPercent === 'number') session.progressPercent = progressPercent;

    if (errorInfo) {
      session.failureMetadata = session.failureMetadata || {};
      session.failureMetadata.errorMessage = errorInfo.message || session.failureMetadata.errorMessage || '';
      session.failureMetadata.failedStage = errorInfo.stage || session.failureMetadata.failedStage || '';
    }

    await session.save();

    let savedResult = null;
    if (latestResult) {
      const normalizedBreakdown = normalizeScoreBreakdown(latestResult.scoreBreakdown || latestResult.aiEvaluation?.scoreBreakdown || {});
      const overallScore = latestResult.success === false
        ? null
        : safeNumberOrNull(latestResult.overallScore ?? latestResult.score ?? latestResult.aiEvaluation?.overallScore ?? 0);
      const aiConfidence = safeNumberOrNull(latestResult.confidence ?? latestResult.aiEvaluation?.confidence ?? latestResult.overallConfidence);

      savedResult = await AssignmentStudentResult.create({
        sessionId: session._id,
        studentName: latestResult.studentName || 'Unknown',
        rollNumber: latestResult.rollNumber || latestResult.rollNo || 'UNKNOWN',
        submissionType: safeSubmissionType(latestResult.submissionType, session.assignmentType || 'text'),
        submissionContent: latestResult.submissionContent || latestResult.summaryText || '',
        evaluationStatus: latestResult.success === false ? 'FAILED' : 'COMPLETED',
        score: overallScore,
        overallScore,
        maxScore: latestResult.success === false ? null : Number(latestResult.maxScore ?? latestResult.max_score ?? latestResult.aiEvaluation?.maxScore ?? 100),
        confidence: aiConfidence,
        gradeLabel: latestResult.gradeLabel || '',
        scoreBreakdown: normalizedBreakdown,
        requiredConcepts: normalizeList(latestResult.requiredConcepts || latestResult.required_concepts || latestResult.aiEvaluation?.requiredConcepts),
        strengths: normalizeList(latestResult.strengths || latestResult.aiEvaluation?.strengths),
        mistakes: normalizeList(latestResult.mistakes || latestResult.aiEvaluation?.mistakes),
        weakAreas: normalizeList(latestResult.weakAreas || latestResult.weak_areas || latestResult.aiEvaluation?.weakAreas),
        missingConcepts: normalizeList(latestResult.missingConcepts || latestResult.missing_concepts || latestResult.aiEvaluation?.missingConcepts),
        missingKeyPoints: normalizeList(latestResult.missingKeyPoints || latestResult.missing_key_points || latestResult.aiEvaluation?.missingKeyPoints),
        expectedConcepts: normalizeList(latestResult.expectedConcepts || latestResult.expected_concepts || latestResult.aiEvaluation?.expectedConcepts),
        conceptsCovered: normalizeList(latestResult.conceptsCovered || latestResult.concepts_covered || latestResult.aiEvaluation?.conceptsCovered),
        improvementSuggestions: normalizeList(latestResult.improvementSuggestions || latestResult.improvement_suggestions || latestResult.aiEvaluation?.improvementSuggestions),
        improvements: normalizeList(latestResult.improvements || latestResult.improvementSuggestions || latestResult.improvement_suggestions || latestResult.aiEvaluation?.improvements),
        overallFeedback: latestResult.overallFeedback || latestResult.feedback || latestResult.aiEvaluation?.overallFeedback || '',
        summaryInsights: latestResult.summaryInsights || latestResult.summary || latestResult.aiEvaluation?.summaryInsights || '',
        scoreExplanation: latestResult.scoreExplanation || latestResult.score_explanation || latestResult.aiEvaluation?.scoreExplanation || '',
        fileName: latestResult.fileName || latestResult.file_name || '',
        errorMessage: latestResult.errorMessage || '',
        evaluatedAt: new Date(),
      });

      const count = await AssignmentStudentResult.countDocuments({ sessionId: session._id });
      if (count !== session.processedStudents) {
        session.processedStudents = count;
        if (session.totalStudents > 0) {
          session.progressPercent = Math.min(100, Math.round((count / session.totalStudents) * 100));
        }
        await session.save();
      }
    }

    if (Array.isArray(results) && results.length > 0) {
      const ops = results.map((result) => {
        const normalizedBreakdown = normalizeScoreBreakdown(result.scoreBreakdown || result.aiEvaluation?.scoreBreakdown || {});
        const overallScore = result.success === false
          ? null
          : safeNumberOrNull(result.overallScore ?? result.score ?? result.aiEvaluation?.overallScore ?? 0);
        const aiConfidence = safeNumberOrNull(result.confidence ?? result.aiEvaluation?.confidence ?? result.overallConfidence);
        return {
          updateOne: {
            filter: { sessionId: session._id, rollNumber: result.rollNumber || result.rollNo || 'UNKNOWN', studentName: result.studentName || 'Unknown' },
            update: {
              $set: {
                studentName: result.studentName || 'Unknown',
                rollNumber: result.rollNumber || result.rollNo || 'UNKNOWN',
                submissionType: safeSubmissionType(result.submissionType, session.assignmentType || 'text'),
                submissionContent: result.submissionContent || result.summaryText || '',
                evaluationStatus: result.success === false ? 'FAILED' : 'COMPLETED',
                score: overallScore,
                overallScore,
                maxScore: result.success === false ? null : Number(result.maxScore ?? result.max_score ?? result.aiEvaluation?.maxScore ?? 100),
                confidence: aiConfidence,
                gradeLabel: result.gradeLabel || '',
                scoreBreakdown: normalizedBreakdown,
                requiredConcepts: normalizeList(result.requiredConcepts || result.required_concepts || result.aiEvaluation?.requiredConcepts),
                strengths: normalizeList(result.strengths || result.aiEvaluation?.strengths),
                mistakes: normalizeList(result.mistakes || result.aiEvaluation?.mistakes),
                weakAreas: normalizeList(result.weakAreas || result.weak_areas || result.aiEvaluation?.weakAreas),
                missingConcepts: normalizeList(result.missingConcepts || result.missing_concepts || result.aiEvaluation?.missingConcepts),
                missingKeyPoints: normalizeList(result.missingKeyPoints || result.missing_key_points || result.aiEvaluation?.missingKeyPoints),
                expectedConcepts: normalizeList(result.expectedConcepts || result.expected_concepts || result.aiEvaluation?.expectedConcepts),
                conceptsCovered: normalizeList(result.conceptsCovered || result.concepts_covered || result.aiEvaluation?.conceptsCovered),
                improvementSuggestions: normalizeList(result.improvementSuggestions || result.improvement_suggestions || result.aiEvaluation?.improvementSuggestions),
                improvements: normalizeList(result.improvements || result.improvementSuggestions || result.improvement_suggestions || result.aiEvaluation?.improvements),
                overallFeedback: result.overallFeedback || result.feedback || result.aiEvaluation?.overallFeedback || '',
                summaryInsights: result.summaryInsights || result.summary || result.aiEvaluation?.summaryInsights || '',
                scoreExplanation: result.scoreExplanation || result.score_explanation || result.aiEvaluation?.scoreExplanation || '',
                fileName: result.fileName || result.file_name || '',
                errorMessage: result.errorMessage || '',
                evaluatedAt: new Date(),
              },
            },
            upsert: true,
          },
        };
      });

      await AssignmentStudentResult.bulkWrite(ops, { ordered: false });
      session.processedStudents = await AssignmentStudentResult.countDocuments({ sessionId: session._id });
      if (session.totalStudents > 0) {
        session.progressPercent = Math.min(100, Math.round((session.processedStudents / session.totalStudents) * 100));
      }
      await session.save();
    }

    // Snapshot rubricCriteria from rubricPackage when first available
    if (req.body.rubricPackage?.criteria && session.rubricCriteria?.length === 0) {
      session.rubricCriteria = req.body.rubricPackage.criteria;
      await session.save();
    }

    if (['COMPLETED', 'FAILED'].includes(incomingStatus)) {
      session.status = incomingStatus;
      await session.save();
    }

    const io = req.app.get('io');
    if (io) {
      const room = `assignment_eval_session_${sessionId}`;
      io.to(room).emit('assignment_eval_progress', {
        sessionId,
        status: session.status,
        progressPercent: session.progressPercent,
        processedStudents: session.processedStudents,
        totalStudents: session.totalStudents,
        latestResult: savedResult ? {
          _id: savedResult._id,
          studentName: savedResult.studentName,
          rollNumber: savedResult.rollNumber,
          score: savedResult.score,
          maxScore: savedResult.maxScore,
          gradeLabel: savedResult.gradeLabel,
          scoreBreakdown: savedResult.scoreBreakdown,
          overallFeedback: savedResult.overallFeedback,
          evaluationStatus: savedResult.evaluationStatus,
        } : null,
      });

      if (incomingStatus === 'COMPLETED' || incomingStatus === 'FAILED') {
        session.processedStudents = await AssignmentStudentResult.countDocuments({ sessionId: session._id });
        session.progressPercent = incomingStatus === 'COMPLETED' ? 100 : session.progressPercent;
        await session.save();

        const finalResults = await AssignmentStudentResult.find({ sessionId }).sort({ evaluatedAt: -1 });

        io.to(room).emit('assignment_eval_completed', {
          sessionId,
          status: incomingStatus,
          results: finalResults,
          processedStudents: session.processedStudents,
          totalStudents: session.totalStudents,
        });

        // Auto-generate and persist the Excel report (non-blocking)
        if (incomingStatus === 'COMPLETED' && session.courseId) {
          try {
            const reportBuffer = await generateExcelReport(session, finalResults);
            const reportDir = path.join(__dirname, '..', 'reports', 'assignments', session.courseId.toString());
            fs.mkdirSync(reportDir, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const fileName = `${sanitizeFilename(session.courseCode)}_${sanitizeFilename(session.assignmentTitle)}_${timestamp}.xlsx`;
            const filePath = path.join(reportDir, fileName);
            fs.writeFileSync(filePath, reportBuffer);
            await AssignmentEvalReport.create({
              sessionId: session._id,
              courseId: session.courseId,
              professorId: session.professorId,
              assignmentId: session.assignmentId,
              assignmentTitle: session.assignmentTitle,
              courseCode: session.courseCode,
              filePath,
              fileName,
              studentCount: finalResults.length,
              averageScore: avg(finalResults.map((r) => r.score).filter((s) => s !== null)),
            });
            console.log('[AssignmentEval] Report saved:', fileName);
          } catch (reportErr) {
            console.error('[AssignmentEval] Auto-report generation failed (non-blocking):', reportErr.message);
          }
        }

        // Emit leaderboard on completion (non-blocking)
        if (incomingStatus === 'COMPLETED') {
          try {
            const { buildAssignmentLeaderboard } = require('./assignmentLeaderboardController');
            const { ranked, total } = buildAssignmentLeaderboard(finalResults, session.rubricCriteria || []);
            io.to(room).emit('assignment_leaderboard_ready', {
              sessionId,
              leaderboard: ranked,
              totalEvaluated: total,
            });
          } catch (lbErr) {
            console.error('[AssignmentEval] Leaderboard emit failed:', lbErr.message);
          }
        }
      }
    }

    return res.status(200).json({ success: true, message: 'Assignment evaluation progress recorded' });
  } catch (error) {
    console.error('Assignment webhook error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.triggerSingleEval = async (req, res, next) => {
  try {
    const { submissionId } = req.params;
    const { assignmentId } = req.body || {};

    const submission = await AssignmentSubmission.findById(submissionId).populate('assignment');
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    const assignment = submission.assignment || (assignmentId ? await Assignment.findById(assignmentId) : null);
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    const submissionText = String(submission.extractedSubmissionText || submission.submissionText || '').trim();
    const rubricText = String(assignment.rubric || assignment.extractedAssignmentText || '').trim();

    const payload = {
      submissionId: String(submission._id),
      studentText: submissionText || 'No extracted submission text available',
      assignmentType: 'text',
      rubricPackage: {
        rubricText,
        assignmentQuestion: [assignment.title, assignment.description].filter(Boolean).join('\n\n'),
        modelAnswer: assignment.extractedAssignmentText || '',
      },
      webhookUrl: '',
    };

    const response = await axios.post(`${AI_BASE}/eval/single-assignment`, payload, { timeout: 30000 });
    const result = response.data?.result || response.data || {};

    const normalized = {
      totalScore: Number(result.totalScore ?? result.score ?? 0),
      maxScore: Number(result.maxScore ?? result.max_score ?? 100),
      gradeLabel: result.gradeLabel || result.grade_label || '',
      isRelevant: !!result.isRelevant,
      isIncomplete: !!result.isIncomplete,
      scoreBreakdown: {
        correctness: Number(result.scoreBreakdown?.correctness ?? result.correctness ?? 0),
        topicUnderstanding: Number(result.scoreBreakdown?.topicUnderstanding ?? result.topic_understanding ?? 0),
        completeness: Number(result.scoreBreakdown?.completeness ?? 0),
        technicalAccuracy: Number(result.scoreBreakdown?.technicalAccuracy ?? result.technical_accuracy ?? 0),
      },
      strengths: Array.isArray(result.strengths) ? result.strengths : [],
      mistakes: Array.isArray(result.mistakes) ? result.mistakes : [],
      missingConcepts: Array.isArray(result.missingConcepts) ? result.missingConcepts : [],
      improvementSuggestions: Array.isArray(result.improvementSuggestions) ? result.improvementSuggestions : [],
      summary: result.overallFeedback || result.summary || '',
      detailedFeedback: result.overallFeedback || result.summary || '',
      raw: result,
      generatedAt: new Date(),
    };

    submission.aiEvaluation = normalized;
    submission.gradingStatus = 'completed';
    submission.evaluatedAt = new Date();
    submission.lastUpdatedAt = new Date();
    await submission.save();

    return res.status(200).json({ success: true, result: normalized });
  } catch (error) {
    console.error('Single assignment evaluation failed:', error.response?.data || error.message);
    return res.status(500).json({ success: false, message: error.response?.data?.detail || error.message });
  }
};

exports.getSessionResults = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await AssignmentEvalSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Assignment evaluation session not found' });
    }

    // Professor ownership check
    if (req.user && session.professorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this session' });
    }

    const results = await AssignmentStudentResult.find({ sessionId }).sort({ evaluatedAt: -1 });
    console.log('[AssignmentEval] results fetched', {
      sessionId,
      sessionStatus: session.status,
      processedStudents: session.processedStudents,
      resultCount: results.length,
    });
    return res.status(200).json({ success: true, session, results });
  } catch (error) {
    next(error);
  }
};

// GET /api/assignment-eval/course/:courseId/sessions
exports.listSessionsForCourse = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const professorId = req.user._id;
    const sessions = await AssignmentEvalSession.find({ courseId, professorId })
      .sort({ createdAt: -1 })
      .populate('assignmentId', 'title deadline')
      .lean();
    return res.status(200).json({ success: true, sessions });
  } catch (error) {
    next(error);
  }
};

/**
 * Core Excel report builder — single flat sheet, one row per student.
 * All data (identity, scores, rubric criteria, feedback) is in one place.
 * A summary block is appended at the bottom separated by a blank row.
 * @returns {Promise<Buffer>}
 */
async function generateExcelReport(session, results) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI Assignment Evaluator';
  workbook.created = new Date();

  // Build dynamic criteria list
  const criteria = (session.rubricCriteria && session.rubricCriteria.length > 0)
    ? session.rubricCriteria
    : Array.from(new Set(results.flatMap((r) => Object.keys(r.scoreBreakdown || {}))))
        .map((t) => ({ title: t, maxScore: 0 }));

  // ── Single sheet ──────────────────────────────────────────────────────────
  const sheet = workbook.addWorksheet('Evaluation Results');

  // Fixed columns first, then one column per criterion, then feedback columns
  const fixedCols = [
    { header: 'Student Name',        key: 'studentName',    width: 24 },
    { header: 'Submission Type',     key: 'submissionType', width: 16 },
    { header: 'Overall Score',       key: 'scoreDisplay',   width: 16 },
    { header: 'Grade',               key: 'gradeLabel',     width: 10 },
    { header: 'Confidence',          key: 'confidence',     width: 12 },
    { header: 'Status',              key: 'status',         width: 14 },
  ];

  const criterionCols = criteria.map((c) => ({
    header: c.title + (c.maxScore > 0 ? ` (/${c.maxScore})` : ''),
    key: `crit_${c.title}`,
    width: 18,
  }));

  const feedbackCols = [
    { header: 'Strengths',               key: 'strengths',            width: 36 },
    { header: 'Mistakes',                key: 'mistakes',             width: 36 },
    { header: 'Weak Areas',              key: 'weakAreas',            width: 32 },
    { header: 'Missing Concepts',        key: 'missingConcepts',      width: 34 },
    { header: 'Detailed Feedback',       key: 'overallFeedback',      width: 52 },
  ];

  sheet.columns = [...fixedCols, ...criterionCols, ...feedbackCols];

  // Keep the report light and readable when opened in Excel or previewed elsewhere.
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FF1F2937' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    };
  });

  // Freeze the header row and the student name column
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1, activeCell: 'B2' }];

  // Auto-filter across header
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };

  // ── Student data rows ─────────────────────────────────────────────────────
  const completed = [];
  const failed = [];

  results.forEach((r) => {
    const isFailed = r.evaluationStatus === 'FAILED';
    if (isFailed) failed.push(r); else completed.push(r);

    const scoreDisplay = isFailed
      ? 'FAILED'
      : `${r.score ?? 'N/A'}/${r.maxScore ?? 100}`;

    const confidence = r.confidence != null
      ? `${(r.confidence <= 1 ? r.confidence * 100 : r.confidence).toFixed(0)}%`
      : 'N/A';

    const rowData = {
      studentName: r.studentName,
      submissionType: r.submissionType || 'text',
      scoreDisplay,
      gradeLabel: r.gradeLabel || '',
      confidence,
      status: r.evaluationStatus,
      strengths:             (r.strengths || []).join(' | ') || 'None',
      mistakes:              (r.mistakes || []).join(' | ') || 'None',
      weakAreas:             (r.weakAreas || []).join(' | ') || 'None',
      missingConcepts:       (r.missingConcepts || []).join(' | ') || 'None',
      overallFeedback:       r.overallFeedback || 'N/A',
    };

    // Per-criterion scores
    criteria.forEach((c) => {
      const entry = r.scoreBreakdown?.[c.title] || {};
      rowData[`crit_${c.title}`] = entry.score != null ? entry.score : 'N/A';
    });

    const row = sheet.addRow(rowData);
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = 32;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { color: { argb: 'FF1F2937' } };
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } },
      };
    });

    // Score colour coding
    if (isFailed) {
      row.getCell('scoreDisplay').font = { color: { argb: 'FFB00020' }, bold: true };
      row.getCell('status').font = { color: { argb: 'FFB00020' }, bold: true };
    } else if (r.maxScore > 0) {
      const pct = (r.score / r.maxScore) * 100;
      const argb = pct >= 80 ? 'FF16A34A' : pct >= 50 ? 'FFB45309' : 'FFB00020';
      row.getCell('scoreDisplay').font = { color: { argb } };
    }

  });

  // ── Summary block (appended after a blank row) ────────────────────────────
  sheet.addRow({}); // blank separator

  const scores = completed.map((r) => r.score).filter((s) => typeof s === 'number');
  const passCount = completed.filter((r) => r.maxScore > 0 && (r.score / r.maxScore) * 100 >= 50).length;
  const avgScore = scores.length
    ? (scores.reduce((s, n) => s + n, 0) / scores.length).toFixed(2)
    : 'N/A';

  const summaryRows = [
    ['Assignment Title', session.assignmentTitle || session.sessionLabel || 'N/A'],
    ['Course Code',      session.courseCode || 'N/A'],
    ['Evaluation Date',  new Date(session.createdAt || Date.now()).toLocaleDateString()],
    ['Total Submissions', results.length],
    ['Successful',       completed.length],
    ['Failed',           failed.length],
    ['Average Score',    avgScore],
    ['Pass Rate (≥50%)', completed.length ? `${((passCount / completed.length) * 100).toFixed(1)}%` : 'N/A'],
  ];

  // Per-criterion averages
  criteria.forEach((c) => {
    const cScores = completed
      .map((r) => r.scoreBreakdown?.[c.title]?.score)
      .filter((s) => typeof s === 'number');
    const cAvg = cScores.length
      ? (cScores.reduce((s, n) => s + n, 0) / cScores.length).toFixed(2)
      : 'N/A';
    summaryRows.push([`Avg — ${c.title}`, cAvg]);
  });

  summaryRows.forEach(([label, value]) => {
    const r = sheet.addRow({ studentName: label, submissionType: String(value) });
    r.height = 22;
    r.alignment = { vertical: 'middle' };
    r.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { color: { argb: 'FF1F2937' } };
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } },
      };
    });
    r.getCell('studentName').font = { bold: true, color: { argb: 'FF374151' } };
  });

  return workbook.xlsx.writeBuffer();
}

exports.exportSessionReport = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await AssignmentEvalSession.findById(sessionId).lean();
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const results = await AssignmentStudentResult.find({ sessionId }).sort({ evaluatedAt: -1 }).lean();
    const buffer = await generateExcelReport(session, results);

    const courseCode = session.courseCode || 'eval';
    const assignmentTitle = session.assignmentTitle || session.sessionLabel || 'assignment';
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `${sanitizeFilename(courseCode)}_${sanitizeFilename(assignmentTitle)}_${dateStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

// GET /api/assignment-eval/course/:courseId/reports
exports.listCourseReports = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const reports = await AssignmentEvalReport.find({ courseId, professorId: req.user._id })
      .sort({ generatedAt: -1 })
      .lean();
    return res.status(200).json({ success: true, reports });
  } catch (error) {
    next(error);
  }
};

// GET /api/assignment-eval/reports/:reportId/download
exports.downloadReport = async (req, res, next) => {
  try {
    const report = await AssignmentEvalReport.findOne({
      _id: req.params.reportId,
      professorId: req.user._id,
    });
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }
    if (!fs.existsSync(report.filePath)) {
      return res.status(410).json({ success: false, message: 'Report file no longer on disk' });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
    fs.createReadStream(report.filePath).pipe(res);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/assignment-eval/:sessionId
// Deletes a session, its student results, and any linked disk report.
exports.deleteSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    // Validate that sessionId is a valid ObjectId before querying
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }

    // Use req.user._id directly — Mongoose will cast the string to ObjectId
    const session = await AssignmentEvalSession.findOne({
      _id: sessionId,
      professorId: req.user._id,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found or not authorized' });
    }

    const sessionFiles = [session.rubricPath, session.submissionsZipPath].filter(Boolean);

    // Cascade: delete all student results for this session
    await AssignmentStudentResult.deleteMany({ sessionId: session._id });

    // Cascade: delete linked report record + disk file
    const linkedReport = await AssignmentEvalReport.findOne({ sessionId: session._id });
    if (linkedReport) {
      if (fs.existsSync(linkedReport.filePath)) {
        try { fs.unlinkSync(linkedReport.filePath); } catch { /* non-critical */ }
      }
      await linkedReport.deleteOne();
    }

    await session.deleteOne();

    sessionFiles.forEach((filePath) => {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* non-critical */ }
      }
    });

    return res.status(200).json({ success: true, message: 'Session and all associated data deleted.' });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/assignment-eval/reports/:reportId
// Deletes only the saved report record + disk file.
exports.deleteReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ success: false, message: 'Invalid report ID' });
    }

    const report = await AssignmentEvalReport.findOne({
      _id: reportId,
      professorId: req.user._id,
    });

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found or not authorized' });
    }

    if (fs.existsSync(report.filePath)) {
      try { fs.unlinkSync(report.filePath); } catch { /* non-critical */ }
    }
    await report.deleteOne();
    return res.status(200).json({ success: true, message: 'Report deleted.' });
  } catch (error) {
    next(error);
  }
};


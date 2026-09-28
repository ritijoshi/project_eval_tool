const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const ExcelJS = require('exceljs');

const Assignment = require('../models/Assignment');
const AssignmentSubmission = require('../models/AssignmentSubmission');
const AssignmentEvalSession = require('../models/AssignmentEvalSession');
const AssignmentStudentResult = require('../models/AssignmentStudentResult');
const { getAiServiceUrl } = require('../config/services');

const AI_BASE = getAiServiceUrl();

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

    const rubricFile = req.files.rubric[0];
    const submissionsZip = req.files.submissions[0];
    const normalizedAssignmentId = await resolveAssignmentId(assignmentId);
    const normalizedCourseId = await resolveCourseId(courseId);
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

        io.to(room).emit('assignment_eval_completed', {
          sessionId,
          status: incomingStatus,
          results: await AssignmentStudentResult.find({ sessionId }).sort({ evaluatedAt: -1 }),
          processedStudents: session.processedStudents,
          totalStudents: session.totalStudents,
        });
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

exports.exportSessionReport = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await AssignmentEvalSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    const results = await AssignmentStudentResult.find({ sessionId }).sort({ evaluatedAt: -1 });
    const workbook = new ExcelJS.Workbook();
    const overview = workbook.addWorksheet('Summary Overview');
    overview.columns = [
      { header: 'Student Name', key: 'studentName', width: 24 },
      { header: 'Roll Number', key: 'rollNumber', width: 18 },
      { header: 'Total Score', key: 'score', width: 14 },
      { header: 'Max Score', key: 'maxScore', width: 14 },
      { header: 'Grade', key: 'gradeLabel', width: 12 },
      { header: 'Submission Type', key: 'submissionType', width: 18 },
      { header: 'Evaluation Status', key: 'evaluationStatus', width: 20 },
    ];
    overview.getRow(1).font = { bold: true };

    results.forEach((result) => {
      const row = overview.addRow({
        studentName: result.studentName,
        rollNumber: result.rollNumber,
        score: result.score,
        maxScore: result.maxScore,
        gradeLabel: result.gradeLabel,
        submissionType: result.submissionType,
        evaluationStatus: result.evaluationStatus,
      });

      if (result.maxScore) {
        const percentage = (result.score / result.maxScore) * 100;
        if (percentage >= 80) row.getCell('score').font = { color: { argb: 'FF2E7D32' } };
        else if (percentage >= 50) row.getCell('score').font = { color: { argb: 'FFB7791F' } };
        else row.getCell('score').font = { color: { argb: 'FFB00020' } };
      }
    });

    const detail = workbook.addWorksheet('Per-Criterion Scores');
    const criterionTitles = new Set();
    results.forEach((result) => {
      Object.keys(result.scoreBreakdown || {}).forEach((key) => criterionTitles.add(key));
    });
    const columns = [
      { header: 'Student Name', key: 'studentName', width: 24 },
      { header: 'Roll Number', key: 'rollNumber', width: 18 },
    ];
    [...criterionTitles].forEach((title) => {
      columns.push({ header: title, key: `criterion_${title.replace(/[^a-z0-9]/gi, '_')}`, width: 22 });
    });
    detail.columns = columns;
    detail.getRow(1).font = { bold: true };

    results.forEach((result) => {
      const rowData = { studentName: result.studentName, rollNumber: result.rollNumber };
      [...criterionTitles].forEach((title) => {
        const item = result.scoreBreakdown?.[title] || {};
        rowData[`criterion_${title.replace(/[^a-z0-9]/gi, '_')}`] = item.score ?? '';
      });
      detail.addRow(rowData);
    });

    const feedback = workbook.addWorksheet('Feedback');
    feedback.columns = [
      { header: 'Student Name', key: 'studentName', width: 24 },
      { header: 'Strengths', key: 'strengths', width: 32 },
      { header: 'Improvement Suggestions', key: 'improvementSuggestions', width: 32 },
      { header: 'Overall Feedback', key: 'overallFeedback', width: 42 },
    ];
    feedback.getRow(1).font = { bold: true };
    results.forEach((result) => {
      feedback.addRow({
        studentName: result.studentName,
        strengths: (result.strengths || []).join('\n• '),
        improvementSuggestions: (result.improvementSuggestions || []).join('\n• '),
        overallFeedback: result.overallFeedback || '',
      });
    });

    const stats = workbook.addWorksheet('Statistics');
    stats.columns = [
      { header: 'Metric', key: 'metric', width: 28 },
      { header: 'Value', key: 'value', width: 22 },
    ];
    stats.getRow(1).font = { bold: true };
    const total = results.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
    const passCount = results.filter((item) => Number(item.score || 0) >= (item.maxScore ? item.maxScore * 0.5 : 50)).length;
    stats.addRows([
      { metric: 'Assignment Type', value: session.assignmentType },
      { metric: 'Session Label', value: session.sessionLabel || 'N/A' },
      { metric: 'Total Students', value: results.length },
      { metric: 'Average Score', value: results.length ? (total / results.length).toFixed(2) : 0 },
      { metric: 'Pass Rate', value: results.length ? `${((passCount / results.length) * 100).toFixed(2)}%` : '0%' },
      { metric: 'Completed', value: results.filter((item) => item.evaluationStatus === 'COMPLETED').length },
      { metric: 'Failed', value: results.filter((item) => item.evaluationStatus === 'FAILED').length },
    ]);

    const fileName = `${(session.sessionLabel || 'assignment').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_eval_report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

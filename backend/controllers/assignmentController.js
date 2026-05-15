const axios = require('axios');
const FormData = require('form-data');

const Assignment = require('../models/Assignment');
const AssignmentSubmission = require('../models/AssignmentSubmission');
const { getAiServiceUrl } = require('../config/services');

const AI_BASE = getAiServiceUrl();

const normalizeCourseKey = (value) =>
  String(value || 'general')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'general';

const toDate = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const hasDeadlinePassed = (deadline) => {
  if (!deadline) return false;
  return new Date().getTime() > new Date(deadline).getTime();
};

const buildFileMeta = (files = []) =>
  files.map((file) => ({
    fileName: file.originalname,
    mimeType: file.mimetype || '',
    size: Number(file.size || 0),
  }));

const extractTextFromFiles = async (files = []) => {
  if (!files.length) return '';

  const form = new FormData();
  files.forEach((file) => {
    form.append('files', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
  });

  const response = await axios.post(`${AI_BASE}/extract/files`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return String(response?.data?.extracted_text || '').trim();
};

const normalizeAiEvaluation = (aiData = {}) => {
  const scoreBreakdown = aiData?.score_breakdown || {};
  return {
    totalScore: Number(aiData?.total_score || 0),
    maxScore: Number(aiData?.max_score || 100),
    gradeLabel: String(aiData?.grade_label || ''),
    isRelevant: Boolean(aiData?.is_relevant),
    isIncomplete: Boolean(aiData?.is_incomplete),
    scoreBreakdown: {
      correctness: Number(scoreBreakdown?.correctness || 0),
      topicUnderstanding: Number(scoreBreakdown?.topic_understanding || 0),
      completeness: Number(scoreBreakdown?.completeness || 0),
      technicalAccuracy: Number(scoreBreakdown?.technical_accuracy || 0),
    },
    strengths: Array.isArray(aiData?.strengths) ? aiData.strengths : [],
    mistakes: Array.isArray(aiData?.mistakes) ? aiData.mistakes : [],
    missingConcepts: Array.isArray(aiData?.missing_concepts) ? aiData.missing_concepts : [],
    improvementSuggestions: Array.isArray(aiData?.improvement_suggestions) ? aiData.improvement_suggestions : [],
    summary: String(aiData?.summary || ''),
    detailedFeedback: String(aiData?.detailed_feedback || ''),
    raw: aiData,
    generatedAt: new Date(),
  };
};

const evaluateSubmission = async ({ assignment, submissionText }) => {
  const payload = {
    assignment_text: [assignment.title, assignment.description, assignment.extractedAssignmentText]
      .filter(Boolean)
      .join('\n\n'),
    rubric: String(assignment.rubric || ''),
    submission_text: String(submissionText || ''),
  };

  const response = await axios.post(`${AI_BASE}/assignment/evaluate`, payload);
  return normalizeAiEvaluation(response.data || {});
};

const serializeAssignment = (assignment, submission = null) => {
  const deadline = assignment?.deadline ? new Date(assignment.deadline) : null;
  const deadlinePassed = hasDeadlinePassed(deadline);

  return {
    id: assignment?._id,
    title: assignment?.title,
    description: assignment?.description,
    courseKey: assignment?.courseKey,
    rubric: assignment?.rubric,
    deadline,
    deadlinePassed,
    assignmentFiles: assignment?.assignmentFiles || [],
    createdAt: assignment?.createdAt,
    updatedAt: assignment?.updatedAt,
    submission: submission
      ? {
          id: submission._id,
          status: submission.status,
          gradingStatus: submission.gradingStatus,
          gradingSource: submission.gradingSource,
          submittedAt: submission.submittedAt,
          evaluatedAt: submission.evaluatedAt,
          submissionFiles: submission.submissionFiles || [],
          aiEvaluation: submission.aiEvaluation,
          professorEvaluation: submission.professorEvaluation,
        }
      : null,
  };
};

const createAssignment = async (req, res) => {
  try {
    const professorId = req.user?._id;
    if (!professorId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { title, description, rubric, course_key, deadline } = req.body || {};
    if (!String(title || '').trim()) {
      return res.status(400).json({ message: 'title is required' });
    }

    const deadlineDate = toDate(deadline);
    if (!deadlineDate) {
      return res.status(400).json({ message: 'Valid deadline is required' });
    }

    if (hasDeadlinePassed(deadlineDate)) {
      return res.status(400).json({ message: 'Deadline must be in the future' });
    }

    const files = req.files || [];
    let extractedAssignmentText = '';
    if (files.length) {
      try {
        extractedAssignmentText = await extractTextFromFiles(files);
      } catch (err) {
        return res.status(503).json({ message: 'Failed to extract assignment material text' });
      }
    }

    const assignment = await Assignment.create({
      professor: professorId,
      title: String(title).trim(),
      description: String(description || '').trim(),
      rubric: String(rubric || '').trim(),
      courseKey: normalizeCourseKey(course_key),
      deadline: deadlineDate,
      assignmentFiles: buildFileMeta(files),
      extractedAssignmentText,
      isActive: true,
    });

    // Notify connected clients about new assignment
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('assignment-created', { assignmentId: assignment._id, courseKey: assignment.courseKey });
      }
    } catch (e) {
      // non-fatal
    }

    return res.status(201).json({
      message: 'Assignment created',
      assignment: serializeAssignment(assignment),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getProfessorAssignments = async (req, res) => {
  try {
    const professorId = req.user?._id;
    const { course_key = 'all' } = req.query || {};
    if (!professorId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const query = { professor: professorId, isActive: true };
    if (course_key !== 'all') {
      query.courseKey = normalizeCourseKey(course_key);
    }

    const assignments = await Assignment.find(query).sort({ createdAt: -1 }).lean();
    return res.status(200).json({
      total: assignments.length,
      assignments: assignments.map((a) => serializeAssignment(a)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getStudentAssignments = async (req, res) => {
  try {
    const studentId = req.user?._id;
    const { course_key = 'all' } = req.query || {};

    if (!studentId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const query = { isActive: true };
    if (course_key !== 'all') {
      query.courseKey = normalizeCourseKey(course_key);
    }

    const assignments = await Assignment.find(query).sort({ createdAt: -1 }).lean();
    const assignmentIds = assignments.map((a) => a._id);

    const submissions = await AssignmentSubmission.find({
      assignment: { $in: assignmentIds },
      student: studentId,
    })
      .sort({ updatedAt: -1 })
      .lean();

    const submissionByAssignment = new Map(submissions.map((s) => [String(s.assignment), s]));

    return res.status(200).json({
      total: assignments.length,
      assignments: assignments.map((a) => serializeAssignment(a, submissionByAssignment.get(String(a._id)) || null)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const submitAssignment = async (req, res) => {
  try {
    const studentId = req.user?._id;
    const { assignmentId } = req.params;
    const { submission_text = '' } = req.body || {};
    const files = req.files || [];

    if (!studentId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!submission_text.trim() && !files.length) {
      return res.status(400).json({ message: 'Submission text or files are required' });
    }

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment || !assignment.isActive) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    if (hasDeadlinePassed(assignment.deadline)) {
      return res.status(403).json({ message: 'Deadline has passed. Submissions are locked.' });
    }

    let extractedSubmissionText = '';
    if (files.length) {
      try {
        extractedSubmissionText = await extractTextFromFiles(files);
      } catch (err) {
        return res.status(503).json({ message: 'Failed to parse submission files' });
      }
    }

    const fullSubmissionText = [String(submission_text || '').trim(), extractedSubmissionText]
      .filter(Boolean)
      .join('\n\n');

    let submission = await AssignmentSubmission.findOne({ assignment: assignment._id, student: studentId });

    const status = submission ? 'resubmitted' : 'submitted';
    if (!submission) {
      submission = new AssignmentSubmission({
        assignment: assignment._id,
        student: studentId,
      });
    }

    submission.submissionText = String(submission_text || '').trim();
    submission.extractedSubmissionText = extractedSubmissionText;
    submission.submissionFiles = buildFileMeta(files);
    submission.status = status;
    submission.gradingStatus = 'processing';
    submission.gradingSource = 'ai';
    submission.submittedAt = new Date();
    submission.lastUpdatedAt = new Date();
    submission.activityLog.push({
      action: status,
      actor: studentId,
      note: files.length ? `Submitted with ${files.length} file(s)` : 'Submitted text only',
    });

    await submission.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${studentId}`).emit('assignment-submission-status', {
        assignmentId: assignment._id,
        submissionId: submission._id,
        status: submission.status,
        gradingStatus: submission.gradingStatus,
      });
    }

    try {
      const aiEvaluation = await evaluateSubmission({
        assignment,
        submissionText: fullSubmissionText,
      });

      submission.aiEvaluation = aiEvaluation;
      submission.gradingStatus = 'completed';
      submission.status = 'graded';
      submission.evaluatedAt = new Date();
      submission.lastUpdatedAt = new Date();
      submission.activityLog.push({
        action: 'ai_evaluated',
        note: `AI score: ${aiEvaluation.totalScore}/${aiEvaluation.maxScore}`,
      });
      await submission.save();

      if (io) {
        io.to(`user:${studentId}`).emit('assignment-graded', {
          assignmentId: assignment._id,
          submissionId: submission._id,
          score: aiEvaluation.totalScore,
          gradingSource: 'ai',
        });
        io.to(`user:${assignment.professor}`).emit('assignment-graded', {
          assignmentId: assignment._id,
          submissionId: submission._id,
          studentId,
          score: aiEvaluation.totalScore,
          gradingSource: 'ai',
        });
      }
    } catch (err) {
      submission.gradingStatus = 'failed';
      submission.lastUpdatedAt = new Date();
      submission.activityLog.push({ action: 'ai_failed', note: 'AI evaluation service unavailable' });
      await submission.save();

      return res.status(503).json({ message: 'Submission saved, but AI evaluation failed.' });
    }

    return res.status(200).json({
      message: 'Submission evaluated successfully',
      assignment: serializeAssignment(assignment, submission),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const unsubmitAssignment = async (req, res) => {
  try {
    const studentId = req.user?._id;
    const { assignmentId } = req.params;

    if (!studentId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment || !assignment.isActive) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    if (hasDeadlinePassed(assignment.deadline)) {
      return res.status(403).json({ message: 'Deadline has passed. Unsubmit is locked.' });
    }

    const submission = await AssignmentSubmission.findOne({ assignment: assignment._id, student: studentId });
    if (!submission) {
      return res.status(404).json({ message: 'No active submission found' });
    }

    await AssignmentSubmission.deleteOne({ _id: submission._id });

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${studentId}`).emit('assignment-submission-status', {
        assignmentId: assignment._id,
        status: 'unsubmitted',
      });
    }

    return res.status(200).json({ message: 'Submission removed successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getProfessorSubmissions = async (req, res) => {
  try {
    const professorId = req.user?._id;
    const { assignmentId } = req.params;

    if (!professorId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment || String(assignment.professor) !== String(professorId)) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    const submissions = await AssignmentSubmission.find({ assignment: assignment._id })
      .populate('student', 'name email')
      .sort({ updatedAt: -1 });

    return res.status(200).json({
      total: submissions.length,
      submissions,
      assignment: serializeAssignment(assignment),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const getStudentSubmissionResult = async (req, res) => {
  try {
    const studentId = req.user?._id;
    const { assignmentId } = req.params;

    if (!studentId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const assignment = await Assignment.findById(assignmentId);
    if (!assignment || !assignment.isActive) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    const submission = await AssignmentSubmission.findOne({ assignment: assignment._id, student: studentId });
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    return res.status(200).json({
      assignment: serializeAssignment(assignment, submission),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

const overrideSubmissionEvaluation = async (req, res) => {
  try {
    const professorId = req.user?._id;
    const { submissionId } = req.params;
    const {
      approved = false,
      totalScore,
      maxScore = 100,
      gradeLabel = '',
      feedback = '',
      summary = '',
      scoreBreakdown = {},
    } = req.body || {};

    if (!professorId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const submission = await AssignmentSubmission.findById(submissionId).populate('assignment');
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (!submission.assignment || String(submission.assignment.professor) !== String(professorId)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const edited =
      typeof totalScore === 'number' ||
      Boolean(String(feedback || '').trim()) ||
      Boolean(String(summary || '').trim()) ||
      Boolean(String(gradeLabel || '').trim());

    submission.professorEvaluation = {
      approved: Boolean(approved),
      edited,
      totalScore: typeof totalScore === 'number' ? Number(totalScore) : submission.aiEvaluation?.totalScore || 0,
      maxScore: Number(maxScore || 100),
      gradeLabel: String(gradeLabel || ''),
      scoreBreakdown: {
        correctness: Number(scoreBreakdown?.correctness || submission.aiEvaluation?.scoreBreakdown?.correctness || 0),
        topicUnderstanding: Number(scoreBreakdown?.topicUnderstanding || submission.aiEvaluation?.scoreBreakdown?.topicUnderstanding || 0),
        completeness: Number(scoreBreakdown?.completeness || submission.aiEvaluation?.scoreBreakdown?.completeness || 0),
        technicalAccuracy: Number(scoreBreakdown?.technicalAccuracy || submission.aiEvaluation?.scoreBreakdown?.technicalAccuracy || 0),
      },
      feedback: String(feedback || ''),
      summary: String(summary || ''),
      updatedBy: professorId,
      updatedAt: new Date(),
    };

    submission.gradingSource = edited ? 'professor' : 'ai';
    submission.lastUpdatedAt = new Date();
    submission.activityLog.push({
      action: 'professor_override',
      actor: professorId,
      note: edited ? 'Professor modified AI evaluation' : 'Professor approved AI evaluation',
    });

    await submission.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${submission.student}`).emit('assignment-feedback-updated', {
        assignmentId: submission.assignment._id,
        submissionId: submission._id,
        gradingSource: submission.gradingSource,
      });
    }

    return res.status(200).json({
      message: 'Evaluation updated successfully',
      submission,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createAssignment,
  getProfessorAssignments,
  getStudentAssignments,
  submitAssignment,
  unsubmitAssignment,
  getProfessorSubmissions,
  getStudentSubmissionResult,
  overrideSubmissionEvaluation,
};

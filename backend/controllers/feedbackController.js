const Feedback = require('../models/Feedback');

// ===== PROFESSOR OPERATIONS =====

const getStudentEvaluations = async (req, res) => {
  try {
    const professorId = req.user?._id;
    const { courseKey = 'All', status = 'all' } = req.query;

    if (!professorId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const query = { professor: professorId };
    if (courseKey !== 'All') query.courseKey = courseKey;
    if (status !== 'all') query.status = status;

    const evaluations = await Feedback.find(query)
      .populate('student', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      total: evaluations.length,
      evaluations,
    });
  } catch (error) {
    console.error('Error fetching evaluations:', error);
    res.status(500).json({ message: error.message });
  }
};

const getEvaluationDetail = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const professorId = req.user?._id;

    const feedback = await Feedback.findById(feedbackId)
      .populate('student', 'name email')
      .populate('professor', 'name');

    if (!feedback) {
      return res.status(404).json({ message: 'Feedback not found' });
    }

    if (feedback.professor.toString() !== professorId.toString()) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    res.status(200).json(feedback);
  } catch (error) {
    console.error('Error fetching evaluation detail:', error);
    res.status(500).json({ message: error.message });
  }
};

const addProfessorFeedback = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { manualFeedback, scoreAdjustment } = req.body;
    const professorId = req.user?._id;
    const io = req.app.get('io');

    const feedback = await Feedback.findById(feedbackId)
      .populate('student', 'name email')
      .populate('professor', 'name');
    
    if (!feedback) {
      return res.status(404).json({ message: 'Feedback not found' });
    }

    if (feedback.professor._id.toString() !== professorId.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    feedback.professorReview = {
      reviewed: true,
      manualFeedback,
      scoreAdjustment: scoreAdjustment || 0,
      timestamp: new Date(),
    };
    feedback.status = 'reviewed';

    await feedback.save();

    // Emit real-time notification to student
    if (io) {
      io.to(`user:${feedback.student._id}`).emit('feedback-reviewed', {
        feedbackId,
        courseKey: feedback.courseKey,
        professorName: feedback.professor.name,
        message: `${feedback.professor.name} has reviewed your submission`,
      });
    }

    res.status(200).json({
      message: 'Feedback added successfully',
      feedback,
    });
  } catch (error) {
    console.error('Error adding professor feedback:', error);
    res.status(500).json({ message: error.message });
  }
};

// ===== STUDENT OPERATIONS =====

const getStudentFeedback = async (req, res) => {
  try {
    const studentId = req.user?._id;
    const { courseKey = 'All' } = req.query;

    if (!studentId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const query = { student: studentId };
    if (courseKey !== 'All') query.courseKey = courseKey;

    const feedbacks = await Feedback.find(query)
      .populate('professor', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      total: feedbacks.length,
      feedbacks,
    });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ message: error.message });
  }
};

const getFeedbackDetail = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const studentId = req.user?._id;

    const feedback = await Feedback.findById(feedbackId)
      .populate('professor', 'name email')
      .populate('student', 'name');

    if (!feedback) {
      return res.status(404).json({ message: 'Feedback not found' });
    }

    if (feedback.student.toString() !== studentId.toString()) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    res.status(200).json(feedback);
  } catch (error) {
    console.error('Error fetching feedback detail:', error);
    res.status(500).json({ message: error.message });
  }
};

const addStudentResponse = async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { message, isQuestion = false } = req.body;
    const studentId = req.user?._id;
    const io = req.app.get('io');

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message is required' });
    }

    const feedback = await Feedback.findById(feedbackId)
      .populate('student', 'name')
      .populate('professor', '_id name');
    
    if (!feedback) {
      return res.status(404).json({ message: 'Feedback not found' });
    }

    if (feedback.student._id.toString() !== studentId.toString()) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    feedback.studentResponses.push({
      message: message.trim(),
      timestamp: new Date(),
      isQuestion,
    });

    feedback.status = isQuestion ? 'awaiting_response' : 'resolved';

    await feedback.save();

    // Emit real-time notification to professor
    if (io && feedback.professor) {
      io.to(`user:${feedback.professor._id}`).emit('student-responded', {
        feedbackId,
        courseKey: feedback.courseKey,
        studentName: feedback.student.name,
        messageType: isQuestion ? 'question' : 'response',
        message: `${feedback.student.name} has ${isQuestion ? 'asked a question' : 'responded'} to the feedback`,
      });
    }

    res.status(200).json({
      message: 'Response added successfully',
      feedback,
    });
  } catch (error) {
    console.error('Error adding student response:', error);
    res.status(500).json({ message: error.message });
  }
};

// ===== CREATE FEEDBACK FROM EVALUATION =====

const createFeedbackFromEvaluation = async (req, res) => {
  try {
    const {
      evaluationId,
      aiEvaluation,
      courseKey,
      submissionContent,
      rubric,
    } = req.body;
    const studentId = req.user?._id;

    if (!evaluationId || !courseKey || !aiEvaluation) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Get professor for the course (assume first professor returned or from session)
    // In production, this would look up the actual course instructor
    const User = require('../models/User');
    const professor = await User.findOne({ role: 'professor' }).limit(1);

    if (!professor) {
      return res.status(500).json({ message: 'No professor found for feedback' });
    }

    const feedback = new Feedback({
      evaluationId,
      student: studentId,
      professor: professor._id,
      courseKey,
      aiEvaluation: {
        score: aiEvaluation.score,
        feedback: aiEvaluation.feedback,
        details: aiEvaluation.details || {},
        rubric,
      },
      submissionContent,
      status: 'pending',
    });

    await feedback.save();

    res.status(201).json({
      message: 'Feedback record created',
      feedback,
    });
  } catch (error) {
    console.error('Error creating feedback:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  // Professor operations
  getStudentEvaluations,
  getEvaluationDetail,
  addProfessorFeedback,
  // Student operations
  getStudentFeedback,
  getFeedbackDetail,
  addStudentResponse,
  // Shared
  createFeedbackFromEvaluation,
};

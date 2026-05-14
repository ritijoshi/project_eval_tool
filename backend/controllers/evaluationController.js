const EvaluationSession = require('../models/EvaluationSession');
const StudentEvaluation = require('../models/StudentEvaluation');
const Course = require('../models/Course');
const axios = require('axios');
const path = require('path');

// 1. Start Evaluation Session
exports.startEvaluationSession = async (req, res, next) => {
    try {
        const { courseId, lectureTopic } = req.body;
        const professorId = req.user._id || req.user.id; // from authMiddleware

        if (!req.files || !req.files.transcript || !req.files.submissions) {
            return res.status(400).json({ success: false, message: 'Please upload both transcript and submissions zip' });
        }

        const transcriptFile = req.files.transcript[0];
        const submissionsZip = req.files.submissions[0];

        // Safely validate and lookup course
        let course = null;
        if (courseId && courseId !== 'null' && courseId !== 'all') {
            try {
                course = await Course.findById(courseId);
                if (!course) {
                    return res.status(404).json({ success: false, message: 'Course not found' });
                }
            } catch (error) {
                // Return clean JSON error instead of crashing if courseId is a bad ObjectId
                return res.status(400).json({ success: false, message: 'Invalid course ID format' });
            }
        }

        // Create the session in DB
        const session = await EvaluationSession.create({
            professorId,
            courseId: course ? course._id : null,
            transcriptPath: transcriptFile.path,
            uploadZipPath: submissionsZip.path,
            transcriptMetadata: {
                lectureDate: new Date(),
                lectureTopic: lectureTopic || 'Lecture',
                courseNameSnapshot: course ? course.title : 'Independent Evaluation'
            },
            status: 'UPLOADED'
        });

        // Fire & Forget API call to AI Microservice
        // Use an absolute URL if AI service is hosted elsewhere
        const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';

        const backendPort = process.env.PORT || 5000;
        const fallbackWebhookUrl = `http://localhost:${backendPort}`;

        axios.post(`${aiServiceUrl}/eval/batch-summary`, {
            sessionId: session._id,
            transcriptPath: transcriptFile.path,
            uploadZipPath: submissionsZip.path,
            webhookUrl: `${process.env.BACKEND_URL || fallbackWebhookUrl}/api/evaluations/webhook`
        }).catch(err => {
            console.error('Failed to trigger AI service for Evaluation Session:', session._id, err.message);
            // We do not wait for this, but if it fails instantly (e.g. network partition), update DB
            EvaluationSession.findByIdAndUpdate(session._id, {
                status: 'FAILED',
                'failureMetadata.errorMessage': 'Could not reach AI Microservice'
            }).exec();
        });

        res.status(202).json({
            success: true,
            sessionId: session._id,
            message: 'Evaluation job queued successfully'
        });

    } catch (err) {
        next(err);
    }
};

// 2. Handle AI Webhook progress tracking
exports.handleAIWebhook = async (req, res, next) => {
    try {
        const { sessionId, status, processedStudents, totalStudents, progressPercent, latestResult, errorInfo } = req.body;

        const session = await EvaluationSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        // Update basic session progress
        session.status = status;
        if (totalStudents !== undefined) session.totalStudents = totalStudents;
        if (processedStudents !== undefined) session.processedStudents = processedStudents;
        if (progressPercent !== undefined) session.progressPercent = progressPercent;

        if (errorInfo) {
            session.failureMetadata.errorMessage = errorInfo.message;
            session.failureMetadata.failedStage = errorInfo.stage;
            if (errorInfo.logs) {
                session.failureMetadata.logs.push(errorInfo.logs);
            }
        }

        await session.save();

        // If there's a new student result, save it to StudentEvaluation collection
        let savedResult = null;
        if (latestResult) {
            savedResult = await StudentEvaluation.create({
                sessionId: session._id,
                studentName: latestResult.studentName || 'Unknown',
                rollNumber: latestResult.rollNumber || latestResult.rollNo || 'UNKNOWN',
                rollNo: latestResult.rollNo || latestResult.rollNumber || 'UNKNOWN',
                summaryText: latestResult.summaryText || '',
                score: latestResult.score,
                metrics: latestResult.metrics || {},
                aiEvaluation: latestResult.aiEvaluation || {},
                feedback: latestResult.feedback,
                evaluationStatus: latestResult.success ? 'COMPLETED' : 'FAILED',
                errorMessage: latestResult.errorMessage || ''
            });
        }

        // DECOUPLED WEBSOCKET LAYER
        // Emit progress via socket.io exclusively to the room for this session
        const io = req.app.get('io');
        if (io) {
            const room = `evaluation_session_${sessionId}`;
            io.to(room).emit('evaluation_progress', {
                sessionId,
                status: session.status,
                progressPercent: session.progressPercent,
                processedStudents: session.processedStudents,
                totalStudents: session.totalStudents,
                recentResult: savedResult ? {
                    _id: savedResult._id,
                    studentName: savedResult.studentName,
                    rollNumber: savedResult.rollNumber,
                    rollNo: savedResult.rollNo,
                    score: savedResult.score,
                    metrics: savedResult.metrics,
                    aiEvaluation: savedResult.aiEvaluation,
                    feedback: savedResult.feedback,
                    evaluationStatus: savedResult.evaluationStatus,
                    errorMessage: savedResult.errorMessage
                } : null
            });

            if (status === 'COMPLETED' || status === 'FAILED') {
                const evaluations = await StudentEvaluation.find({ sessionId }).sort({ createdAt: -1 });

                console.log('FINAL EVALUATIONS COUNT:', evaluations.length);
                console.log('FINAL EVALUATIONS:', evaluations);

                io.to(room).emit('evaluation_completed', {
                    sessionId,
                    status,
                    evaluations
                });
            }
        }

        res.status(200).json({ success: true, message: 'Progress recorded' });

    } catch (err) {
        // We do not pass to next(err) here because this is a webhook, we want a clean 500
        console.error('Webhook Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// 3. Get results for a session
exports.getSessionResults = async (req, res, next) => {
    try {
        const { sessionId } = req.params;

        const session = await EvaluationSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        // Verify ownership (only the professor who created the session can view it)

        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        // if (session.professorId.toString() !== req.user.id) {
        //   return res.status(403).json({
        //       success: false,
        //     message: 'Not authorized to view this session'
        //   });
        //}

        const evaluations = await StudentEvaluation.find({ sessionId }).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            session,
            evaluations
        });
    } catch (err) {
        console.error('GET SESSION RESULTS ERROR:', err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
};

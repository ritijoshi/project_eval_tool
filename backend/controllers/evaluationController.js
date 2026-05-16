const EvaluationSession = require('../models/EvaluationSession');
const StudentEvaluation = require('../models/StudentEvaluation');
const Course = require('../models/Course');
const axios = require('axios');
const path = require('path');
const { buildRankedLeaderboard } = require('./leaderboardController');
const ExcelJS = require('exceljs');
const User = require('../models/User');

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
        const { sessionId, status, processedStudents, totalStudents, progressPercent, latestResult, errorInfo, results } = req.body;

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

            const processedCount = await StudentEvaluation.countDocuments({ sessionId });
            if (processedCount !== session.processedStudents) {
                session.processedStudents = processedCount;
                if (session.totalStudents > 0) {
                    session.progressPercent = Math.min(
                        100,
                        Math.round((processedCount / session.totalStudents) * 100)
                    );
                }
                await session.save();
            }
        }

        // Backfill missing results if the AI service sends a bulk payload on completion
        if (Array.isArray(results) && results.length > 0) {
            const ops = results.map((result) => {
                const rollNumber = result.rollNumber || result.rollNo || 'UNKNOWN';
                const studentName = result.studentName || 'Unknown';
                return {
                    updateOne: {
                        filter: { sessionId: session._id, rollNumber, studentName },
                        update: {
                            $set: {
                                rollNumber,
                                rollNo: rollNumber,
                                summaryText: result.summaryText || '',
                                score: result.score ?? null,
                                metrics: result.metrics || {},
                                aiEvaluation: result.aiEvaluation || {},
                                feedback: result.feedback,
                                evaluationStatus: result.success ? 'COMPLETED' : 'FAILED',
                                errorMessage: result.errorMessage || ''
                            }
                        },
                        upsert: true
                    }
                };
            });

            await StudentEvaluation.bulkWrite(ops, { ordered: false });

            const processedCount = await StudentEvaluation.countDocuments({ sessionId });
            session.processedStudents = processedCount;
            if (session.totalStudents > 0) {
                session.progressPercent = Math.min(
                    100,
                    Math.round((processedCount / session.totalStudents) * 100)
                );
            }
            await session.save();
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
                const processedCount = evaluations.length;
                session.processedStudents = processedCount;
                if (status === 'COMPLETED') {
                    session.progressPercent = 100;
                }
                await session.save();

                console.log('FINAL EVALUATIONS COUNT:', evaluations.length);

                io.to(room).emit('evaluation_completed', {
                    sessionId,
                    status,
                    evaluations,
                    processedStudents: processedCount,
                    totalStudents: session.totalStudents
                });

                // Compute and broadcast ranked leaderboard on completion
                if (status === 'COMPLETED') {
                    try {
                        const { ranked, total } = buildRankedLeaderboard(evaluations);
                        const leaderboardRoom = `leaderboard_session_${sessionId}`;
                        io.to(leaderboardRoom).emit('leaderboard_update', {
                            sessionId,
                            leaderboard: ranked,
                            totalEvaluated: total,
                            triggeredBy: 'evaluation_completed',
                        });
                        console.log(`Leaderboard emitted: ${total} ranked students for session ${sessionId}`);
                    } catch (lbErr) {
                        console.error('Failed to compute/emit leaderboard:', lbErr.message);
                    }
                }
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

// 4. Export Evaluation Report to Excel
exports.exportEvaluationReport = async (req, res, next) => {
    try {
        const { sessionId } = req.params;

        console.log(`Starting export for sessionId: ${sessionId}`);

        // Fetch session
        const session = await EvaluationSession.findById(sessionId).populate('courseId');
        if (!session) {
            console.log(`Session ${sessionId} not found`);
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        console.log(`Session found: ${session.transcriptMetadata?.lectureTopic}`);

        // Fetch all evaluated students
        const evaluations = await StudentEvaluation.find({ sessionId }).sort({ createdAt: -1 });
        console.log(`Found ${evaluations.length} evaluations`);

        // Identify missing students if courseId is present
        let missingStudents = [];
        try {
            if (session.courseId && session.courseId.students && session.courseId.students.length > 0) {
                console.log(`Course identified, checking for missing students...`);
                const evaluatedNames = new Set(evaluations.map(e => (e.studentName || '').toLowerCase()));
                const courseStudents = await User.find({ _id: { $in: session.courseId.students } });
                console.log(`Found ${courseStudents.length} course students`);
                
                missingStudents = courseStudents.filter(student => {
                    const studentName = (student.name || '').toLowerCase();
                    return studentName && !evaluatedNames.has(studentName);
                });
                console.log(`${missingStudents.length} missing students identified`);
            }
        } catch (missingErr) {
            console.error('Error identifying missing students:', missingErr.message);
            // Non-blocking, continue export
        }

        // Generate Leaderboard Ranks
        console.log('Building leaderboard...');
        const { ranked } = buildRankedLeaderboard(evaluations);
        console.log(`Leaderboard built with ${ranked?.length || 0} students`);
        const rankMap = new Map();
        ranked.forEach((student) => {
            rankMap.set(student.evaluationId.toString(), student.rank);
        });

        // Initialize Workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'AI Batch Evaluator';
        workbook.created = new Date();

        // ----------------------------------------------------
        // Sheet 1: Summary Overview
        // ----------------------------------------------------
        const overviewSheet = workbook.addWorksheet('Summary Overview');
        overviewSheet.columns = [
            { header: 'Student Name', key: 'name', width: 25 },
            { header: 'Overall Score', key: 'score', width: 15 },
            { header: 'Rank', key: 'rank', width: 10 },
            { header: 'Evaluation Status', key: 'status', width: 20 },
            { header: 'AI Confidence', key: 'confidence', width: 15 }
        ];

        // Styling headers
        overviewSheet.getRow(1).font = { bold: true };
        overviewSheet.getRow(1).alignment = { horizontal: 'center' };

        // ----------------------------------------------------
        // Sheet 2: Detailed Metrics
        // ----------------------------------------------------
        const metricsSheet = workbook.addWorksheet('Detailed Metrics');
        metricsSheet.columns = [
            { header: 'Student Name', key: 'name', width: 25 },
            { header: 'Overall Score', key: 'score', width: 15 },
            { header: 'Topic Coverage', key: 'topicCoverage', width: 15 },
            { header: 'Concept Understanding', key: 'concept', width: 22 },
            { header: 'Technical Accuracy', key: 'accuracy', width: 20 },
            { header: 'Completeness', key: 'completeness', width: 15 },
            { header: 'Clarity & Readability', key: 'clarity', width: 22 },
            { header: 'Logical Flow', key: 'logical', width: 15 },
            { header: 'Critical Thinking', key: 'critical', width: 20 },
            { header: 'Keyword Match', key: 'keyword', width: 15 },
            { header: 'Conciseness', key: 'conciseness', width: 15 },
        ];
        metricsSheet.getRow(1).font = { bold: true };
        metricsSheet.getRow(1).alignment = { horizontal: 'center' };

        // ----------------------------------------------------
        // Sheet 3: Leaderboard Rankings
        // ----------------------------------------------------
        const leaderboardSheet = workbook.addWorksheet('Leaderboard Rankings');
        leaderboardSheet.columns = [
            { header: 'Rank', key: 'rank', width: 10 },
            { header: 'Student Name', key: 'name', width: 25 },
            { header: 'Score', key: 'score', width: 15 }
        ];
        leaderboardSheet.getRow(1).font = { bold: true };
        leaderboardSheet.getRow(1).alignment = { horizontal: 'center' };

        // ----------------------------------------------------
        // Sheet 4: Qualitative Feedback
        // ----------------------------------------------------
        const feedbackSheet = workbook.addWorksheet('Qualitative Feedback');
        feedbackSheet.columns = [
            { header: 'Student Name', key: 'name', width: 20 },
            { header: 'Strengths', key: 'strengths', width: 40 },
            { header: 'Weaknesses', key: 'weaknesses', width: 40 },
            { header: 'Missing Concepts', key: 'missing', width: 40 },
            { header: 'Improvement Suggestions', key: 'improvements', width: 40 },
            { header: 'Final AI Summary', key: 'summary', width: 50 },
        ];
        feedbackSheet.getRow(1).font = { bold: true };
        feedbackSheet.getRow(1).alignment = { horizontal: 'center' };
        
        // Setup text wrapping for feedback
        for (let i = 2; i <= 6; i++) {
            feedbackSheet.getColumn(i).alignment = { wrapText: true, vertical: 'top' };
        }

        // ----------------------------------------------------
        // Sheet 5: Submission Statistics
        // ----------------------------------------------------
        const statsSheet = workbook.addWorksheet('Submission Statistics');
        statsSheet.columns = [
            { header: 'Metric', key: 'metric', width: 30 },
            { header: 'Value', key: 'value', width: 20 },
        ];
        statsSheet.getRow(1).font = { bold: true };

        let totalScore = 0;
        let successfulEvals = 0;
        let failedEvals = 0;

        // Populate Data
        evaluations.forEach((ev) => {
            const isSuccess = ev.evaluationStatus === 'COMPLETED';
            if (isSuccess) {
                totalScore += (ev.score || 0);
                successfulEvals++;
            } else {
                failedEvals++;
            }

            const rank = rankMap.get(ev._id.toString()) || 'N/A';
            const ai = ev.aiEvaluation || {};
            const met = ai.metrics || {};
            
            // Format arrays for feedback
            const strengths = Array.isArray(ai.strengths) ? ai.strengths.join('\n• ') : '';
            const weaknesses = Array.isArray(ai.weakAreas) ? ai.weakAreas.join('\n• ') : '';
            const missing = Array.isArray(ai.missingKeyPoints) ? ai.missingKeyPoints.join('\n• ') : '';
            const improvements = Array.isArray(ai.improvements) ? ai.improvements.join('\n• ') : '';

            // 1. Overview Sheet
            const overviewRow = overviewSheet.addRow({
                name: ev.studentName,
                score: isSuccess ? ev.score : 'N/A',
                rank: isSuccess ? rank : 'N/A',
                status: ev.evaluationStatus,
                confidence: isSuccess ? (met.aiConfidence?.score || 'N/A') : 'N/A'
            });

            // Highlight low performers in Overview
            if (isSuccess && ev.score < 5) {
                overviewRow.getCell('score').font = { color: { argb: 'FFFF0000' } }; // Red
            } else if (isSuccess && ev.score >= 8) {
                overviewRow.getCell('score').font = { color: { argb: 'FF00B050' } }; // Green
            }

            // Highlight failures
            if (!isSuccess) {
                overviewRow.getCell('status').font = { color: { argb: 'FFFF0000' }, bold: true };
            }

            // 2. Metrics Sheet
            if (isSuccess) {
                metricsSheet.addRow({
                    name: ev.studentName,
                    score: ev.score,
                    topicCoverage: met.topicCoverage?.score ?? 'N/A',
                    concept: met.conceptUnderstanding?.score ?? 'N/A',
                    accuracy: met.technicalAccuracy?.score ?? 'N/A',
                    completeness: met.completeness?.score ?? 'N/A',
                    clarity: met.clarityReadability?.score ?? 'N/A',
                    logical: met.logicalFlow?.score ?? 'N/A',
                    critical: met.criticalThinkingDepth?.score ?? 'N/A',
                    keyword: met.keywordMatch?.score ?? 'N/A',
                    conciseness: met.conciseness?.score ?? 'N/A',
                });
            }

            // 4. Feedback Sheet
            if (isSuccess) {
                feedbackSheet.addRow({
                    name: ev.studentName,
                    strengths: strengths ? '• ' + strengths : 'None noted',
                    weaknesses: weaknesses ? '• ' + weaknesses : 'None noted',
                    missing: missing ? '• ' + missing : 'None noted',
                    improvements: improvements ? '• ' + improvements : 'None noted',
                    summary: ai.summaryInsights || ev.feedback || 'No summary available'
                });
            }
        });

        // 3. Leaderboard Sheet (Sort by rank)
        ranked.forEach((student) => {
            leaderboardSheet.addRow({
                rank: student.rank,
                name: student.studentName,
                score: student.overallScore
            });
        });

        // 5. Statistics Data
        const avgScore = successfulEvals > 0 ? (totalScore / successfulEvals).toFixed(2) : 0;
        statsSheet.addRows([
            { metric: 'Total Submissions Received', value: evaluations.length },
            { metric: 'Successful Evaluations', value: successfulEvals },
            { metric: 'Failed Evaluations', value: failedEvals },
            { metric: 'Missing Submissions (Not Evaluated)', value: missingStudents.length },
            { metric: 'Average Class Score', value: avgScore },
            { metric: 'Lecture Topic', value: session.transcriptMetadata?.lectureTopic || 'N/A' },
            { metric: 'Evaluation Date', value: new Date(session.createdAt).toLocaleDateString() }
        ]);

        // Add Missing Students to Overview if any
        if (missingStudents.length > 0) {
            missingStudents.forEach(student => {
                const row = overviewSheet.addRow({
                    name: student.name || student.username,
                    score: 'N/A',
                    rank: 'N/A',
                    status: 'MISSING',
                    confidence: 'N/A'
                });
                row.getCell('status').font = { color: { argb: 'FFFF8C00' }, bold: true }; // Dark Orange for missing
            });
        }

        // Add Auto-Filters to sheets with multiple rows
        overviewSheet.autoFilter = {
            from: 'A1',
            to: 'E1',
        };
        metricsSheet.autoFilter = {
            from: 'A1',
            to: 'K1',
        };
        leaderboardSheet.autoFilter = {
            from: 'A1',
            to: 'C1',
        };

        // Output File
        const courseName = session.courseId ? (session.courseId.title || 'Course').replace(/[^a-z0-9]/gi, '_') : 'Independent_Eval';
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `${courseName}_AI_Evaluation_Report_${dateStr}.xlsx`;

        console.log(`Preparing to send file: ${filename}`);

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${filename}"`
        );

        await workbook.xlsx.write(res);
        console.log('File successfully sent to response stream');
        res.end();

    } catch (err) {
        console.error('EXPORT EVALUATION ERROR:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
};

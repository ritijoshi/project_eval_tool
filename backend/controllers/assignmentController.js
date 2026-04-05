const mongoose = require('mongoose');
const path = require('path');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');

const ensureDbConnected = () => mongoose.connection.readyState === 1;

const mapFiles = (files = []) =>
    files.map((file) => ({
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: `/uploads/${file.destination ? path.basename(file.destination) : 'assignments'}/${file.filename}`,
    }));

const createAssignment = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const { title, description, courseId, deadline, rubric } = req.body || {};

        if (!professorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!title || !courseId || !deadline) {
            return res.status(400).json({ message: 'title, courseId, and deadline are required' });
        }

        const course = await Course.findById(courseId).select('professor students courseCode');
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        if (String(course.professor) !== String(professorId)) {
            return res.status(403).json({ message: 'Not authorized to create assignments for this course' });
        }

        const attachments = mapFiles(req.files || []);

        const assignment = await Assignment.create({
            title: String(title).trim(),
            description: String(description || '').trim(),
            course: courseId,
            deadline: new Date(deadline),
            rubric: String(rubric || '').trim(),
            attachments,
            createdBy: professorId,
        });

        const io = req.app?.get('io');
        if (io && Array.isArray(course.students)) {
            course.students.forEach((studentId) => {
                io.to(`user:${studentId}`).emit('assignments-updated', {
                    reason: 'created',
                    courseId: String(courseId),
                    courseKey: String(course.courseCode || '').trim().toLowerCase(),
                    assignmentId: String(assignment._id),
                    timestamp: new Date().toISOString(),
                });
            });
        }

        return res.status(201).json({ message: 'Assignment created.', assignment });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to create assignment' });
    }
};

const listAssignmentsForProfessor = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const { courseId, sort = '' } = req.query || {};

        const courseQuery = { createdBy: professorId };
        if (courseId) {
            courseQuery.course = courseId;
        }

        const sortOption =
            sort === 'newest'
                ? { createdAt: -1 }
                : sort === 'oldest'
                    ? { createdAt: 1 }
                    : { deadline: 1 };

        const assignments = await Assignment.find(courseQuery)
            .populate('course', 'title courseCode')
            .sort(sortOption)
            .lean();

        return res.status(200).json({ assignments });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to fetch assignments' });
    }
};

const listAssignmentsForStudent = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const studentId = req.user?._id;
        const { courseId, sort = '' } = req.query || {};

        if (!courseId) {
            return res.status(400).json({ message: 'courseId is required' });
        }

        const course = await Course.findById(courseId).select('students');
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        if (!course.students.some((id) => String(id) === String(studentId))) {
            return res.status(403).json({ message: 'Not enrolled in this course' });
        }

        const sortOption =
            sort === 'newest'
                ? { createdAt: -1 }
                : sort === 'oldest'
                    ? { createdAt: 1 }
                    : { deadline: 1 };

        const assignments = await Assignment.find({ course: courseId })
            .sort(sortOption)
            .lean();

        const submissions = await Submission.find({
            student: studentId,
            assignment: { $in: assignments.map((a) => a._id) },
            isLatest: true,
        }).lean();

        const submissionByAssignment = new Map(
            submissions.map((sub) => [String(sub.assignment), sub])
        );

        const enriched = assignments.map((assignment) => ({
            ...assignment,
            latestSubmission: submissionByAssignment.get(String(assignment._id)) || null,
        }));

        return res.status(200).json({ assignments: enriched });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to fetch assignments' });
    }
};

const submitAssignment = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const studentId = req.user?._id;
        const { assignmentId } = req.params;

        const assignment = await Assignment.findById(assignmentId).select('course deadline');
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        const course = await Course.findById(assignment.course).select('students');
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        if (!course.students.some((id) => String(id) === String(studentId))) {
            return res.status(403).json({ message: 'Not enrolled in this course' });
        }

        const files = req.files || [];
        if (!files.length) {
            return res.status(400).json({ message: 'At least one file is required' });
        }

        const latest = await Submission.findOne({ student: studentId, assignment: assignmentId })
            .sort({ version: -1 })
            .lean();

        const nextVersion = latest?.version ? latest.version + 1 : 1;
        const isLate = assignment.deadline ? new Date() > new Date(assignment.deadline) : false;

        if (latest) {
            await Submission.updateMany(
                { student: studentId, assignment: assignmentId, isLatest: true },
                { $set: { isLatest: false } }
            );
        }

        const submission = await Submission.create({
            student: studentId,
            assignment: assignmentId,
            files: mapFiles(files),
            submittedAt: new Date(),
            version: nextVersion,
            isLate,
            isLatest: true,
        });

        return res.status(201).json({ message: 'Submission received.', submission });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to submit assignment' });
    }
};

const listMySubmissions = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const studentId = req.user?._id;
        const { assignmentId } = req.params;

        const submissions = await Submission.find({ student: studentId, assignment: assignmentId })
            .sort({ version: -1 })
            .lean();

        return res.status(200).json({ submissions });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load submissions' });
    }
};

const listAssignmentSubmissions = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const { assignmentId } = req.params;

        const assignment = await Assignment.findById(assignmentId).populate('course', 'professor');
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        if (String(assignment.course.professor) !== String(professorId)) {
            return res.status(403).json({ message: 'Not authorized to view submissions for this assignment' });
        }

        const submissions = await Submission.find({ assignment: assignmentId })
            .populate('student', 'name email')
            .sort({ submittedAt: -1 })
            .lean();

        return res.status(200).json({ submissions });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load submissions' });
    }
};

const listUpcomingAssignments = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const studentId = req.user?._id;
        const { courseId, limit = 5 } = req.query || {};
        const now = new Date();

        let courseIds = [];
        if (courseId) {
            const course = await Course.findById(courseId).select('students');
            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }
            if (!course.students.some((id) => String(id) === String(studentId))) {
                return res.status(403).json({ message: 'Not enrolled in this course' });
            }
            courseIds = [courseId];
        } else {
            const courses = await Course.find({ students: studentId }).select('_id');
            courseIds = courses.map((course) => course._id);
        }

        if (!courseIds.length) {
            return res.status(200).json({ assignments: [] });
        }

        const assignments = await Assignment.find({
            course: { $in: courseIds },
            deadline: { $gte: now },
        })
            .populate('course', 'title courseCode')
            .sort({ deadline: 1 })
            .limit(Number(limit))
            .lean();

        return res.status(200).json({ assignments });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load upcoming assignments' });
    }
};

const gradeSubmission = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const { assignmentId, submissionId } = req.params;
        const { score, feedback } = req.body || {};

        const assignment = await Assignment.findById(assignmentId).populate('course', 'professor');
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found' });
        }

        if (String(assignment.course.professor) !== String(professorId)) {
            return res.status(403).json({ message: 'Not authorized to grade this assignment' });
        }

        const submission = await Submission.findById(submissionId);
        if (!submission) {
            return res.status(404).json({ message: 'Submission not found' });
        }

        if (String(submission.assignment) !== String(assignmentId)) {
            return res.status(400).json({ message: 'Submission does not belong to this assignment' });
        }

        submission.score = Number.isFinite(Number(score)) ? Number(score) : null;
        submission.feedback = String(feedback || '').trim();
        await submission.save();

        return res.status(200).json({ message: 'Submission graded.', submission });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to grade submission' });
    }
};

module.exports = {
    createAssignment,
    listAssignmentsForProfessor,
    listAssignmentsForStudent,
    submitAssignment,
    listMySubmissions,
    listAssignmentSubmissions,
    gradeSubmission,
    listUpcomingAssignments,
};

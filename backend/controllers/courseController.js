const mongoose = require('mongoose');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const User = require('../models/User');
const Announcement = require('../models/Announcement');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Test = require('../models/Test');
const Attempt = require('../models/Attempt');
const Rubric = require('../models/Rubric');
const WeeklyUpdate = require('../models/WeeklyUpdate');
const Feedback = require('../models/Feedback');
const ChatHistory = require('../models/ChatHistory');

const ensureDbConnected = () => mongoose.connection.readyState === 1;

const COURSE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const generateCourseCode = async (length = 6) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        let code = '';
        for (let i = 0; i < length; i += 1) {
            code += COURSE_CODE_ALPHABET[Math.floor(Math.random() * COURSE_CODE_ALPHABET.length)];
        }
        const exists = await Course.exists({ courseCode: code });
        if (!exists) return code;
    }
    throw new Error('Unable to generate a unique course code. Please retry.');
};

const summarizeCourse = (course) => ({
    _id: course._id,
    title: course.title,
    description: course.description,
    courseCode: course.courseCode,
    professor: course.professor,
    studentsCount: Array.isArray(course.students) ? course.students.length : 0,
    createdAt: course.createdAt,
});

const listCourses = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const userId = req.user?._id;
        const role = req.user?.role;
        let query = {};

        if (role === 'professor') {
            query = { professor: userId };
        } else if (role === 'student') {
            query = { students: userId };
        }

        const courses = await Course.find(query)
            .populate('professor', 'name email')
            .sort({ createdAt: -1 })
            .lean();

        const records = courses.map(summarizeCourse);
        const courseCodes = records.map((course) => course.courseCode);

        return res.status(200).json({ courses: courseCodes, records });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to list courses' });
    }
};

const createCourse = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const { title, description } = req.body || {};

        if (!professorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!String(title || '').trim()) {
            return res.status(400).json({ message: 'title is required' });
        }

        const courseCode = await generateCourseCode();
        const course = await Course.create({
            title: String(title).trim(),
            description: String(description || '').trim(),
            professor: professorId,
            courseCode,
            students: [],
            announcements: [],
            assignments: [],
        });

        await User.findByIdAndUpdate(professorId, {
            $addToSet: { createdCourses: course._id },
        });

        return res.status(201).json({
            message: 'Course created successfully.',
            course: summarizeCourse(course),
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to create course' });
    }
};

const inviteStudents = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const { courseId } = req.params;
        const { emails = [], studentIds = [] } = req.body || {};

        if (!professorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        if (String(course.professor) !== String(professorId)) {
            return res.status(403).json({ message: 'Not authorized to invite students to this course' });
        }

        const normalizedEmails = Array.isArray(emails)
            ? emails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean)
            : [];
        const normalizedIds = Array.isArray(studentIds)
            ? studentIds.map((id) => String(id || '').trim()).filter(Boolean)
            : [];

        if (!normalizedEmails.length && !normalizedIds.length) {
            return res.status(400).json({ message: 'Provide at least one student email or id' });
        }

        const students = await User.find({
            role: 'student',
            $or: [
                { _id: { $in: normalizedIds } },
                { email: { $in: normalizedEmails } },
            ],
        }).select('_id email name');

        if (!students.length) {
            return res.status(404).json({ message: 'No matching students found' });
        }

        const studentIdsResolved = students.map((student) => student._id);

        await Course.findByIdAndUpdate(course._id, {
            $addToSet: { students: { $each: studentIdsResolved } },
        });

        await User.updateMany(
            { _id: { $in: studentIdsResolved } },
            { $addToSet: { enrolledCourses: course._id } }
        );

        await Promise.all(
            studentIdsResolved.map((studentId) =>
                Enrollment.findOneAndUpdate(
                    { student: studentId, course: course._id },
                    { $setOnInsert: { progress: 0, grades: [] } },
                    { upsert: true, new: true }
                )
            )
        );

        const io = req.app?.get('io');
        if (io) {
            studentIdsResolved.forEach((studentId) => {
                io.to(`user:${studentId}`).emit('courses-updated', {
                    reason: 'invited',
                    courseId: String(course._id),
                    timestamp: new Date().toISOString(),
                });
            });
        }

        const missingEmails = normalizedEmails.filter(
            (email) => !students.some((student) => student.email.toLowerCase() === email)
        );

        return res.status(200).json({
            message: 'Students invited successfully.',
            invited: students.map((student) => ({
                _id: student._id,
                name: student.name,
                email: student.email,
            })),
            missing: missingEmails,
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to invite students' });
    }
};

const joinCourse = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const studentId = req.user?._id;
        const rawCode = String(req.body?.code || '').trim().toUpperCase();

        if (!studentId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!rawCode) {
            return res.status(400).json({ message: 'Course code is required' });
        }

        const course = await Course.findOne({ courseCode: rawCode }).populate('professor', 'name email');
        if (!course) {
            return res.status(404).json({ message: 'Invalid course code' });
        }

        await Course.findByIdAndUpdate(course._id, {
            $addToSet: { students: studentId },
        });

        await User.findByIdAndUpdate(studentId, {
            $addToSet: { enrolledCourses: course._id },
        });

        await Enrollment.findOneAndUpdate(
            { student: studentId, course: course._id },
            { $setOnInsert: { progress: 0, grades: [] } },
            { upsert: true, new: true }
        );

        const io = req.app?.get('io');
        if (io) {
            io.to(`user:${studentId}`).emit('courses-updated', {
                reason: 'joined',
                courseId: String(course._id),
                timestamp: new Date().toISOString(),
            });
        }

        return res.status(200).json({
            message: 'Enrolled successfully.',
            course: summarizeCourse(course),
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to join course' });
    }
};

const unenrollCourse = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const studentId = req.user?._id;
        const { courseId } = req.params;

        if (!studentId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!mongoose.Types.ObjectId.isValid(String(courseId))) {
            return res.status(400).json({ message: 'Invalid courseId' });
        }

        const course = await Course.findById(courseId).select('_id students').lean();
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        const isEnrolled = Array.isArray(course.students)
            ? course.students.some((id) => String(id) === String(studentId))
            : false;
        if (!isEnrolled) {
            return res.status(400).json({ message: 'You are not enrolled in this course' });
        }

        await Promise.all([
            Course.updateOne({ _id: courseId }, { $pull: { students: studentId } }),
            User.updateOne({ _id: studentId }, { $pull: { enrolledCourses: courseId } }),
            User.updateOne({ _id: studentId, lastActiveCourse: courseId }, { $set: { lastActiveCourse: null } }),
            Enrollment.deleteOne({ student: studentId, course: courseId }),
        ]);

        const io = req.app?.get('io');
        if (io) {
            io.to(`user:${studentId}`).emit('courses-updated', {
                reason: 'unenrolled',
                courseId: String(courseId),
                timestamp: new Date().toISOString(),
            });
        }

        return res.status(200).json({ message: 'Unenrolled successfully.' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to unenroll from course' });
    }
};

const deleteCourse = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const { courseId } = req.params;

        if (!professorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!mongoose.Types.ObjectId.isValid(String(courseId))) {
            return res.status(400).json({ message: 'Invalid courseId' });
        }

        const course = await Course.findOne({ _id: courseId, professor: professorId })
            .select('_id courseCode students professor')
            .lean();

        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        const studentIds = Array.isArray(course.students) ? course.students.map((id) => String(id)) : [];
        const courseKey = String(course.courseCode || '').trim().toLowerCase();

        const assignmentDocs = await Assignment.find({ course: courseId }).select('_id').lean();
        const assignmentIds = assignmentDocs.map((row) => row._id);

        await Promise.all([
            Enrollment.deleteMany({ course: courseId }),
            Announcement.deleteMany({ courseId }),
            Attempt.deleteMany({ courseId }),
            Test.deleteMany({ courseId }),
            Submission.deleteMany({ assignment: { $in: assignmentIds } }),
            Assignment.deleteMany({ course: courseId }),
            courseKey ? Rubric.deleteMany({ courseKey }) : Promise.resolve(),
            courseKey ? WeeklyUpdate.deleteMany({ courseKey }) : Promise.resolve(),
            courseKey ? Feedback.deleteMany({ courseKey }) : Promise.resolve(),
            courseKey ? ChatHistory.deleteMany({ courseKey }) : Promise.resolve(),
            studentIds.length
                ? User.updateMany({ _id: { $in: studentIds } }, { $pull: { enrolledCourses: courseId } })
                : Promise.resolve(),
            studentIds.length
                ? User.updateMany(
                      { _id: { $in: studentIds }, lastActiveCourse: courseId },
                      { $set: { lastActiveCourse: null } }
                  )
                : Promise.resolve(),
            User.updateOne({ _id: professorId }, { $pull: { createdCourses: courseId } }),
            User.updateOne({ _id: professorId, lastActiveCourse: courseId }, { $set: { lastActiveCourse: null } }),
            Course.deleteOne({ _id: courseId, professor: professorId }),
        ]);

        const io = req.app?.get('io');
        if (io) {
            io.to(`user:${professorId}`).emit('courses-updated', {
                reason: 'deleted',
                courseId: String(courseId),
                timestamp: new Date().toISOString(),
            });

            studentIds.forEach((studentId) => {
                io.to(`user:${studentId}`).emit('courses-updated', {
                    reason: 'course-deleted',
                    courseId: String(courseId),
                    timestamp: new Date().toISOString(),
                });
            });
        }

        return res.status(200).json({ message: 'Course deleted successfully.' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to delete course' });
    }
};

module.exports = {
    listCourses,
    createCourse,
    inviteStudents,
    joinCourse,
    unenrollCourse,
    deleteCourse,
};


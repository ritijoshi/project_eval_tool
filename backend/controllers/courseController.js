const mongoose = require('mongoose');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const User = require('../models/User');

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

        return res.status(200).json({
            message: 'Enrolled successfully.',
            course: summarizeCourse(course),
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to join course' });
    }
};

module.exports = {
    listCourses,
    createCourse,
    inviteStudents,
    joinCourse,
};


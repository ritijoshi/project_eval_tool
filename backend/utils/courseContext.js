const Course = require('../models/Course');

const resolveCourseCode = async (courseId) => {
    if (!courseId || courseId === 'all') return null;
    const course = await Course.findById(courseId).select('courseCode').lean();
    return course?.courseCode || null;
};

const getCourseContextFromRequest = async (req) => {
    const rawCourseId =
        req.query?.courseId ||
        req.body?.courseId ||
        req.headers['x-course-id'] ||
        null;

    if (!rawCourseId || rawCourseId === 'all') {
        return { courseId: null, courseCode: null };
    }

    const courseCode = await resolveCourseCode(rawCourseId);
    return { courseId: rawCourseId, courseCode };
};

module.exports = { resolveCourseCode, getCourseContextFromRequest };

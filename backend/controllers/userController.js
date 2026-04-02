const mongoose = require('mongoose');
const User = require('../models/User');
const Course = require('../models/Course');

const ensureDbConnected = () => mongoose.connection.readyState === 1;

const getActiveCourse = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const userId = req.user?._id;
        const user = await User.findById(userId).select('lastActiveCourse').lean();
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!user.lastActiveCourse) {
            return res.status(200).json({ courseId: null, courseCode: null });
        }

        const course = await Course.findById(user.lastActiveCourse)
            .select('courseCode')
            .lean();

        return res.status(200).json({
            courseId: user.lastActiveCourse,
            courseCode: course?.courseCode || null,
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load active course' });
    }
};

const setActiveCourse = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const userId = req.user?._id;
        const { courseId } = req.body || {};

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!courseId || courseId === 'all') {
            return res.status(200).json({ message: 'Active course unchanged.' });
        }

        const exists = await Course.exists({ _id: courseId });
        if (!exists) {
            return res.status(404).json({ message: 'Course not found' });
        }

        await User.findByIdAndUpdate(userId, { $set: { lastActiveCourse: courseId } });

        return res.status(200).json({ message: 'Active course updated.' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to update active course' });
    }
};

module.exports = { getActiveCourse, setActiveCourse };

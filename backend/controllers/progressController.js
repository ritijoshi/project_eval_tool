const mongoose = require('mongoose');
const Course = require('../models/Course');
const Progress = require('../models/Progress');
const {
    getProgressSnapshot,
    getAllCoursesProgressForStudent,
    recomputeStudentCourseProgress,
    registerMaterialViewEvent,
} = require('../services/progressService');

const ensureDbConnected = () => mongoose.connection.readyState === 1;

const getProgress = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const role = req.user?.role;
        const requesterId = req.user?._id;
        const { studentId: queryStudentId, courseId, includeInsights } = req.query || {};

        if (!courseId || !mongoose.Types.ObjectId.isValid(String(courseId))) {
            return res.status(400).json({ message: 'Valid courseId is required' });
        }

        let studentId = requesterId;
        if (role === 'professor') {
            if (!queryStudentId || !mongoose.Types.ObjectId.isValid(String(queryStudentId))) {
                return res.status(400).json({ message: 'studentId is required for professor view' });
            }
            studentId = queryStudentId;

            const course = await Course.findById(courseId).select('professor').lean();
            if (!course) return res.status(404).json({ message: 'Course not found' });
            if (String(course.professor) !== String(requesterId)) {
                return res.status(403).json({ message: 'Not authorized for this course' });
            }
        } else if (role === 'student') {
            if (queryStudentId && String(queryStudentId) !== String(requesterId)) {
                return res.status(403).json({ message: 'Students can only access their own progress' });
            }
        } else {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const progress = await getProgressSnapshot({
            studentId,
            courseId,
            includeAiInsights: String(includeInsights || '').toLowerCase() === 'true',
            forceRecompute: false,
        });

        return res.status(200).json({ progress });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load progress' });
    }
};

const getAllCoursesProgress = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const role = req.user?.role;
        const requesterId = req.user?._id;
        const queryStudentId = req.query?.studentId;

        let studentId = requesterId;
        if (role === 'professor') {
            if (!queryStudentId || !mongoose.Types.ObjectId.isValid(String(queryStudentId))) {
                return res.status(400).json({ message: 'studentId is required for professor view' });
            }
            studentId = queryStudentId;
        } else if (role !== 'student') {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const progress = await getAllCoursesProgressForStudent(studentId);
        return res.status(200).json({ progress });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load all-course progress' });
    }
};

const triggerProgressUpdate = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const role = req.user?.role;
        const requesterId = req.user?._id;
        const {
            studentId: bodyStudentId,
            courseId,
            courseKey,
            eventType = 'manual',
            payload = {},
            includeInsights = false,
        } = req.body || {};

        if (!bodyStudentId || !mongoose.Types.ObjectId.isValid(String(bodyStudentId))) {
            return res.status(400).json({ message: 'Valid studentId is required' });
        }

        if (role === 'student' && String(bodyStudentId) !== String(requesterId)) {
            return res.status(403).json({ message: 'Not authorized to update another student progress' });
        }

        if (eventType === 'material_view') {
            if (!courseId && !courseKey) {
                return res.status(400).json({ message: 'courseId or courseKey is required for material_view event' });
            }

            const progress = await registerMaterialViewEvent({
                studentId: bodyStudentId,
                courseId,
                courseKey,
                moduleKey: payload.moduleKey,
                materialTitle: payload.materialTitle,
                timeSpentSeconds: payload.timeSpentSeconds,
                completed: payload.completed,
            });

            return res.status(200).json({ message: 'Progress updated from material view event', progress });
        }

        if (!courseId || !mongoose.Types.ObjectId.isValid(String(courseId))) {
            return res.status(400).json({ message: 'Valid courseId is required' });
        }

        const progress = await recomputeStudentCourseProgress({
            studentId: bodyStudentId,
            courseId,
            includeAiInsights: Boolean(includeInsights),
        });

        return res.status(200).json({ message: `Progress updated for event: ${eventType}`, progress });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to update progress' });
    }
};

const getCourseAnalytics = async (req, res) => {
    if (!ensureDbConnected()) {
        return res.status(503).json({ message: 'Database is not connected' });
    }

    try {
        const professorId = req.user?._id;
        const role = req.user?.role;
        const { courseId } = req.params;

        if (role !== 'professor') {
            return res.status(403).json({ message: 'Only professors can access course analytics' });
        }

        if (!courseId || !mongoose.Types.ObjectId.isValid(String(courseId))) {
            return res.status(400).json({ message: 'Valid courseId is required' });
        }

        const course = await Course.findById(courseId)
            .select('title courseCode students professor')
            .populate('students', 'name email')
            .lean();

        if (!course) return res.status(404).json({ message: 'Course not found' });
        if (String(course.professor) !== String(professorId)) {
            return res.status(403).json({ message: 'Not authorized for this course' });
        }

        const studentIds = Array.isArray(course.students) ? course.students.map((student) => student._id) : [];

        const progressRows = await Promise.all(
            studentIds.map((studentId) =>
                getProgressSnapshot({ studentId, courseId, includeAiInsights: false, forceRecompute: false }).catch(() => null)
            )
        );

        const rows = progressRows.filter(Boolean);
        const classAverage = rows.length > 0
            ? rows.reduce((sum, row) => sum + Number(row.overallProgress || 0), 0) / rows.length
            : 0;

        const studentById = new Map(
            (course.students || []).map((student) => [String(student._id), student])
        );

        const studentProgress = rows
            .map((row) => {
                const student = studentById.get(String(row.studentId));
                return {
                    studentId: row.studentId,
                    name: student?.name || 'Unknown Student',
                    email: student?.email || '',
                    overallProgress: Number(row.overallProgress || 0),
                    activityScore: Number(row.activityScore || 0),
                    activityLevel: row.activityLevel || 'low',
                    weakTopics: row.weakTopics || [],
                    strongTopics: row.strongTopics || [],
                    assignmentAvg: Number(row.assignmentStats?.avgScore || 0),
                    testAvg: Number(row.testStats?.avgScore || 0),
                    modulesCompleted: Number(row.modulesCompleted || 0),
                    totalModules: Number(row.totalModules || 0),
                };
            })
            .sort((a, b) => b.overallProgress - a.overallProgress);

        const topPerformers = studentProgress.slice(0, 5);
        const weakPerformers = [...studentProgress].sort((a, b) => a.overallProgress - b.overallProgress).slice(0, 5);
        const atRiskStudents = studentProgress.filter(
            (row) => row.overallProgress < 50 || row.activityLevel === 'low' || row.weakTopics.length >= 3
        );

        const topicDifficultyMap = new Map();
        rows.forEach((row) => {
            (row.topicProgress || []).forEach((topic) => {
                const key = String(topic.topicName || '').trim();
                if (!key) return;
                if (!topicDifficultyMap.has(key)) {
                    topicDifficultyMap.set(key, { totalMastery: 0, count: 0 });
                }
                const bucket = topicDifficultyMap.get(key);
                bucket.totalMastery += Number(topic.masteryLevel || 0);
                bucket.count += 1;
            });
        });

        const difficultTopics = Array.from(topicDifficultyMap.entries())
            .map(([topicName, bucket]) => ({
                topicName,
                averageMastery: bucket.count > 0 ? bucket.totalMastery / bucket.count : 0,
            }))
            .sort((a, b) => a.averageMastery - b.averageMastery)
            .slice(0, 10);

        return res.status(200).json({
            course: {
                _id: course._id,
                title: course.title,
                courseCode: course.courseCode,
            },
            summary: {
                totalStudents: studentProgress.length,
                classAverage: Math.round(classAverage * 10) / 10,
                atRiskCount: atRiskStudents.length,
            },
            studentProgress,
            topPerformers,
            weakPerformers,
            atRiskStudents,
            difficultTopics,
            generatedAt: new Date().toISOString(),
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to load course analytics' });
    }
};

module.exports = {
    getProgress,
    getAllCoursesProgress,
    triggerProgressUpdate,
    getCourseAnalytics,
};
